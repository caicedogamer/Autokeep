/*
 * SC-006 — dashboard totals must be computed to the cent (integer minor units).
 * Pure Node environment; no DOM.
 */

import { describe, it, expect } from 'vitest';

import {
  computeTotals,
  totalIncome,
  totalExpenses,
  net,
  evolution,
  topCategories,
  topCounterparties,
} from '../domain/aggregations.js';
import type { EvolutionResult } from '../domain/aggregations.js';
import { resolvePreset, customPeriod } from '../domain/period.js';
import type { FinancialRecord } from '../../records/domain/types.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../../records/domain/types.js';

/* ---------- fixture builder ---------- */

let _seq = 0;
function makeRecord(overrides: {
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
    description: `Record ${String(_seq)}`,
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

const PERIOD_JAN = customPeriod(toIsoDate('2026-01-01'), toIsoDate('2026-01-31'));

/* ---------- computeTotals ---------- */

describe('computeTotals', () => {
  it('returns isEmpty=true for empty records', () => {
    const r = computeTotals([]);
    expect(r.isEmpty).toBe(true);
    expect(r.income).toBe(0);
    expect(r.expenses).toBe(0);
    expect(r.net).toBe(0);
  });

  it('single income record', () => {
    const r = computeTotals([makeRecord({ type: 'income', amount: 5000 })]);
    expect(r.isEmpty).toBe(false);
    expect(r.income).toBe(5000);
    expect(r.expenses).toBe(0);
    expect(r.net).toBe(5000);
  });

  it('single expense record', () => {
    const r = computeTotals([makeRecord({ type: 'expense', amount: 3000 })]);
    expect(r.isEmpty).toBe(false);
    expect(r.income).toBe(0);
    expect(r.expenses).toBe(3000);
    expect(r.net).toBe(-3000);
  });

  it('mixed records — integer arithmetic (SC-006)', () => {
    const records = [
      makeRecord({ type: 'income', amount: 10000 }),
      makeRecord({ type: 'income', amount: 250 }),
      makeRecord({ type: 'expense', amount: 7530 }),
    ];
    const r = computeTotals(records);
    expect(r.income).toBe(10250);
    expect(r.expenses).toBe(7530);
    expect(r.net).toBe(2720);
    expect(r.isEmpty).toBe(false);
  });

  it('10 000-record stress — correct totals', () => {
    const records: FinancialRecord[] = [];
    for (let i = 0; i < 10_000; i++) {
      records.push(makeRecord({ type: i % 2 === 0 ? 'income' : 'expense', amount: 100 }));
    }
    const r = computeTotals(records);
    expect(r.income).toBe(500_000);
    expect(r.expenses).toBe(500_000);
    expect(r.net).toBe(0);
  });
});

/* ---------- totalIncome / totalExpenses / net ---------- */

describe('totalIncome / totalExpenses / net', () => {
  const records = [
    makeRecord({ type: 'income', amount: 8000 }),
    makeRecord({ type: 'expense', amount: 3000 }),
    makeRecord({ type: 'income', amount: 2000 }),
  ];

  it('totalIncome sums only income records', () => {
    expect(totalIncome(records)).toBe(10_000);
  });

  it('totalExpenses sums only expense records', () => {
    expect(totalExpenses(records)).toBe(3000);
  });

  it('net = income - expenses', () => {
    expect(net(records)).toBe(7000);
  });

  it('all return 0 for empty input', () => {
    expect(totalIncome([])).toBe(0);
    expect(totalExpenses([])).toBe(0);
    expect(net([])).toBe(0);
  });
});

/* ---------- evolution ---------- */

describe('evolution', () => {
  it('isEmpty=true for no records', () => {
    const r: EvolutionResult = evolution([], PERIOD_JAN);
    expect(r.isEmpty).toBe(true);
    expect(r.points).toHaveLength(0);
  });

  it('day granularity for ≤ 31 day period', () => {
    const r = evolution(
      [makeRecord({ type: 'income', amount: 100, date: '2026-01-10' })],
      PERIOD_JAN,
    );
    expect(r.granularity).toBe('day');
    expect(r.points).toHaveLength(1);
    expect(r.points[0]?.label).toBe('2026-01-10');
    expect(r.points[0]?.income).toBe(100);
  });

  it('groups same-day records into one point', () => {
    const records = [
      makeRecord({ type: 'income', amount: 300, date: '2026-01-05' }),
      makeRecord({ type: 'expense', amount: 100, date: '2026-01-05' }),
      makeRecord({ type: 'income', amount: 200, date: '2026-01-05' }),
    ];
    const r = evolution(records, PERIOD_JAN);
    expect(r.points).toHaveLength(1);
    expect(r.points[0]?.income).toBe(500);
    expect(r.points[0]?.expenses).toBe(100);
    expect(r.points[0]?.net).toBe(400);
  });

  it('week granularity for 32–90 day period', () => {
    const period = customPeriod(toIsoDate('2026-01-01'), toIsoDate('2026-03-31'));
    const r = evolution([makeRecord({ type: 'income', amount: 100, date: '2026-01-05' })], period);
    expect(r.granularity).toBe('week');
  });

  it('month granularity for > 90 day period', () => {
    const period = resolvePreset('thisYear', new Date('2026-06-01'));
    const r = evolution([makeRecord({ type: 'income', amount: 100, date: '2026-03-10' })], period);
    expect(r.granularity).toBe('month');
    expect(r.points[0]?.label).toBe('2026-03');
  });

  it('points are sorted chronologically', () => {
    const records = [
      makeRecord({ type: 'income', amount: 100, date: '2026-01-20' }),
      makeRecord({ type: 'income', amount: 100, date: '2026-01-05' }),
      makeRecord({ type: 'income', amount: 100, date: '2026-01-12' }),
    ];
    const r = evolution(records, PERIOD_JAN);
    const labels = r.points.map((p) => p.label);
    expect(labels).toEqual(['2026-01-05', '2026-01-12', '2026-01-20']);
  });
});

/* ---------- topCategories ---------- */

describe('topCategories', () => {
  it('returns empty array for empty records', () => {
    expect(topCategories([], 5)).toHaveLength(0);
  });

  it('ranks by total descending', () => {
    const records = [
      makeRecord({ type: 'expense', amount: 500, categoryId: 'cat-a' }),
      makeRecord({ type: 'expense', amount: 300, categoryId: 'cat-b' }),
      makeRecord({ type: 'income', amount: 1000, categoryId: 'cat-a' }),
    ];
    const ranks = topCategories(records, 2);
    expect(ranks[0]?.categoryId).toBe('cat-a');
    expect(ranks[0]?.total).toBe(1500);
    expect(ranks[1]?.categoryId).toBe('cat-b');
  });

  it('respects n limit', () => {
    const records = [1, 2, 3, 4].map((i) =>
      makeRecord({ type: 'income', amount: i * 100, categoryId: `cat-${String(i)}` }),
    );
    expect(topCategories(records, 2)).toHaveLength(2);
  });
});

/* ---------- topCounterparties ---------- */

describe('topCounterparties', () => {
  it('returns empty array for empty records', () => {
    expect(topCounterparties([], 5)).toHaveLength(0);
  });

  it('skips records without counterpartyId', () => {
    const records = [
      makeRecord({ type: 'income', amount: 1000, counterpartyId: 'cp-a' }),
      makeRecord({ type: 'income', amount: 500 }), // no counterparty
    ];
    const ranks = topCounterparties(records, 5);
    expect(ranks).toHaveLength(1);
    expect(ranks[0]?.counterpartyId).toBe('cp-a');
  });

  it('ranks by total descending', () => {
    const records = [
      makeRecord({ type: 'expense', amount: 200, counterpartyId: 'cp-b' }),
      makeRecord({ type: 'expense', amount: 800, counterpartyId: 'cp-a' }),
      makeRecord({ type: 'income', amount: 100, counterpartyId: 'cp-b' }),
    ];
    const ranks = topCounterparties(records, 5);
    expect(ranks[0]?.counterpartyId).toBe('cp-a');
    expect(ranks[0]?.total).toBe(800);
    expect(ranks[1]?.total).toBe(300);
  });
});
