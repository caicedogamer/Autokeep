/*
 * Workspace capacity gate (FR-041 / SC-016).
 *
 *  - records.length <  8000  →  'ok'
 *  - records.length in [8000, 12000)  →  'soft-warning'  (UI shows non-blocking banner)
 *  - records.length >= 12000  →  'hard-cap'  (writes that increase the count are refused)
 *
 * Read paths (filter, dashboard, export, edit, delete) MUST remain
 * available above the hard cap so the operator can recover. The gate
 * does NOT enforce that — it is a pure function returning capacity
 * state. Consumers (records-service, import-service) call this and
 * throw `CapacityExceededError` themselves on count-increasing writes.
 */

import { AutoKeepError } from '../../../core/result.js';

export const CAPACITY_SOFT_WARNING_THRESHOLD = 8_000;
export const CAPACITY_HARD_CAP = 12_000;

export type CapacityState = 'ok' | 'soft-warning' | 'hard-cap';

export const evaluateCapacity = (recordCount: number): CapacityState => {
  if (recordCount >= CAPACITY_HARD_CAP) return 'hard-cap';
  if (recordCount >= CAPACITY_SOFT_WARNING_THRESHOLD) return 'soft-warning';
  return 'ok';
};

/** Throw from a count-increasing write path when this returns true. */
export const wouldExceedHardCap = (currentCount: number, addedRows: number): boolean =>
  currentCount + addedRows > CAPACITY_HARD_CAP;

/** Number of additional rows that would still fit under the hard cap. */
export const remainingCapacity = (currentCount: number): number =>
  Math.max(0, CAPACITY_HARD_CAP - currentCount);

export class CapacityExceededError extends AutoKeepError {
  public readonly code = 'CAPACITY_EXCEEDED';
  public constructor(
    public readonly currentCount: number,
    public readonly attemptedAdded: number,
  ) {
    super(
      `Workspace capacity exceeded: would add ${String(attemptedAdded)} record(s) on top of ${String(
        currentCount,
      )}, hard cap is ${String(CAPACITY_HARD_CAP)}.`,
    );
  }
}
