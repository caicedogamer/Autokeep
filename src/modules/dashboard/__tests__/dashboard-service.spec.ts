import { describe, it, expect, vi } from 'vitest';

import { DashboardService, DASHBOARD_RECOMPUTED } from '../services/dashboard-service.js';
import { resolvePreset, customPeriod } from '../domain/period.js';
import { emptyFilterState } from '../../filters/domain/types.js';
import type { FilterState } from '../../filters/domain/types.js';
import type { FinancialRecord } from '../../records/domain/types.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../../records/domain/types.js';

/* ---------- fixtures ---------- */

let _seq = 0;
function rec(overrides: {
  type: 'income' | 'expense';
  amount: number;
  date?: string;
  categoryId?: string;
  counterpartyId?: string;
}): FinancialRecord {
  _seq += 1;
  const base = {
    id: toId(`r-${String(_seq)}`),
    date: toIsoDate(overrides.date ?? '2026-01-15'),
    type: overrides.type,
    amount: toMoneyMinor(overrides.amount),
    categoryId: toId(overrides.categoryId ?? 'cat-a'),
    description: 'test',
    source: 'manual' as const,
    version: 1,
    createdAt: toIsoDateTime('2026-01-15T00:00:00Z'),
    updatedAt: toIsoDateTime('2026-01-15T00:00:00Z'),
    schemaVersion: 1 as const,
  };
  if (overrides.counterpartyId) {
    return { ...base, counterpartyId: toId(overrides.counterpartyId) };
  }
  return base;
}

const PERIOD_JAN = resolvePreset('thisMonth', new Date('2026-01-15'));
const PERIOD_FEB = resolvePreset('thisMonth', new Date('2026-02-15'));

const RECORDS: FinancialRecord[] = [
  rec({ type: 'income', amount: 10_000, date: '2026-01-10' }),
  rec({ type: 'expense', amount: 4_000, date: '2026-01-20' }),
  rec({ type: 'income', amount: 5_000, date: '2026-02-05' }),
];

/* ---------- DashboardService ---------- */

describe('DashboardService', () => {
  it('computes correct totals for a period (US5 acceptance 1)', () => {
    const svc = new DashboardService();
    const vm = svc.compute(RECORDS, PERIOD_JAN, emptyFilterState());

    expect(vm.totals.income).toBe(10_000);
    expect(vm.totals.expenses).toBe(4_000);
    expect(vm.totals.net).toBe(6_000);
    expect(vm.totals.isEmpty).toBe(false);
  });

  it('switching period recomputes all widgets consistently (US5 acceptance 2)', () => {
    const svc = new DashboardService();
    const vmJan = svc.compute(RECORDS, PERIOD_JAN, emptyFilterState());
    const vmFeb = svc.compute(RECORDS, PERIOD_FEB, emptyFilterState());

    // Jan has two records; Feb has one income record
    expect(vmJan.totals.income).toBe(10_000);
    expect(vmFeb.totals.income).toBe(5_000);
    expect(vmFeb.totals.expenses).toBe(0);
    expect(vmJan.period.kind).toBe('thisMonth');
    expect(vmFeb.period.kind).toBe('thisMonth');
  });

  it('active filters narrow the scope (US5 acceptance 3)', () => {
    const svc = new DashboardService();
    const filterIncomeOnly: FilterState = {
      ...emptyFilterState(),
      types: ['income'],
    };
    const vm = svc.compute(RECORDS, PERIOD_JAN, filterIncomeOnly);

    // Only income records in Jan remain
    expect(vm.totals.expenses).toBe(0);
    expect(vm.totals.income).toBe(10_000);
  });

  it('empty period scope returns isEmpty=true on all widgets (US5 acceptance 4 / FR-025)', () => {
    const svc = new DashboardService();
    const emptyPeriod = customPeriod(toIsoDate('2020-01-01'), toIsoDate('2020-01-31'));
    const vm = svc.compute(RECORDS, emptyPeriod, emptyFilterState());

    expect(vm.isEmpty).toBe(true);
    expect(vm.totals.isEmpty).toBe(true);
    expect(vm.evolution.isEmpty).toBe(true);
    expect(vm.topCategories).toHaveLength(0);
    expect(vm.topCounterparties).toHaveLength(0);
  });

  it('emits dashboard:recomputed event to listeners', () => {
    const svc = new DashboardService();
    const listener = vi.fn();
    svc.on(listener);

    svc.compute(RECORDS, PERIOD_JAN, emptyFilterState());

    expect(listener).toHaveBeenCalledOnce();
    const vm = listener.mock.calls[0]?.[0] as ReturnType<typeof svc.compute>;
    expect(vm.totals.income).toBe(10_000);
  });

  it('unsubscribe stops future notifications', () => {
    const svc = new DashboardService();
    const listener = vi.fn();
    const off = svc.on(listener);

    svc.compute(RECORDS, PERIOD_JAN, emptyFilterState());
    off();
    svc.compute(RECORDS, PERIOD_FEB, emptyFilterState());

    expect(listener).toHaveBeenCalledOnce();
  });

  it('DASHBOARD_RECOMPUTED constant matches expected event name', () => {
    expect(DASHBOARD_RECOMPUTED).toBe('dashboard:recomputed');
  });
});
