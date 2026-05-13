/*
 * WorkspaceService — lifecycle for the encrypted workspace blob.
 *
 *   createWorkspace   — first-run flow: choose name/currency/locale + passphrase,
 *                       generate a per-workspace KDF salt, derive the key,
 *                       write the empty `WorkspacePayloadV1` envelope and
 *                       the non-secret meta record. Updates the workspaces
 *                       index. Returns the unlocked CryptoService + EncryptedStore.
 *   unlockWorkspace   — read the meta record (KDF descriptor), prompt for
 *                       the passphrase, derive, attempt to decrypt the
 *                       payload. On failure DOES NOT decrypt anything;
 *                       caller composes with UnlockThrottle to apply
 *                       SC-015 backoff.
 *   changePassphrase  — re-derive a new key with a new salt, decrypt the
 *                       blob with the old key, re-encrypt with the new
 *                       key, write back atomically. Updates the meta record.
 *   lockWorkspace     — drops the in-memory key.
 *   listWorkspaces    — reads the (unencrypted) index for the unlock-screen.
 *
 * No DOM imports. UI lives in `src/modules/workspace/ui/` (Phase 9).
 */

import { AutoKeepError } from '../../../core/result.js';
import {
  CryptoDecryptError,
  CryptoService,
  DEFAULT_ARGON2ID_PARAMS,
  generateRandomBase64,
  type CryptoAad,
} from '../../../core/crypto/crypto-service.js';
import { EncryptedStore, CURRENT_SCHEMA_VERSION } from '../../../core/storage/encrypted-store.js';
import type { StorageAdapter } from '../../../core/storage/storage-adapter.js';
import type { KdfDescriptor } from '../../../core/workers/messages.js';
import { workspaceBlobKey, workspaceMetaKey, workspacesIndexKey } from '../domain/keys.js';

/* ---------- Persisted shapes ---------- */

export interface WorkspaceMeta {
  readonly schemaVersion: number;
  readonly kdf: KdfDescriptor;
}

export interface WorkspaceIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly lastOpenedAt: string; // ISO-8601 UTC
}

export interface WorkspacesIndex {
  readonly schemaVersion: 1;
  readonly entries: readonly WorkspaceIndexEntry[];
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly currencyMinorUnits: 0 | 2 | 3;
  readonly locale: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly schemaVersion: 1;
}

/**
 * Initial empty payload written on workspace creation. Mirrors the
 * `WorkspacePayloadV1` shape from data-model.md, with the per-module
 * collections empty until their respective modules first persist.
 */
export interface WorkspacePayloadV1 {
  readonly schemaVersion: 1;
  readonly workspace: Workspace;
  readonly records: readonly unknown[];
  readonly categories: readonly unknown[];
  readonly counterparties: readonly unknown[];
  readonly importBatches: readonly unknown[];
  readonly inconsistencies: readonly unknown[];
  readonly settings: {
    readonly aiEnabled: boolean;
    readonly suggestionMinSupport: number;
    readonly suggestionMinConfidence: number;
  };
}

/* ---------- Errors ---------- */

export class WorkspaceNotFoundError extends AutoKeepError {
  public readonly code = 'WORKSPACE_NOT_FOUND';
}

export class WorkspaceUnlockFailedError extends AutoKeepError {
  public readonly code = 'WORKSPACE_UNLOCK_FAILED';
}

/* ---------- Helpers ---------- */

const decodeJson = <T>(bytes: Uint8Array): T => {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
};

const encodeJson = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

const buildAad = (workspaceId: string): CryptoAad => ({
  workspaceId,
  schemaVersion: CURRENT_SCHEMA_VERSION,
});

const newWorkspaceId = (): string =>
  // Browser: crypto.randomUUID(). Node tests have it via webcrypto.
  globalThis.crypto.randomUUID();

const newKdfDescriptor = (): KdfDescriptor => ({
  name: 'argon2id',
  // 16 raw bytes → 24 base64 chars; sufficient for KDF salt.
  salt: generateRandomBase64(16),
  params: { ...DEFAULT_ARGON2ID_PARAMS },
});

