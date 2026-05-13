import { describe, it, expect, beforeEach } from 'vitest';

import { RecordIndex } from '../services/record-index.js';
import { EMPTY_FILTER, toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../domain/types.js';
import type { FinancialRecord } from '../domain/types.js';

const cat = toId('00000000-0000-0000-0000-000000000001');
const cp = toId('00000000-0000-0000-0000-000000000002');

const rec = (
  id: string,
  overrides: Partial<Omit<FinancialRecord, 'id'>> = {},
): FinancialRecord => ({
  id: toId(id),
  date: toIsoDate('2026-05-01'),
  type: 'income',
  amount: toMoneyMinor(1000),
  categoryId: cat,
  description: 'Venta',
  source: 'manual',
  version: 1,
  createdAt: toIsoDateTime('2026-05-01T10:00:00.000Z'),
  updatedAt: toIsoDateTime('2026-05-01T10:00:00.000Z'),
  schemaVersion: 1,
  ...overrides,
});

const R1 = rec('00000000-0000-0000-0000-000000000010', { date: toIsoDate('2026-05-03') });
const R2 = rec('00000000-0000-0000-0000-000000000011', {
  date: toIsoDate('2026-05-01'),
  type: 'expense',
  amount: toMoneyMinor(500),
});
const R3 = rec('00000000-0000-0000-0000-000000000012', {
  date: toIsoDate('2026-05-02'),
  counterpartyId: cp,
});

let idx: RecordIndex;

beforeEach(() => {
  idx = new RecordIndex();
  idx.rebuild([R1, R2, R3]);
});

describe('RecordIndex', () => {
  it('count returns number of records', () => {
    expect(idx.count()).toBe(3);
  });

  it('all() returns records sorted by date desc', () => {
    const all = idx.all();
    expect(all[0]!.id).toBe(R1.id); // 2026-05-03 first
    expect(all[1]!.id).toBe(R3.id); // 2026-05-02 second
    expect(all[2]!.id).toBe(R2.id); // 2026-05-01 last
  });

  it('get() returns record by id', () => {
    expect(idx.get(R1.id)).toEqual(R1);
  });

  it('has() returns false for missing id', () => {
    expect(idx.has(toId('ffffffff-ffff-ffff-ffff-ffffffffffff'))).toBe(false);
  });

  it('filter() with empty filter returns all records', () => {
    expect(idx.filter(EMPTY_FILTER)).toHaveLength(3);
  });

  it('filter() by type', () => {
    const result = idx.filter({ ...EMPTY_FILTER, types: ['expense'] });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(R2.id);
  });

  it('filter() by dateFrom/dateTo range', () => {
    const result = idx.filter({
      ...EMPTY_FILTER,
      dateFrom: toIsoDate('2026-05-02'),
      dateTo: toIsoDate('2026-05-03'),
    });
    expect(result.map((r) => r.id).sort()).toEqual([R1.id, R3.id].sort());
  });

  it('filter() by amountMax', () => {
    const result = idx.filter({ ...EMPTY_FILTER, amountMax: toMoneyMinor(500) });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(R2.id);
  });

  it('filter() by query (description substring)', () => {
    const result = idx.filter({ ...EMPTY_FILTER, query: 'venta' });
    expect(result).toHaveLength(3); // all have description 'Venta'
  });

  it('filter() by counterpartyIds excludes records without counterparty', () => {
    const result = idx.filter({ ...EMPTY_FILTER, counterpartyIds: [cp] });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(R3.id);
  });

  it('upsert() updates existing record', () => {
    const updated = { ...R1, description: 'Modified' };
    idx.upsert(updated);
    expect(idx.get(R1.id)?.description).toBe('Modified');
    expect(idx.count()).toBe(3);
  });

  it('remove() deletes record from index', () => {
    idx.remove(R1.id);
    expect(idx.count()).toBe(2);
    expect(idx.has(R1.id)).toBe(false);
  });
});
