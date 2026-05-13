/*
 * Parameterised contract test suite for any StorageAdapter implementation.
 *
 * Implementations call this from their own spec file:
 *
 *   describe('LocalStorageAdapter', () => {
 *     runStorageAdapterContract(() => new LocalStorageAdapter({ storage: ... }));
 *   });
 *
 * The 7 acceptance tests below mirror the contract in
 * specs/001-autokeep-mvp/contracts/storage-adapter.md.
 */
import { describe, it, expect } from 'vitest';

import type { StorageAdapter, StorageChangeEvent } from '../storage-adapter.js';
import { StorageQuotaError } from '../storage-adapter.js';

export interface ContractFactories {
  /** Build a fresh, isolated adapter for a single test. */
  makeAdapter: () => StorageAdapter;
  /**
   * Build TWO adapters that share the same underlying storage, so the
   * cross-instance subscribe test can simulate two browser tabs.
   * If the implementation cannot honour cross-instance subscriptions in
   * the test environment (e.g. no BroadcastChannel), set this to
   * `undefined` and that test will be skipped with an explanatory log.
   */
  makeAdapterPair?:
    | (() => Promise<{
        a: StorageAdapter;
        b: StorageAdapter;
        cleanup: () => void;
      }>)
    | undefined;
  /**
   * Build an adapter whose underlying storage will throw a quota error
   * on `set`. Used for acceptance test #5. If the implementation cannot
   * deterministically trigger a quota error in tests, return undefined
   * and that test will be skipped.
   */
  makeAdapterAtQuota?: (() => StorageAdapter) | undefined;
}

export const runStorageAdapterContract = (factories: ContractFactories): void => {
  describe('StorageAdapter contract', () => {
    it('1. get() returns null for a key that was never written', async () => {
      const a = factories.makeAdapter();
      expect(await a.get('autokeep:never-written')).toBeNull();
    });

    it('2. set() then get() round-trips bytes exactly, including 0x00', async () => {
      const a = factories.makeAdapter();
      const payload = new Uint8Array([0xff, 0x00, 0x10, 0x00, 0x42, 0xab, 0x00, 0xff]);
      await a.set('autokeep:roundtrip', payload);
      const out = await a.get('autokeep:roundtrip');
      expect(out).not.toBeNull();
      expect(Array.from(out!)).toEqual(Array.from(payload));
    });

    it('3. set() then delete() then get() returns null', async () => {
      const a = factories.makeAdapter();
      await a.set('autokeep:to-delete', new Uint8Array([1, 2, 3]));
      await a.delete('autokeep:to-delete');
      expect(await a.get('autokeep:to-delete')).toBeNull();
    });

    it('4. listKeys(prefix) returns only matching keys and never throws on an empty store', async () => {
      const a = factories.makeAdapter();
      // Empty-store call must not throw.
      const empty = await a.listKeys('autokeep:nope:');
      expect(empty).toEqual([]);

      await a.set('autokeep:ws:1', new Uint8Array([1]));
      await a.set('autokeep:ws:2', new Uint8Array([2]));
      await a.set('autokeep:other:x', new Uint8Array([3]));
      const ws = await a.listKeys('autokeep:ws:');
      expect([...ws].sort()).toEqual(['autokeep:ws:1', 'autokeep:ws:2']);
    });

    if (factories.makeAdapterAtQuota) {
      it('5. throws StorageQuotaError (not a generic Error) when capacity is exceeded', async () => {
        const a = factories.makeAdapterAtQuota!();
        await expect(
          a.set('autokeep:ws:overflow', new Uint8Array([1, 2, 3])),
        ).rejects.toBeInstanceOf(StorageQuotaError);
      });
    } else {
      it.skip('5. quota error path (skipped: implementation cannot trigger quota deterministically in tests)', () => {
        /* skipped */
      });
    }

    if (factories.makeAdapterPair) {
      it('6. subscribe() in a second instance is invoked after a set() from a first instance', async () => {
        const { a, b, cleanup } = await factories.makeAdapterPair!();
        try {
          const seen: StorageChangeEvent[] = [];
          const unsubscribe = b.subscribe('autokeep:ws:cross', (event) => seen.push(event));
          await a.set('autokeep:ws:cross', new Uint8Array([7, 7, 7]));
          // Allow the broadcast / storage event to flush.
          await new Promise((resolve) => setTimeout(resolve, 20));
          unsubscribe();
          expect(seen.length).toBeGreaterThanOrEqual(1);
          expect(seen[0]?.key).toBe('autokeep:ws:cross');
          expect(seen[0]?.type).toBe('changed');
        } finally {
          cleanup();
        }
      });
    } else {
      it.skip('6. cross-instance subscribe (skipped: BroadcastChannel not available in this test environment)', () => {
        /* skipped */
      });
    }

    it('7. estimateRemainingBytes returns a non-negative integer or null and never throws', async () => {
      const a = factories.makeAdapter();
      const estimate = await a.estimateRemainingBytes();
      if (estimate !== null) {
        expect(Number.isFinite(estimate)).toBe(true);
        expect(estimate).toBeGreaterThanOrEqual(0);
      }
    });
  });
};
