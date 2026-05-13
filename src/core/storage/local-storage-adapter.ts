/*
 * LocalStorageAdapter — the only StorageAdapter implementation in the MVP
 * (Constitution Principle III: Persistencia Local Primero).
 *
 * Bytes are base64-encoded for localStorage (which only stores strings).
 * Same-tab subscribers are notified via a BroadcastChannel; cross-tab
 * subscribers via the `window.storage` event. Both are needed so FR-036
 * (optimistic concurrency) catches edits in either direction.
 *
 * NOTE: this file is exempted from the project-wide
 * `no-restricted-globals: localStorage` rule because IT IS the seam.
 * Every other module routes through `StorageAdapter`.
 */

import {
  type StorageAdapter,
  type StorageChangeEvent,
  type StorageChangeHandler,
  StorageQuotaError,
  StorageUnavailableError,
} from './storage-adapter.js';

const BROADCAST_CHANNEL_NAME = 'autokeep:storage';

interface BroadcastMessage {
  readonly key: string;
  readonly type: 'changed' | 'cleared';
  /** Identifies the originating LocalStorageAdapter instance so it can ignore its own echo. */
  readonly origin: string;
}

const isQuotaError = (e: unknown): boolean => {
  if (e instanceof DOMException) {
    return (
      e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22
    );
  }
  return false;
};

/**
 * Base64 encode a byte array. We avoid `btoa(String.fromCharCode(...))`
 * over very large arrays (it can blow the call stack), so we chunk.
 */
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
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

export interface LocalStorageAdapterDeps {
  /** Optional override — defaults to `globalThis.localStorage`. Exposed for tests. */
  readonly storage?: Storage;
  /**
   * Optional override for the BroadcastChannel constructor — exposed for tests.
   * If `BroadcastChannel` is not available (very old browser), same-tab
   * notifications are skipped; cross-tab still works via `storage` events.
   */
  readonly broadcastChannelCtor?: typeof BroadcastChannel | undefined;
}

export class LocalStorageAdapter implements StorageAdapter {
  private readonly storage: Storage;
  private readonly origin = `lsa-${Math.random().toString(36).slice(2, 10)}`;
  private readonly subscribers = new Map<string, Set<StorageChangeHandler>>();
  private readonly broadcast: BroadcastChannel | null;
  private readonly windowListener: ((e: StorageEvent) => void) | null;

  public constructor(deps: LocalStorageAdapterDeps = {}) {
    const storage = deps.storage ?? globalThis.localStorage;
    if (!storage) {
      throw new StorageUnavailableError('localStorage is not available in this environment.');
    }
    this.storage = storage;

    // Probe write so we fail fast on Safari private mode (which throws on set).
    try {
      const probeKey = `__autokeep_probe_${this.origin}`;
      this.storage.setItem(probeKey, '1');
      this.storage.removeItem(probeKey);
    } catch (e) {
      throw new StorageUnavailableError('localStorage is present but writes are disabled.', {
        cause: e,
      });
    }

    const Ctor = deps.broadcastChannelCtor ?? globalThis.BroadcastChannel;
    if (typeof Ctor === 'function') {
      const channel = new Ctor(BROADCAST_CHANNEL_NAME);
      channel.addEventListener('message', (e: MessageEvent<BroadcastMessage>) => {
        const message = e.data;
        if (message.origin === this.origin) return; // ignore self
        this.dispatch({ key: message.key, type: message.type });
      });
      this.broadcast = channel;
    } else {
      this.broadcast = null;
    }

    if (typeof globalThis.addEventListener === 'function') {
      this.windowListener = (e: StorageEvent): void => {
        if (e.storageArea !== this.storage) return;
        if (e.key === null) {
          // window.storage with key=null = the foreign tab cleared everything.
          for (const key of [...this.subscribers.keys()]) {
            this.dispatch({ key, type: 'cleared' });
          }
          return;
        }
        this.dispatch({ key: e.key, type: 'changed' });
      };
      globalThis.addEventListener('storage', this.windowListener);
    } else {
      this.windowListener = null;
    }
  }

  public async get(key: string): Promise<Uint8Array | null> {
    const raw = this.storage.getItem(key);
    if (raw === null) return null;
    return base64ToBytes(raw);
  }

  public async set(key: string, value: Uint8Array): Promise<void> {
    const encoded = bytesToBase64(value);
    try {
      this.storage.setItem(key, encoded);
    } catch (e) {
      if (isQuotaError(e)) {
        throw new StorageQuotaError(`localStorage quota exceeded for key "${key}".`, {
          cause: e,
        });
      }
      throw e;
    }
    this.notify(key, 'changed');
  }

  public async delete(key: string): Promise<void> {
    this.storage.removeItem(key);
    this.notify(key, 'changed');
  }

  public async listKeys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (key !== null && key.startsWith(prefix)) {
        out.push(key);
      }
    }
    return out;
  }

  public async estimateRemainingBytes(): Promise<number | null> {
    // localStorage has no standard quota API. The Storage Estimate API
    // applies to the whole origin (across IndexedDB, caches, etc.) and
    // is async; for the MVP we expose it best-effort, returning null
    // when the API is missing.
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return null;
    }
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota === undefined || estimate.usage === undefined) return null;
      return Math.max(0, estimate.quota - estimate.usage);
    } catch {
      return null;
    }
  }

  public subscribe(key: string, handler: StorageChangeHandler): () => void {
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set?.size === 0) this.subscribers.delete(key);
    };
  }

  /** Called by tests / hot-reload to release window + broadcast listeners. */
  public dispose(): void {
    if (this.broadcast) {
      this.broadcast.close();
    }
    if (this.windowListener && typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('storage', this.windowListener);
    }
    this.subscribers.clear();
  }

  private notify(key: string, type: StorageChangeEvent['type']): void {
    // Same-tab broadcast (the `storage` event does NOT fire in the
    // tab that performed the write).
    if (this.broadcast) {
      const message: BroadcastMessage = { key, type, origin: this.origin };
      this.broadcast.postMessage(message);
    }
    // We deliberately do NOT call `dispatch` here for the writing tab —
    // per the contract, same-tab writes do not echo back through `subscribe`.
    // Cross-tab subscribers receive via the window storage event listener.
  }

  private dispatch(event: StorageChangeEvent): void {
    const set = this.subscribers.get(event.key);
    if (!set) return;
    for (const handler of [...set]) {
      handler(event);
    }
  }
}
