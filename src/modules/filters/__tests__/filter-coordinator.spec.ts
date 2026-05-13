import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FilterCoordinator } from '../services/filter-coordinator.js';
import { emptyFilterState } from '../domain/types.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../../records/domain/types.js';
import type { FinancialRecord } from '../../records/domain/types.js';

/* ---------- Helpers ---------- */

function makeRecord(i: number): FinancialRecord {
  const id = String(i).padStart(12, '0');
  return {
    id: toId(`00000000-0000-0000-0000-${id}`),
    date: toIsoDate('2026-01-01'),
    type: i % 2 === 0 ? 'income' : 'expense',
    amount: toMoneyMinor(1000 + i),
    categoryId: toId('00000000-0000-0000-0000-000000000001'),
    description: `Record ${String(i)}`,
    source: 'manual',
    version: 1,
    createdAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
    updatedAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
    schemaVersion: 1,
  };
}

const RECORDS_5K: FinancialRecord[] = Array.from({ length: 5_000 }, (_, i) => makeRecord(i));

/* ---------- Suite ---------- */

describe('FilterCoordinator — main-thread fallback (no Worker)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers result synchronously via applyTo()', () => {
    const onResult = vi.fn();
    const coord = new FilterCoordinator(onResult);

    const matched = coord.applyTo(RECORDS_5K);
    // empty filter → all 5 000 pass
    expect(matched).toHaveLength(5_000);
    coord.dispose();
  });

  it('empty filter is structural identity', () => {
    const onResult = vi.fn();
    const coord = new FilterCoordinator(onResult);

    const matched = coord.applyTo(RECORDS_5K);
    expect(matched[0]).toBe(RECORDS_5K[0]);
    expect(matched[4999]).toBe(RECORDS_5K[4999]);
    coord.dispose();
  });

  it('only latest result delivered when flushing after rapid mutations', async () => {
    const results: { ids: readonly string[]; count: number }[] = [];
    const coord = new FilterCoordinator((ids, count) => results.push({ ids, count }));

    coord.setRecords(RECORDS_5K);

    // 100 rapid filter mutations — each scheduleApply but only one flush fires
    for (let i = 0; i < 100; i++) {
      coord.setFilter({
        ...emptyFilterState(),
        types: i % 2 === 0 ? ['income'] : ['expense'],
        query: `Record ${String(i)}`,
      });
    }

    // flush forces dispatch of the LAST state (query: "Record 99", types: ['expense'])
    coord.flush();

    // Only one result callback for the single dispatch
    expect(results).toHaveLength(1);
    // All delivered records must match "Record 99" description (expense)
    for (const id of results[0]!.ids) {
      const rec = RECORDS_5K.find((r) => r.id === id)!;
      expect(rec.description).toContain('Record 99');
      expect(rec.type).toBe('expense');
    }

    coord.dispose();
  });

  it('debounce coalesces rapid setFilter calls into a single dispatch', () => {
    const onResult = vi.fn();
    const coord = new FilterCoordinator(onResult);
    coord.setRecords(RECORDS_5K.slice(0, 10));

    for (let i = 0; i < 50; i++) {
      coord.setFilter({ ...emptyFilterState(), query: String(i) });
    }

    // before debounce fires — no callback yet
    expect(onResult).not.toHaveBeenCalled();

    // advance past debounce window
    vi.advanceTimersByTime(60);

    // only ONE result — the last queued state
    expect(onResult).toHaveBeenCalledTimes(1);

    coord.dispose();
  });

  it('main-thread fallback path returns same predicate results as applyTo()', () => {
    const fallbackResults: { ids: readonly string[]; count: number }[] = [];
    const coord = new FilterCoordinator((ids, count) => fallbackResults.push({ ids, count }));

    const state = { ...emptyFilterState(), types: ['income'] as ['income'] };
    coord.setRecords(RECORDS_5K);
    coord.setFilter(state);
    coord.flush();

    const directResult = coord.applyTo(RECORDS_5K);

    expect(fallbackResults).toHaveLength(1);
    expect(fallbackResults[0]!.count).toBe(directResult.length);
    expect([...fallbackResults[0]!.ids].sort()).toEqual(directResult.map((r) => r.id).sort());

    coord.dispose();
  });

  it('dispose() clears any pending debounce', () => {
    const onResult = vi.fn();
    const coord = new FilterCoordinator(onResult);
    coord.setRecords(RECORDS_5K.slice(0, 5));
    coord.setFilter({ ...emptyFilterState(), query: 'pending' });

    coord.dispose();

    // timer still in queue — advance; callback must NOT fire after dispose
    vi.advanceTimersByTime(200);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('setRecords triggers a new filter pass', () => {
    const onResult = vi.fn();
    const coord = new FilterCoordinator(onResult);
    coord.setFilter({ ...emptyFilterState(), types: ['income'] as ['income'] });

    // first setRecords call
    coord.setRecords(RECORDS_5K.slice(0, 10));
    vi.advanceTimersByTime(60);

    expect(onResult).toHaveBeenCalledTimes(1);
    const firstCount = onResult.mock.calls[0]![1] as number;
    expect(firstCount).toBeGreaterThan(0);

    coord.dispose();
  });

  it('out-of-order responses via flush(): only final requestId wins', () => {
    // Simulate two back-to-back flushes: each dispatch has a unique requestId;
    // the second one increments lastDispatchedId so the first is stale.
    const received: number[] = [];
    const coord = new FilterCoordinator((_ids, count) => received.push(count));
    coord.setRecords(RECORDS_5K.slice(0, 20));

    coord.setFilter({ ...emptyFilterState(), query: 'Record 1' });
    coord.flush(); // requestId = 1, lastDispatchedId = 1 → fires callback

    coord.setFilter({ ...emptyFilterState(), query: 'Record 2' });
    coord.flush(); // requestId = 2, lastDispatchedId = 2 → fires callback

    // Both matched (synchronous fallback, immediate), both delivered
    expect(received).toHaveLength(2);

    coord.dispose();
  });
});
