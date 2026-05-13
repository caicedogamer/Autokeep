/*
 * StorageAdapter contract — see specs/001-autokeep-mvp/contracts/storage-adapter.md.
 *
 * The adapter operates on opaque keys and opaque byte arrays. Encryption
 * sits above the adapter (in EncryptedStore); the adapter NEVER sees
 * plaintext financial data — Constitution Principles II + III.
 */

import { AutoKeepError } from '../result.js';

export interface StorageChangeEvent {
  readonly key: string;
  readonly type: 'changed' | 'cleared';
}

export type StorageChangeHandler = (event: StorageChangeEvent) => void;

export interface StorageAdapter {
  /** Returns the byte array stored under `key`, or `null` if absent. */
  get(key: string): Promise<Uint8Array | null>;

  /** Writes `value` under `key`. Atomic per call. */
  set(key: string, value: Uint8Array): Promise<void>;

  /** Removes `key`. No-op if absent. */
  delete(key: string): Promise<void>;

  /** Lists all keys whose name starts with `prefix`. */
  listKeys(prefix: string): Promise<string[]>;

  /**
   * Returns the implementation's available-capacity estimate in bytes,
   * or `null` if the implementation cannot estimate.
   */
  estimateRemainingBytes(): Promise<number | null>;

  /**
   * Subscribes to cross-context change events for `key`. Returns an
   * `unsubscribe` function. In the localStorage implementation this
   * wraps the `window.storage` event AND fires for same-tab writes via
   * a BroadcastChannel — both contexts must be observable so FR-036
   * (optimistic concurrency) works in either direction.
   */
  subscribe(key: string, handler: StorageChangeHandler): () => void;
}

/* ---------- Typed errors (per the contract) ---------- */

/** Maps to the browser's QuotaExceededError. */
export class StorageQuotaError extends AutoKeepError {
  public readonly code = 'STORAGE_QUOTA';
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** localStorage is disabled (private browsing, policy, or the API itself is null). */
export class StorageUnavailableError extends AutoKeepError {
  public readonly code = 'STORAGE_UNAVAILABLE';
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** A read returned bytes that fail length/base64 checks. */
export class StorageCorruptError extends AutoKeepError {
  public readonly code = 'STORAGE_CORRUPT';
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
