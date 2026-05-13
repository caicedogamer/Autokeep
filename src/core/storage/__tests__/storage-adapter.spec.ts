import { describe, it, expect } from 'vitest';

import { LocalStorageAdapter } from '../local-storage-adapter.js';
import { StorageQuotaError } from '../storage-adapter.js';
import { runStorageAdapterContract } from './storage-adapter-contract.js';

/* ---------- In-memory Storage mock for isolated tests ---------- */

interface StorageMockOptions {
  /** Maximum total byte length across all stored values; setting beyond throws QuotaExceededError. */
  readonly maxBytes?: number;
}

class StorageMock implements Storage {
  private readonly map = new Map<string, string>();
  private readonly maxBytes: number;
  private readonly throwOnSet: boolean;

  public constructor(options: StorageMockOptions & { throwOnSet?: boolean } = {}) {
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
    this.throwOnSet = options.throwOnSet ?? false;
  }

  public get length(): number {
    return this.map.size;
  }

  public key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  public getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    // Probe writes (used by LocalStorageAdapter to detect Safari private
    // mode) must always succeed so the at-quota mode only fails real
    // application writes — otherwise the constructor never returns.
    const isProbe = key.startsWith('__autokeep_probe_');
    if (this.throwOnSet && !isProbe) {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    }
    let total = value.length;
    for (const [k, v] of this.map) {
      if (k !== key) total += v.length;
    }
    if (total > this.maxBytes && !isProbe) {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    }
    this.map.set(key, value);
  }

  public removeItem(key: string): void {
    this.map.delete(key);
  }

  public clear(): void {
    this.map.clear();
  }
}

/* ---------- Cross-instance pair: shared underlying Storage + BroadcastChannel ---------- */

const broadcastChannelAvailable = typeof globalThis.BroadcastChannel === 'function';

const makeAdapterPair = async (): Promise<{
  a: LocalStorageAdapter;
  b: LocalStorageAdapter;
  cleanup: () => void;
}> => {
  // Two LocalStorageAdapter instances sharing one Storage instance simulates
  // two browser tabs of the same origin.
  const sharedStorage = new StorageMock();
  const a = new LocalStorageAdapter({
    storage: sharedStorage,
    broadcastChannelCtor: globalThis.BroadcastChannel,
  });
  // The shared storage means the second tab "sees" the writes via its
  // BroadcastChannel listener (Node 18+ ships BroadcastChannel as a global).
  const b = new LocalStorageAdapter({
    storage: sharedStorage,
    broadcastChannelCtor: globalThis.BroadcastChannel,
  });
  return {
    a,
    b,
    cleanup: () => {
      a.dispose();
      b.dispose();
    },
  };
};

describe('LocalStorageAdapter', () => {
  runStorageAdapterContract({
    makeAdapter: () =>
      new LocalStorageAdapter({
        storage: new StorageMock(),
        // Disable BroadcastChannel for the default factory so listeners don't leak.
        broadcastChannelCtor: undefined,
      }),
    makeAdapterAtQuota: () =>
      new LocalStorageAdapter({
        storage: new StorageMock({ throwOnSet: true }),
        broadcastChannelCtor: undefined,
      }),
    ...(broadcastChannelAvailable ? { makeAdapterPair } : {}),
  });
});

// Also assert that the typed error import is real (catches refactor breakage).
describe('StorageQuotaError', () => {
  it('extends Error and carries a stable code', () => {
    const e = new StorageQuotaError('test');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('STORAGE_QUOTA');
  });
});
