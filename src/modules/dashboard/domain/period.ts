/*
 * DashboardPeriod — value object + preset resolvers for US5.
 *
 * All arithmetic is pure date math; no DOM, no I/O.
 * `from` and `to` are both inclusive ISO-8601 dates.
 */

import type { IsoDate } from '../../records/domain/types.js';
import { toIsoDate } from '../../records/domain/types.js';

export type DashboardPeriodKind =
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'thisYear'
  | 'custom';

export interface DashboardPeriod {
  readonly kind: DashboardPeriodKind;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/* ---------- helpers ---------- */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(d: Date): IsoDate {
  return toIsoDate(`${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

/* ---------- preset resolvers ---------- */

/** Pass an optional `ref` date for testability; defaults to `new Date()`. */
export function resolvePreset(
  kind: Exclude<DashboardPeriodKind, 'custom'>,
  ref?: Date,
): DashboardPeriod {
  const now = ref ?? new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  if (kind === 'thisMonth') {
    return { kind, from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
  }
  if (kind === 'lastMonth') {
    return { kind, from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
  }
  if (kind === 'thisQuarter') {
    const qStart = Math.floor(m / 3) * 3;
    return { kind, from: ymd(new Date(y, qStart, 1)), to: ymd(new Date(y, qStart + 3, 0)) };
  }
  if (kind === 'lastQuarter') {
    const qStart = Math.floor(m / 3) * 3 - 3;
    return { kind, from: ymd(new Date(y, qStart, 1)), to: ymd(new Date(y, qStart + 3, 0)) };
  }
  // thisYear
  return {
    kind,
    from: toIsoDate(`${String(y)}-01-01`),
    to: toIsoDate(`${String(y)}-12-31`),
  };
}

export function customPeriod(from: IsoDate, to: IsoDate): DashboardPeriod {
  return { kind: 'custom', from, to };
}

/* ---------- utilities ---------- */

/** Inclusive containment check. */
export function periodContainsDate(period: DashboardPeriod, date: IsoDate): boolean {
  return date >= period.from && date <= period.to;
}

/**
 * Auto-select chart granularity based on period span:
 *  ≤ 31 days → day
 *  ≤ 90 days → week
 *  > 90 days → month
 */
export function autoGranularity(period: DashboardPeriod): 'day' | 'week' | 'month' {
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  const days = Math.round((toMs - fromMs) / 86_400_000) + 1;
  if (days <= 31) return 'day';
  if (days <= 90) return 'week';
  return 'month';
}
