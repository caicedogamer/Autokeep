/*
 * CryptoService — main-thread facade for at-rest encryption (FR-040).
 *
 * Responsibilities:
 *  - Owns the KDF worker (lazy-spawned). The worker handles Argon2id
 *    (preferred) and PBKDF2-SHA-256 (fallback); see kdf.worker.ts.
 *  - Holds the derived AES-256-GCM CryptoKey in a closure during the
 *    unlock window. `lock()` clears it.
 *  - Encrypts plaintext blobs with a fresh random 12-byte IV per write
 *    and an authenticated AAD (workspace id + schema version).
 *
 * Constitution Principle V: KDF runs off the main thread.
 * Constitution Principle II: this module has no DOM imports — UI code
 * does not own the key, this service does.
 */

import { AutoKeepError } from '../result.js';
import type { KdfDescriptor, KdfRequest, KdfResponse } from '../workers/messages.js';

/* ---------- Helpers ---------- */

const bytesToBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

export const generateRandomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const generateRandomBase64 = (length: number): string =>
  bytesToBase64(generateRandomBytes(length));

/**
 * TypeScript 5.6+ narrows `Uint8Array` to be generic over its backing buffer
 * (`ArrayBuffer | SharedArrayBuffer`). Web Crypto's `BufferSource` strictly
 * wants `ArrayBuffer`-backed views, so direct `as BufferSource` casts no
 * longer satisfy the compiler when the input is typed as the wider union.
 * This helper bridges through `unknown` at a single, audited point.
 */
const asBufferSource = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

/* ---------- Default KDF parameters (research R6 / OQ-3) ----------
 * Argon2id starting parameters per OWASP guidance for interactive use.
 * TODO(OQ-3): calibrate on the reference profile by running
 *   scripts/calibrate-argon2.ts (Polish phase task T123) and update.
 */

export const DEFAULT_ARGON2ID_PARAMS = {
  memoryKib: 64 * 1024, // 64 MiB
  iterations: 3,
  parallelism: 1,
  hashLength: 32, // AES-256
} as const;

export const DEFAULT_PBKDF2_PARAMS = {
  iterations: 600_000,
  hashLength: 32, // AES-256
} as const;

/** A workspace's authenticated additional data. Bound to ciphertext via AES-GCM. */
export interface CryptoAad {
  readonly workspaceId: string;
  readonly schemaVersion: number;
}

const buildAadBytes = (aad: CryptoAad): Uint8Array =>
  new TextEncoder().encode(`${aad.workspaceId}|${String(aad.schemaVersion)}`);

/* ---------- Typed errors ---------- */

export class CryptoUnlockError extends AutoKeepError {
  public readonly code = 'CRYPTO_UNLOCK';
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class CryptoDecryptError extends AutoKeepError {
  public readonly code = 'CRYPTO_DECRYPT';
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/* ---------- Encrypted blob wire format ---------- */

export interface EncryptedBlob {
  /** AES-GCM IV, 12 bytes recommended, base64-encoded. */
  readonly iv: string;
  /** Ciphertext (includes the GCM tag), base64-encoded. */
  readonly ciphertext: string;
}

/* ---------- Worker-facade interface ---------- */

export interface KdfWorkerLike {
  postMessage(message: KdfRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<KdfResponse>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<KdfResponse>) => void): void;
  terminate(): void;
}

export interface CryptoServiceDeps {
  /**
   * How to construct a fresh KDF worker. Tests inject a mock that
   * speaks the same KdfRequest/KdfResponse contract without spinning
   * an actual Worker (avoids ESM-worker complications under jsdom).
   */
  readonly createKdfWorker: () => KdfWorkerLike;
}

/* ---------- The service ---------- */

export class CryptoService {
  private readonly deps: CryptoServiceDeps;
  private worker: KdfWorkerLike | null = null;
  private unlockedKey: CryptoKey | null = null;
  private nextRequestSeq = 0;

  public constructor(deps: CryptoServiceDeps) {
    this.deps = deps;
  }

  public isUnlocked(): boolean {
    return this.unlockedKey !== null;
  }

  /**
   * Derives an AES-256-GCM CryptoKey from the operator's passphrase via
   * the KDF worker, imports it, and stashes it in memory. Returns the
   * actually-used KDF (may differ from the request if Argon2 fell back).
   */
  public async unlock(passphrase: string, descriptor: KdfDescriptor): Promise<KdfResponse> {
    const response = await this.derive(passphrase, descriptor);
    if (response.kind === 'derive-err') {
      throw new CryptoUnlockError(`Key derivation failed: ${response.reason}`);
    }
    const rawKey = base64ToBytes(response.keyBase64);
    this.unlockedKey = await crypto.subtle.importKey(
      'raw',
      asBufferSource(rawKey),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    // Best-effort wipe of the raw bytes copy we held briefly.
    rawKey.fill(0);
    return response;
  }

  /** Drops the in-memory key. Subsequent encrypt/decrypt will throw. */
  public lock(): void {
    this.unlockedKey = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public async encrypt(plaintext: Uint8Array, aad: CryptoAad): Promise<EncryptedBlob> {
    const key = this.requireKey();
    const iv = generateRandomBytes(12);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: asBufferSource(iv),
          additionalData: asBufferSource(buildAadBytes(aad)),
        },
        key,
        asBufferSource(plaintext),
      ),
    );
    return {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
    };
  }

  public async decrypt(blob: EncryptedBlob, aad: CryptoAad): Promise<Uint8Array> {
    const key = this.requireKey();
    try {
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: asBufferSource(base64ToBytes(blob.iv)),
            additionalData: asBufferSource(buildAadBytes(aad)),
          },
          key,
          asBufferSource(base64ToBytes(blob.ciphertext)),
        ),
      );
      return plaintext;
    } catch (e) {
      // Web Crypto throws OperationError on auth-tag failure — surface it
      // as our typed error so callers never see plaintext on a failed
      // attempt (SC-014, SC-015).
      throw new CryptoDecryptError('AES-GCM decryption failed (wrong key or tampered blob)', {
        cause: e,
      });
    }
  }

  /**
   * Sends a derive request to the worker and resolves with its response.
   * Multiplexes on `requestId` so concurrent derive calls (rare in
   * practice — only `unlock`/`changePassphrase`) don't cross wires.
   */
  private derive(passphrase: string, descriptor: KdfDescriptor): Promise<KdfResponse> {
    const worker = this.ensureWorker();
    const requestId = `kdf-${String(this.nextRequestSeq++)}`;
    return new Promise<KdfResponse>((resolve) => {
      const onMessage = (event: MessageEvent<KdfResponse>): void => {
        if (event.data.requestId !== requestId) return;
        worker.removeEventListener('message', onMessage);
        resolve(event.data);
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({
        kind: 'derive',
        requestId,
        passphrase,
        descriptor,
      });
    });
  }

  private ensureWorker(): KdfWorkerLike {
    if (!this.worker) {
      this.worker = this.deps.createKdfWorker();
    }
    return this.worker;
  }

  private requireKey(): CryptoKey {
    if (!this.unlockedKey) {
      throw new CryptoUnlockError('Workspace is locked.');
    }
    return this.unlockedKey;
  }
}

/**
 * Default factory that spawns the real KDF worker. Used by composition
 * root (`src/main.ts`); tests inject a mock instead.
 */
export const createDefaultKdfWorker = (): KdfWorkerLike =>
  new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' }) as KdfWorkerLike;
