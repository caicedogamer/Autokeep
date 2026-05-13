import { describe, it, expect } from 'vitest';

import {
  matchesQuery,
  matchesDateRange,
  matchesType,
  matchesCategory,
  matchesCounterparty,
  matchesAmountRange,
  applyFilters,
} from '../domain/predicates.js';
import { emptyFilterState } from '../domain/types.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../../records/domain/types.js';
import type { FinancialRecord } from '../../records/domain/types.js';

/* ---------- Fixture ---------- */

const catId = toId('00000000-0000-0000-0000-000000000001');
const cpId = toId('00000000-0000-0000-0000-000000000002');

const base: FinancialRecord = {
  id: toId('00000000-0000-0000-0000-000000000010'),
  date: toIsoDate('2026-05-01'),
  type: 'income',
  amount: toMoneyMinor(1000),
  categoryId: catId,
  description: 'Venta Acme',
  counterpartyId: cpId,
  source: 'manual',
  version: 1,
  createdAt: toIsoDateTime('2026-05-01T10:00:00.000Z'),
  updatedAt: toIsoDateTime('2026-05-01T10:00:00.000Z'),
  schemaVersion: 1,
};

/* ---------- matchesQuery ---------- */

describe('matchesQuery', () => {
  it('empty query matches any record', () => {
    expect(matchesQuery(base, '')).toBe(true);
  });
  it('case-insensitive substring match on description', () => {
    expect(matchesQuery(base, 'acme')).toBe(true);
    expect(matchesQuery(base, 'ACME')).toBe(true);
  });
  it('no match returns false', () => {
    expect(matchesQuery(base, 'xyz')).toBe(false);
  });
});

/* ---------- matchesDateRange ---------- */

describe('matchesDateRange', () => {
  it('null bounds match any date', () => {
    expect(matchesDateRange(base, null, null)).toBe(true);
  });
  it('dateFrom inclusive lower bound', () => {
    expect(matchesDateRange(base, toIsoDate('2026-05-01'), null)).toBe(true);
    expect(matchesDateRange(base, toIsoDate('2026-05-02'), null)).toBe(false);
  });
  it('dateTo inclusive upper bound', () => {
    expect(matchesDateRange(base, null, toIsoDate('2026-05-01'))).toBe(true);
    expect(matchesDateRange(base, null, toIsoDate('2026-04-30'))).toBe(false);
  });
  it('inverted dateFrom > dateTo → treat as no filter (returns true)', () => {
    expect(matchesDateRange(base, toIsoDate('2026-06-01'), toIsoDate('2026-01-01'))).toBe(true);
  });
});

/* ---------- matchesType ---------- */

describe('matchesType', () => {
  it('empty array matches any type', () => {
    expect(matchesType(base, [])).toBe(true);
  });
  it('matches when type is in list', () => {
    expect(matchesType(base, ['income'])).toBe(true);
  });
  it('does not match when type absent from list', () => {
    expect(matchesType(base, ['expense'])).toBe(false);
  });
});

/* ---------- matchesCategory ---------- */

describe('matchesCategory', () => {
  it('empty categoryIds → all pass', () => {
    expect(matchesCategory(base, [])).toBe(true);
  });
  it('matches when categoryId in list', () => {
    expect(matchesCategory(base, [catId])).toBe(true);
  });
  it('misses when categoryId not in list', () => {
    expect(matchesCategory(base, [toId('ffffffff-ffff-ffff-ffff-ffffffffffff')])).toBe(false);
  });
});

/* ---------- matchesCounterparty ---------- */

describe('matchesCounterparty', () => {
  it('empty counterpartyIds → all pass', () => {
    expect(matchesCounterparty(base, [])).toBe(true);
  });
  it('matches when counterpartyId in list', () => {
    expect(matchesCounterparty(base, [cpId])).toBe(true);
  });
  it('no counterpartyId on record → false when list is non-empty', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { counterpartyId: _cp, ...rest } = base;
    const nocp: FinancialRecord = rest as FinancialRecord;
    expect(matchesCounterparty(nocp, [cpId])).toBe(false);
  });
  it('stale counterpartyId (not in list) → false', () => {
    expect(matchesCounterparty(base, [toId('ffffffff-ffff-ffff-ffff-ffffffffffff')])).toBe(false);
  });
});

/* ---------- matchesAmountRange ---------- */

describe('matchesAmountRange', () => {
  it('null bounds → all amounts pass', () => {
    expect(matchesAmountRange(base, null, null)).toBe(true);
  });
  it('amountMin inclusive', () => {
    expect(matchesAmountRange(base, toMoneyMinor(1000), null)).toBe(true);
    expect(matchesAmountRange(base, toMoneyMinor(1001), null)).toBe(false);
  });
  it('amountMax inclusive', () => {
    expect(matchesAmountRange(base, null, toMoneyMinor(1000))).toBe(true);
    expect(matchesAmountRange(base, null, toMoneyMinor(999))).toBe(false);
  });
});

/* ---------- applyFilters ---------- */

describe('applyFilters', () => {
  it('empty filter is structural identity', () => {
    const records: FinancialRecord[] = [
      base,
      { ...base, id: toId('00000000-0000-0000-0000-000000000011') },
    ];
    const result = applyFilters(records, emptyFilterState());
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(records[0]);
    expect(result[1]).toBe(records[1]);
  });

  it('combined type + query filter', () => {
    const expense: FinancialRecord = {
      ...base,
      id: toId('00000000-0000-0000-0000-000000000012'),
      type: 'expense',
      description: 'Gasto oficina',
    };
    const records = [base, expense];
    const result = applyFilters(records, {
      ...emptyFilterState(),
      types: ['expense'],
      query: 'oficina',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(expense.id);
  });

  it('empty result when no record matches', () => {
    const result = applyFilters([base], { ...emptyFilterState(), query: 'xyz-no-match' });
    expect(result).toHaveLength(0);
  });
});