const initialPayload = (workspace: Workspace): WorkspacePayloadV1 => ({
  schemaVersion: 1,
  workspace,
  records: [],
  categories: [],
  counterparties: [],
  importBatches: [],
  inconsistencies: [],
  settings: {
    aiEnabled: true,
    suggestionMinSupport: 5,
    suggestionMinConfidence: 0.6,
  },
});

/* ---------- The service ---------- */

export interface WorkspaceServiceDeps {
  readonly adapter: StorageAdapter;
  readonly cryptoFactory: () => CryptoService;
}

export interface UnlockedWorkspace {
  readonly workspaceId: string;
  readonly meta: WorkspaceMeta;
  readonly payload: WorkspacePayloadV1;
  readonly store: EncryptedStore;
  readonly crypto: CryptoService;
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly currency: string;
  readonly currencyMinorUnits: 0 | 2 | 3;
  readonly locale: string;
  readonly passphrase: string;
}

export class WorkspaceService {
  private readonly deps: WorkspaceServiceDeps;

  public constructor(deps: WorkspaceServiceDeps) {
    this.deps = deps;
  }

  public async listWorkspaces(): Promise<readonly WorkspaceIndexEntry[]> {
    const bytes = await this.deps.adapter.get(workspacesIndexKey());
    if (bytes === null) return [];
    const index = decodeJson<WorkspacesIndex>(bytes);
    return index.entries;
  }

  public async createWorkspace(input: CreateWorkspaceInput): Promise<UnlockedWorkspace> {
    const workspaceId = newWorkspaceId();
    const kdf = newKdfDescriptor();
    const meta: WorkspaceMeta = { schemaVersion: CURRENT_SCHEMA_VERSION, kdf };

    const crypto = this.deps.cryptoFactory();
    const usedKdf = await crypto.unlock(input.passphrase, kdf);
    // If Argon2 fell back to PBKDF2 we MUST persist that so future unlocks
    // reproduce the same derivation.
    const persistedKdf: KdfDescriptor =
      usedKdf.kind === 'derive-ok' && usedKdf.used !== kdf.name
        ? this.coerceDescriptorTo(kdf, usedKdf.used)
        : kdf;
    const persistedMeta: WorkspaceMeta = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kdf: persistedKdf,
    };

    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: workspaceId,
      name: input.name.trim(),
      currency: input.currency,
      currencyMinorUnits: input.currencyMinorUnits,
      locale: input.locale,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
    const payload = initialPayload(workspace);

    const store = new EncryptedStore({
      adapter: this.deps.adapter,
      crypto,
      aad: buildAad(workspaceId),
    });

    await this.deps.adapter.set(workspaceMetaKey(workspaceId), encodeJson(persistedMeta));
    await store.writePayload(workspaceBlobKey(workspaceId), payload);
    await this.appendToIndex({
      id: workspaceId,
      name: workspace.name,
      lastOpenedAt: now,
    });

