/*
 * Dashboard aggregations — pure functions over already-scoped records (US5).
 *
 * Callers (DashboardService) are responsible for pre-filtering by period and
 * FilterState before passing records here. All money values returned as
 * integer MoneyMinor to satisfy SC-006 (totals to the cent).
 */

import type { FinancialRecord, MoneyMinor, Id } from '../../records/domain/types.js';
import { toMoneyMinor } from '../../records/domain/types.js';
import type { DashboardPeriod } from './period.js';
import { autoGranularity } from './period.js';

/* ---------- result shapes ---------- */

export interface TotalsResult {
  readonly income: MoneyMinor;
  readonly expenses: MoneyMinor;
  readonly net: number;
  /** True when the scoped record set is empty — surfaces the empty-state UI. */
  readonly isEmpty: boolean;
}

export interface EvolutionPoint {
  readonly label: string;
  readonly income: MoneyMinor;
  readonly expenses: MoneyMinor;
  readonly net: number;
}

export interface EvolutionResult {
  readonly granularity: 'day' | 'week' | 'month';
  readonly points: EvolutionPoint[];
  readonly isEmpty: boolean;
}

export interface CategoryRank {
  readonly categoryId: Id;
  readonly total: MoneyMinor;
  readonly count: number;
}

export interface CounterpartyRank {
  readonly counterpartyId: Id;
  readonly total: MoneyMinor;
  readonly count: number;
}

/* ---------- label helpers (not exported; pure) ---------- */

function mondayOf(d: Date): string {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  const y = String(copy.getFullYear());
  const mo = String(copy.getMonth() + 1).padStart(2, '0');
  const dd = String(copy.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

function monthKey(d: Date): string {
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ---------- aggregations ---------- */

export function computeTotals(records: readonly FinancialRecord[]): TotalsResult {
  if (records.length === 0) {
    return { income: toMoneyMinor(0), expenses: toMoneyMinor(0), net: 0, isEmpty: true };
  }
  let income = 0;
  let expenses = 0;
  for (const r of records) {
    if (r.type === 'income') income += r.amount;
    else expenses += r.amount;
  }
  return {
    income: toMoneyMinor(income),
    expenses: toMoneyMinor(expenses),
    net: income - expenses,
    isEmpty: false,
  };
}

/** Convenience direct accessors (also used by round-trip tests). */
export function totalIncome(records: readonly FinancialRecord[]): MoneyMinor {
  let sum = 0;
  for (const r of records) if (r.type === 'income') sum += r.amount;
  return toMoneyMinor(sum);
}

export function totalExpenses(records: readonly FinancialRecord[]): MoneyMinor {
  let sum = 0;
  for (const r of records) if (r.type === 'expense') sum += r.amount;
  return toMoneyMinor(sum);
}

export function net(records: readonly FinancialRecord[]): number {
  let n = 0;
  for (const r of records) n += r.type === 'income' ? r.amount : -(r.amount as number);
  return n;
}

/**
 * Build an evolution series. The `period` is used only for granularity
 * selection; records must already be scoped to that period by the caller.
 */
export function evolution(
  records: readonly FinancialRecord[],
  period: DashboardPeriod,
): EvolutionResult {
  const granularity = autoGranularity(period);

  const buckets = new Map<string, { income: number; expenses: number }>();

  for (const r of records) {
    const d = new Date(r.date as string);
    let key: string;
    if (granularity === 'day') {
      key = r.date as string;
    } else if (granularity === 'week') {
      key = mondayOf(d);
    } else {
      key = monthKey(d);
    }

    const b = buckets.get(key) ?? { income: 0, expenses: 0 };
    if (r.type === 'income') b.income += r.amount;
    else b.expenses += r.amount;
    buckets.set(key, b);
  }

  const points: EvolutionPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([label, { income, expenses }]) => ({
      label,
      income: toMoneyMinor(income),
      expenses: toMoneyMinor(expenses),
      net: income - expenses,
    }));

  return { granularity, points, isEmpty: points.length === 0 };
}

export function topCategories(records: readonly FinancialRecord[], n: number): CategoryRank[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const r of records) {
    const e = map.get(r.categoryId) ?? { total: 0, count: 0 };
    e.total += r.amount;
    e.count += 1;
    map.set(r.categoryId, e);
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, n)
    .map(([categoryId, { total, count }]) => ({
      categoryId: categoryId as Id,
      total: toMoneyMinor(total),
      count,
    }));
}

export function topCounterparties(
  records: readonly FinancialRecord[],
  n: number,
): CounterpartyRank[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const r of records) {
    if (!r.counterpartyId) continue;
    const e = map.get(r.counterpartyId) ?? { total: 0, count: 0 };
    e.total += r.amount;
    e.count += 1;
    map.set(r.counterpartyId, e);
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, n)
    .map(([counterpartyId, { total, count }]) => ({
      counterpartyId: counterpartyId as Id,
      total: toMoneyMinor(total),
      count,
    }));
}
