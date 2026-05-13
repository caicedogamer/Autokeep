/*
 * SC-016 verification at the pure-function level.
 *
 * Thresholds (FR-041):
 *   < 8000        → ok
 *   8000..11999   → soft-warning
 *   >= 12000      → hard-cap
 *
 * `wouldExceedHardCap` is the predicate import-service / records-service
 * use to decide whether to throw `CapacityExceededError` on a write.
 */
import { describe, it, expect } from 'vitest';

import {
  CAPACITY_HARD_CAP,
  CAPACITY_SOFT_WARNING_THRESHOLD,
  CapacityExceededError,
  evaluateCapacity,
  remainingCapacity,
  wouldExceedHardCap,
} from '../services/capacity-gate.js';

describe('evaluateCapacity (FR-041 / SC-016)', () => {
  it('returns "ok" strictly below the soft-warning threshold', () => {
    expect(evaluateCapacity(0)).toBe('ok');
    expect(evaluateCapacity(1)).toBe('ok');
    expect(evaluateCapacity(7_999)).toBe('ok');
  });

  it('returns "soft-warning" between the soft threshold (inclusive) and the hard cap (exclusive)', () => {
    expect(evaluateCapacity(CAPACITY_SOFT_WARNING_THRESHOLD)).toBe('soft-warning');
    expect(evaluateCapacity(8_001)).toBe('soft-warning');
    expect(evaluateCapacity(11_999)).toBe('soft-warning');
  });

  it('returns "hard-cap" at and above the hard cap', () => {
    expect(evaluateCapacity(CAPACITY_HARD_CAP)).toBe('hard-cap');
    expect(evaluateCapacity(12_001)).toBe('hard-cap');
    expect(evaluateCapacity(50_000)).toBe('hard-cap');
  });
});

describe('wouldExceedHardCap', () => {
  it('returns false when the new total stays within the cap', () => {
    expect(wouldExceedHardCap(0, 1)).toBe(false);
    expect(wouldExceedHardCap(11_999, 1)).toBe(false); // exactly at cap is allowed
    expect(wouldExceedHardCap(7_000, 5_000)).toBe(false); // 12_000 = cap, allowed
  });

  it('returns true when the new total would exceed the cap', () => {
    expect(wouldExceedHardCap(11_999, 2)).toBe(true);
    expect(wouldExceedHardCap(CAPACITY_HARD_CAP, 1)).toBe(true);
    expect(wouldExceedHardCap(0, CAPACITY_HARD_CAP + 1)).toBe(true);
  });
});

describe('remainingCapacity', () => {
  it('returns the rows-until-hard-cap and never goes negative', () => {
    expect(remainingCapacity(0)).toBe(CAPACITY_HARD_CAP);
    expect(remainingCapacity(8_000)).toBe(4_000);
    expect(remainingCapacity(CAPACITY_HARD_CAP)).toBe(0);
    expect(remainingCapacity(CAPACITY_HARD_CAP + 500)).toBe(0);
  });
});

describe('CapacityExceededError', () => {
  it('carries the stable code and the attempted counts', () => {
    const e = new CapacityExceededError(12_000, 1);
    expect(e.code).toBe('CAPACITY_EXCEEDED');
    expect(e.currentCount).toBe(12_000);
    expect(e.attemptedAdded).toBe(1);
    expect(e.message).toContain('12000');
  });
});

/**
 * SC-016 acceptance scenario, expressed as a tiny harness around the
 * gate that mimics what a write path will do.
 */
describe('SC-016 acceptance: write paths obey the gate', () => {
  const attemptCreate = (currentCount: number): void => {
    if (wouldExceedHardCap(currentCount, 1)) {
      throw new CapacityExceededError(currentCount, 1);
    }
  };

  it('allows a create at 11_999 (lands at exactly 12_000)', () => {
    expect(() => attemptCreate(11_999)).not.toThrow();
  });

  it('blocks a create at 12_000 with CapacityExceededError (not a generic Error)', () => {
    expect(() => attemptCreate(12_000)).toThrowError(CapacityExceededError);
  });
});
