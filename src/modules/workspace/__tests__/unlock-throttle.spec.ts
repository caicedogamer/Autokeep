/*
 * SC-015 verification: throttle behaviour on the unlock UI.
 *
 *  - First N-1 failures are allowed without backoff.
 *  - The 5th failure within 60s engages the backoff (1s).
 *  - Continued failures escalate the backoff (2s, 4s, 8s, 16s, cap 30s).
 *  - A successful unlock resets the counter.
 *  - Failures more than 60s apart do NOT accumulate into the threshold.
 *
 * Uses the in-memory `LocalStorageAdapter` mock from the storage-adapter
 * spec so the throttle's persistence path is exercised end-to-end.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { LocalStorageAdapter } from '../../../core/storage/local-storage-adapter.js';
import {
  FAILURE_THRESHOLD,
  FAILURE_WINDOW_MS,
  UnlockThrottle,
} from '../services/unlock-throttle.js';

class StorageMock implements Storage {
  private readonly map = new Map<string, string>();
  public get length(): number {
    return this.map.size;
  }
  public key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  public getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  public setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  public removeItem(k: string): void {
    this.map.delete(k);
  }
  public clear(): void {
    this.map.clear();
  }
}

const makeThrottle = (
  initialNow = 0,
): { throttle: UnlockThrottle; advance: (ms: number) => void; clock: { value: number } } => {
  const adapter = new LocalStorageAdapter({
    storage: new StorageMock(),
    broadcastChannelCtor: undefined,
  });
  const clock = { value: initialNow };
  const throttle = new UnlockThrottle({
    adapter,
    workspaceId: 'ws-test',
    now: () => clock.value,
  });
  const advance = (ms: number): void => {
    clock.value += ms;
  };
  return { throttle, advance, clock };
};

describe('UnlockThrottle (SC-015)', () => {
  let throttle: UnlockThrottle;
  let advance: (ms: number) => void;

  beforeEach(() => {
    ({ throttle, advance } = makeThrottle(1_700_000_000_000));
  });

  it('allows the first attempt with no backoff', async () => {
    expect(await throttle.check()).toEqual({ allowed: true, waitMs: 0, retryAt: null });
  });

  it('does NOT engage backoff for fewer than the threshold of failures inside the window', async () => {
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) {
      const decision = await throttle.recordFailure();
      expect(decision.allowed).toBe(true);
    }
    expect((await throttle.check()).allowed).toBe(true);
  });

  it('engages 1s backoff when the threshold is breached inside the 60s window', async () => {
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) {
      advance(100);
      await throttle.recordFailure();
    }
    advance(100);
    const decision = await throttle.recordFailure();
    expect(decision.allowed).toBe(false);
    expect(decision.waitMs).toBe(1_000);

    // Still blocked just before the wait elapses.
    advance(999);
    const stillBlocked = await throttle.check();
    expect(stillBlocked.allowed).toBe(false);

    // Allowed after the wait elapses.
    advance(1);
    expect((await throttle.check()).allowed).toBe(true);
  });

  it('escalates the backoff on continued failures: 1s → 2s → 4s → 8s → 16s → cap 30s', async () => {
    // Push past the threshold.
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      advance(100);
      await throttle.recordFailure();
    }
    // Walk the ladder.
    const expected = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000];
    for (const wait of expected) {
      advance(wait + 1); // satisfy current backoff so we can attempt again
      const decision = await throttle.recordFailure();
      expect(decision.waitMs).toBe(wait);
    }
  });

  it('resets the counter on successful unlock', async () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      advance(100);
      await throttle.recordFailure();
    }
    expect((await throttle.check()).allowed).toBe(false);
    await throttle.recordSuccess();
    expect((await throttle.check()).allowed).toBe(true);
  });

  it('failures spaced beyond the 60s window do not accumulate to the threshold', async () => {
    for (let i = 0; i < FAILURE_THRESHOLD * 2; i += 1) {
      const decision = await throttle.recordFailure();
      expect(decision.allowed).toBe(true);
      // Move past the window so each failure starts a fresh count of 1.
      advance(FAILURE_WINDOW_MS + 1);
    }
  });

  it('persists across new throttle instances (simulates a page reload)', async () => {
    const adapter = new LocalStorageAdapter({
      storage: new StorageMock(),
      broadcastChannelCtor: undefined,
    });
    const clock = { value: 0 };
    const t1 = new UnlockThrottle({ adapter, workspaceId: 'ws-test', now: () => clock.value });
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      clock.value += 100;
      await t1.recordFailure();
    }
    // New instance reads the persisted state.
    const t2 = new UnlockThrottle({ adapter, workspaceId: 'ws-test', now: () => clock.value });
    expect((await t2.check()).allowed).toBe(false);
  });
});
