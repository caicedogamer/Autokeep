/*
 * Unlock-attempt throttle (FR-040 / SC-015 / research R6).
 *
 * Behaviour:
 *  - Tracks consecutive failed unlock attempts in a 60-second sliding
 *    window. Successful unlock clears the counter.
 *  - After 5 failures within 60 s, the next attempt is blocked until a
 *    backoff has elapsed: 1s → 2s → 4s → 8s → 16s → cap 30s. The
 *    backoff continues to grow until a successful unlock.
 *  - State is persisted via StorageAdapter under
 *    `autokeep:ws:<id>:throttle` so reloads don't reset it.
 *
 * Cryptographic note: this is a UX guard, not a security mechanism.
 * An attacker can clear localStorage between attempts. The defense in
 * depth is the strong KDF parameters in FR-040.
 */

import type { StorageAdapter } from '../../../core/storage/storage-adapter.js';
import { workspaceThrottleKey } from '../domain/keys.js';

export const FAILURE_WINDOW_MS = 60_000;
export const FAILURE_THRESHOLD = 5;
const BACKOFF_LADDER_MS: readonly number[] = [
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
  30_000, // cap; further escalations stay at 30 s
];

interface PersistedThrottleState {
  /** ISO-8601 UTC. Most recent failed attempt. Empty string ⇒ none. */
  readonly lastFailureAt: string;
  /** Failures inside the rolling 60s window ending at lastFailureAt. */
  readonly failuresInWindow: number;
  /** How many threshold-breaching events have happened since the last success. */
  readonly escalationCount: number;
}

const EMPTY_STATE: PersistedThrottleState = {
  lastFailureAt: '',
  failuresInWindow: 0,
  escalationCount: 0,
};

const encode = (state: PersistedThrottleState): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(state));

const decode = (bytes: Uint8Array): PersistedThrottleState => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PersistedThrottleState>;
    return {
      lastFailureAt: typeof parsed.lastFailureAt === 'string' ? parsed.lastFailureAt : '',
      failuresInWindow: typeof parsed.failuresInWindow === 'number' ? parsed.failuresInWindow : 0,
      escalationCount: typeof parsed.escalationCount === 'number' ? parsed.escalationCount : 0,
    };
  } catch {
    return EMPTY_STATE;
  }
};

const backoffMs = (escalationCount: number): number => {
  if (escalationCount <= 0) return 0;
  const idx = Math.min(escalationCount - 1, BACKOFF_LADDER_MS.length - 1);
  return BACKOFF_LADDER_MS[idx] ?? 0;
};

export interface ThrottleDecision {
  /** True iff the operator may attempt unlock right now. */
  readonly allowed: boolean;
  /** When `allowed` is false, ms remaining until the next attempt is allowed. */
  readonly waitMs: number;
  /** When `allowed` is false, the wall-clock time at which the next attempt is allowed. */
  readonly retryAt: Date | null;
}

export interface UnlockThrottleDeps {
  readonly adapter: StorageAdapter;
  readonly workspaceId: string;
  /** Injectable for tests. Defaults to `() => Date.now()`. */
  readonly now?: () => number;
}

export class UnlockThrottle {
  private readonly adapter: StorageAdapter;
  private readonly key: string;
  private readonly now: () => number;

  public constructor(deps: UnlockThrottleDeps) {
    this.adapter = deps.adapter;
    this.key = workspaceThrottleKey(deps.workspaceId);
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Returns the gate decision for an unlock attempt at "now".
   */
  public async check(): Promise<ThrottleDecision> {
    const state = await this.read();
    if (state.escalationCount === 0) {
      return { allowed: true, waitMs: 0, retryAt: null };
    }
    const last = state.lastFailureAt ? Date.parse(state.lastFailureAt) : 0;
    const wait = backoffMs(state.escalationCount);
    const earliest = last + wait;
    const now = this.now();
    if (now >= earliest) {
      return { allowed: true, waitMs: 0, retryAt: null };
    }
    return {
      allowed: false,
      waitMs: earliest - now,
      retryAt: new Date(earliest),
    };
  }

  /**
   * Records a failed unlock attempt. Returns the post-attempt decision
   * for callers that want to immediately render the next-allowed time.
   */
  public async recordFailure(): Promise<ThrottleDecision> {
    const state = await this.read();
    const now = this.now();
    const last = state.lastFailureAt ? Date.parse(state.lastFailureAt) : 0;
    const inWindow = last !== 0 && now - last < FAILURE_WINDOW_MS;
    const failuresInWindow = inWindow ? state.failuresInWindow + 1 : 1;
    let escalationCount = state.escalationCount;
    if (failuresInWindow >= FAILURE_THRESHOLD) {
      escalationCount += 1;
    }
    const next: PersistedThrottleState = {
      lastFailureAt: new Date(now).toISOString(),
      failuresInWindow,
      escalationCount,
    };
    await this.write(next);
    if (escalationCount === 0) {
      return { allowed: true, waitMs: 0, retryAt: null };
    }
    const wait = backoffMs(escalationCount);
    return {
      allowed: false,
      waitMs: wait,
      retryAt: new Date(now + wait),
    };
  }

  /** Resets the counter on a successful unlock. */
  public async recordSuccess(): Promise<void> {
    await this.write(EMPTY_STATE);
  }

  private async read(): Promise<PersistedThrottleState> {
    const bytes = await this.adapter.get(this.key);
    if (bytes === null) return EMPTY_STATE;
    return decode(bytes);
  }

  private async write(state: PersistedThrottleState): Promise<void> {
    await this.adapter.set(this.key, encode(state));
  }
}
