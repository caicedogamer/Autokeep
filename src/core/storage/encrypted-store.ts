/*
 * EncryptedStore — the only way modules persist data.
 *
 * Sits on top of StorageAdapter and CryptoService:
 *   plaintext object  →  JSON  →  AES-GCM encrypt  →  Uint8Array  →  StorageAdapter.set
 *   StorageAdapter.get  →  Uint8Array  →  AES-GCM decrypt  →  JSON  →  plaintext object
 *
 * The persisted on-disk envelope embeds the IV alongside the ciphertext
 * (see EncryptedEnvelope below) so the storage adapter only sees one
 * opaque byte array per logical record.
 *
 * Migration dispatch is gated on the envelope's `schemaVersion` — at v1
 * this is the identity transform, but the seam is wired so future
 * versions slot in without touching consumers.
 *
 * Constitution Principles II + III: storage never sees plaintext;
 * adapters operate on opaque bytes only.
 */

import { AutoKeepError } from '../result.js';
import type { CryptoAad, CryptoService, EncryptedBlob } from '../crypto/crypto-service.js';
import { type StorageAdapter, StorageCorruptError } from './storage-adapter.js';

/* ---------- On-disk envelope ---------- */

/**
 * The plaintext payload IS the application object. The envelope below is
 * what gets written to storage as JSON-then-encrypted-then-bytes. The
 * adapter sees the bytes only.
 *
 * `schemaVersion` lives at the envelope level so we can choose a
 * migration BEFORE attempting to JSON-parse the inner payload.
 */
export interface EncryptedEnvelope {
  readonly schemaVersion: number;
  readonly blob: EncryptedBlob;
}

/* ---------- Errors ---------- */

export class UnsupportedSchemaVersionError extends AutoKeepError {
  public readonly code = 'UNSUPPORTED_SCHEMA_VERSION';
  public constructor(public readonly seen: number) {
    super(`Unsupported schemaVersion ${String(seen)} in encrypted payload.`);
  }
}

/* ---------- Migrations registry ---------- */

/**
 * A migration steps a plaintext payload from one schemaVersion to the
 * next. The registry below MUST cover every version from `oldest` to
 * `CURRENT`. Identity migrations are explicit so the registry stays a
 * complete map and future authors don't accidentally skip a version.
 */
type Migration = (payload: unknown) => unknown;

export const CURRENT_SCHEMA_VERSION = 2;

/**
 * v1 → v2 migration: backfills `FinancialRecord.extraMetadata = {}`,
 * synthesizes `inferenceReport` + `mappingDecision` on historical
 * `ImportBatch` entries (representing the legacy fixed-header import
 * as `source: 'auto'`), and bumps `schemaVersion` on entities.
 *
 * The legacy CSV had 7 stable columns in this exact order:
 *   0=date, 1=type, 2=amount, 3=currency, 4=category, 5=description, 6=counterparty
 *
 * Spec ref: specs/001-autokeep-mvp/data-model.md §v1 → v2 migration.
 */