    void meta; // silence unused-temp warning; preserved for symmetry
    return { workspaceId, meta: persistedMeta, payload, store, crypto };
  }

  public async unlockWorkspace(
    workspaceId: string,
    passphrase: string,
  ): Promise<UnlockedWorkspace> {
    const metaBytes = await this.deps.adapter.get(workspaceMetaKey(workspaceId));
    if (metaBytes === null) throw new WorkspaceNotFoundError(`Workspace ${workspaceId} not found.`);
    const meta = decodeJson<WorkspaceMeta>(metaBytes);

    const crypto = this.deps.cryptoFactory();
    await crypto.unlock(passphrase, meta.kdf);

    const store = new EncryptedStore({
      adapter: this.deps.adapter,
      crypto,
      aad: buildAad(workspaceId),
    });
    let payload: WorkspacePayloadV1 | null;
    try {
      payload = await store.readPayload<WorkspacePayloadV1>(workspaceBlobKey(workspaceId));
    } catch (e) {
      if (e instanceof CryptoDecryptError) {
        crypto.lock();
        throw new WorkspaceUnlockFailedError('Wrong passphrase or tampered payload.', {
          cause: e,
        });
      }
      throw e;
    }
    if (payload === null) {
      throw new WorkspaceNotFoundError(`Workspace ${workspaceId} blob is missing.`);
    }
    await this.touchIndex(workspaceId);
    return { workspaceId, meta, payload, store, crypto };
  }

  public async lockWorkspace(unlocked: UnlockedWorkspace): Promise<void> {
    unlocked.crypto.lock();
    return Promise.resolve();
  }

  /**
   * Re-derives a key from the new passphrase under a fresh salt, decrypts
   * the current payload with the old (still-unlocked) key, re-encrypts
   * with the new key, and writes back. Returns a freshly-unlocked
   * UnlockedWorkspace bound to the new key.
   */
  public async changePassphrase(
    unlocked: UnlockedWorkspace,
    newPassphrase: string,
  ): Promise<UnlockedWorkspace> {
    // 1. Read current plaintext payload (with the current key).
    const currentPayload = await unlocked.store.readPayload<WorkspacePayloadV1>(
      workspaceBlobKey(unlocked.workspaceId),
    );
    if (currentPayload === null) {
      throw new WorkspaceNotFoundError(
        `Workspace ${unlocked.workspaceId} blob disappeared during changePassphrase.`,
      );
    }
    // 2. Build a fresh KDF descriptor and derive a new key in a fresh service.
    const newKdf = newKdfDescriptor();
    const newCrypto = this.deps.cryptoFactory();
    const usedKdf = await newCrypto.unlock(newPassphrase, newKdf);
    const persistedKdf: KdfDescriptor =
      usedKdf.kind === 'derive-ok' && usedKdf.used !== newKdf.name
        ? this.coerceDescriptorTo(newKdf, usedKdf.used)
        : newKdf;
    const newMeta: WorkspaceMeta = { schemaVersion: CURRENT_SCHEMA_VERSION, kdf: persistedKdf };
    const newStore = new EncryptedStore({
      adapter: this.deps.adapter,
      crypto: newCrypto,
      aad: buildAad(unlocked.workspaceId),
    });
    // 3. Write new meta + re-encrypted payload.
    await this.deps.adapter.set(workspaceMetaKey(unlocked.workspaceId), encodeJson(newMeta));
    await newStore.writePayload(workspaceBlobKey(unlocked.workspaceId), currentPayload);
    // 4. Drop the old in-memory key.
    unlocked.crypto.lock();
    return {
      workspaceId: unlocked.workspaceId,
      meta: newMeta,
      payload: currentPayload,
      store: newStore,
      crypto: newCrypto,
    };
  }

  /* ---------- Private ---------- */

  private async appendToIndex(entry: WorkspaceIndexEntry): Promise<void> {
    const current = await this.readIndex();
    const filtered = current.entries.filter((e) => e.id !== entry.id);
    const next: WorkspacesIndex = {
      schemaVersion: 1,
      entries: [...filtered, entry],
    };
    await this.deps.adapter.set(workspacesIndexKey(), encodeJson(next));
  }

  private async touchIndex(workspaceId: string): Promise<void> {
    const current = await this.readIndex();
    const now = new Date().toISOString();
    const next: WorkspacesIndex = {
      schemaVersion: 1,
      entries: current.entries.map((e) => (e.id === workspaceId ? { ...e, lastOpenedAt: now } : e)),
    };
    await this.deps.adapter.set(workspacesIndexKey(), encodeJson(next));
  }

  private async readIndex(): Promise<WorkspacesIndex> {
    const bytes = await this.deps.adapter.get(workspacesIndexKey());
    if (bytes === null) return { schemaVersion: 1, entries: [] };
    return decodeJson<WorkspacesIndex>(bytes);
  }

  /**
   * If the requested KDF was Argon2id but the worker fell back to
   * PBKDF2-SHA-256, build the descriptor that actually matches what was
   * used so future unlocks pick the same derivation.
   */
  private coerceDescriptorTo(
    requested: KdfDescriptor,
    used: 'argon2id' | 'pbkdf2-sha256',
  ): KdfDescriptor {
    if (used === requested.name) return requested;
    if (used === 'pbkdf2-sha256') {
      return {
        name: 'pbkdf2-sha256',
        salt: requested.salt,
        params: { iterations: 600_000, hashLength: 32 },
      };
    }
    // We don't auto-promote to argon2id; the worker's response would say so explicitly.
    return requested;
  }
}