const migrateV1ToV2: Migration = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  const p = payload as Record<string, unknown>;

  const records = Array.isArray(p['records'])
    ? (p['records'] as Array<Record<string, unknown>>)
    : [];
  const importBatches = Array.isArray(p['importBatches'])
    ? (p['importBatches'] as Array<Record<string, unknown>>)
    : [];
  const categories = Array.isArray(p['categories'])
    ? (p['categories'] as Array<Record<string, unknown>>)
    : [];
  const counterparties = Array.isArray(p['counterparties'])
    ? (p['counterparties'] as Array<Record<string, unknown>>)
    : [];

  const upgradedRecords = records.map((r) => ({
    ...r,
    extraMetadata: r['extraMetadata'] ?? {},
    schemaVersion: 2,
  }));

  const upgradedCategories = categories.map((c) => ({ ...c, schemaVersion: 2 }));
  const upgradedCounterparties = counterparties.map((cp) => ({ ...cp, schemaVersion: 2 }));

  const legacyMapping = {
    0: 'date',
    1: 'type',
    2: 'amount',
    3: 'currency',
    4: 'category',
    5: 'description',
    6: 'counterparty',
  } as const;

  const upgradedBatches = importBatches.map((b) => {
    if (b['outcome'] === 'rejected') {
      return { ...b, schemaVersion: 2 };
    }
    const importedAt =
      typeof b['committedAt'] === 'string'
        ? (b['committedAt'] as string)
        : typeof b['startedAt'] === 'string'
          ? (b['startedAt'] as string)
          : new Date(0).toISOString();
    return {
      ...b,
      schemaVersion: 2,
      inferenceReport: b['inferenceReport'] ?? { columns: [], globalWarnings: [] },
      mappingDecision: b['mappingDecision'] ?? {
        mapping: legacyMapping,
        source: 'auto',
        warnings: [],
        confirmedAt: importedAt,
      },
    };
  });

  return {
    ...p,
    schemaVersion: 2,
    records: upgradedRecords,
    categories: upgradedCategories,
    counterparties: upgradedCounterparties,
    importBatches: upgradedBatches,
  };
};

const migrations: Readonly<Record<number, Migration>> = {
  1: migrateV1ToV2,
  // Future: 2: migrateV2ToV3, etc.
};

const migrate = (payload: unknown, fromVersion: number): unknown => {
  let current = payload;
  let v = fromVersion;
  while (v < CURRENT_SCHEMA_VERSION) {
    const step = migrations[v];
    if (!step) throw new UnsupportedSchemaVersionError(v);
    current = step(current);
    v += 1;
  }
  return current;
};

/* ---------- Helpers ---------- */

const encodeEnvelope = (envelope: EncryptedEnvelope): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(envelope));

const decodeEnvelope = (bytes: Uint8Array): EncryptedEnvelope => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new StorageCorruptError('Stored payload is not valid JSON.', { cause: e });
  }
  if (!isEnvelope(parsed)) {
    throw new StorageCorruptError('Stored payload is not a valid encrypted envelope.');
  }
  return parsed;
};

const isEnvelope = (value: unknown): value is EncryptedEnvelope => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<EncryptedEnvelope>;
  return (
    typeof v.schemaVersion === 'number' &&
    !!v.blob &&
    typeof (v.blob as EncryptedBlob).iv === 'string' &&
    typeof (v.blob as EncryptedBlob).ciphertext === 'string'
  );
};

/* ---------- The store ---------- */

export interface EncryptedStoreDeps {
  readonly adapter: StorageAdapter;
  readonly crypto: CryptoService;
  readonly aad: CryptoAad;
}

export class EncryptedStore {
  private readonly adapter: StorageAdapter;
  private readonly crypto: CryptoService;
  private readonly aad: CryptoAad;

  public constructor(deps: EncryptedStoreDeps) {
    this.adapter = deps.adapter;
    this.crypto = deps.crypto;
    this.aad = deps.aad;
  }

  /** Returns `null` if the key is absent. */
  public async readPayload<T>(key: string): Promise<T | null> {
    const bytes = await this.adapter.get(key);
    if (bytes === null) return null;
    const envelope = decodeEnvelope(bytes);
    const plaintext = await this.crypto.decrypt(envelope.blob, this.aad);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(plaintext));
    } catch (e) {
      throw new StorageCorruptError('Decrypted payload is not valid JSON.', { cause: e });
    }
    return migrate(parsed, envelope.schemaVersion) as T;
  }

  public async writePayload<T>(key: string, value: T): Promise<void> {
    const json = JSON.stringify(value);
    const blob = await this.crypto.encrypt(new TextEncoder().encode(json), this.aad);
    const envelope: EncryptedEnvelope = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      blob,
    };
    await this.adapter.set(key, encodeEnvelope(envelope));
  }

  public async deletePayload(key: string): Promise<void> {
    await this.adapter.delete(key);
  }
}
