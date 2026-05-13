/**
 * SC-002 performance budget: filter recompute p95 ≤ 100 ms at 5 000 records,
 * keystroke-to-result latency ≤ 50 ms.
 *
 * Strategy: inject 5 000 records via page.evaluate(), then drive the filter
 * bar and measure wall-clock time inside the page. The test passes if 95 % of
 * 20 sampled mutations complete within budget.
 */

import { test, expect } from '@playwright/test';

import {
  toId,
  toMoneyMinor,
  toIsoDate,
  toIsoDateTime,
} from '../src/modules/records/domain/types.js';
import type { FinancialRecord } from '../src/modules/records/domain/types.js';

function makeRecord(i: number): FinancialRecord {
  const id = String(i).padStart(12, '0');
  return {
    id: toId(`00000000-0000-0000-0000-${id}`),
    date: toIsoDate('2026-01-01'),
    type: i % 2 === 0 ? 'income' : 'expense',
    amount: toMoneyMinor(1000 + i),
    categoryId: toId('00000000-0000-0000-0000-000000000001'),
    description: `Record ${i} description text`,
    source: 'manual',
    version: 1,
    createdAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
    updatedAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
    schemaVersion: 1 as const,
  };
}

const RECORDS_5K: FinancialRecord[] = Array.from({ length: 5_000 }, (_, i) => makeRecord(i));

const SAMPLE_COUNT = 20;
const RECOMPUTE_BUDGET_MS = 100;
const KEYSTROKE_BUDGET_MS = 50;

test.describe('SC-002 filter performance budget', () => {
  test('applyFilters p95 ≤ 100 ms on 5 000 records', async ({ page }) => {
    await page.goto('/');

    // Run the predicate benchmark entirely inside the page context
    const timings = await page.evaluate(
      async ({ records, sampleCount }) => {
        // Dynamically import the predicate from the built bundle
        // @ts-expect-error runtime dynamic import
        const { applyFilters } = await import('/src/modules/filters/domain/predicates.ts');

        const results: number[] = [];
        const queries = ['Record', 'income', 'expense', '100', 'text', 'desc'];
        for (let i = 0; i < sampleCount; i++) {
          const q = queries[i % queries.length]!;
          const state = {
            query: q,
            dateFrom: null,
            dateTo: null,
            types: [],
            categoryIds: [],
            counterpartyIds: [],
            amountMin: null,
            amountMax: null,
          };
          const t0 = performance.now();
          applyFilters(records, state);
          results.push(performance.now() - t0);
        }
        return results;
      },
      { records: RECORDS_5K, sampleCount: SAMPLE_COUNT },
    );

    const sorted = [...timings].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!;

    expect(p95).toBeLessThanOrEqual(RECOMPUTE_BUDGET_MS);
  });

  test('FilterCoordinator flush ≤ 50 ms per keystroke on 5 000 records', async ({ page }) => {
    await page.goto('/');

    const timings = await page.evaluate(
      async ({ records, sampleCount }) => {
        // @ts-expect-error runtime dynamic import
        const { FilterCoordinator } =
          await import('/src/modules/filters/services/filter-coordinator.ts');

        const results: number[] = [];
        let latestCount = 0;
        const coord = new FilterCoordinator((_ids: readonly string[], count: number) => {
          latestCount = count;
        });
        coord.setRecords(records);

        const queries = Array.from({ length: sampleCount }, (_, i) => String(i));
        for (const q of queries) {
          const state = {
            query: q,
            dateFrom: null,
            dateTo: null,
            types: [],
            categoryIds: [],
            counterpartyIds: [],
            amountMin: null,
            amountMax: null,
          };
          const t0 = performance.now();
          coord.setFilter(state);
          coord.flush();
          results.push(performance.now() - t0);
        }
        coord.dispose();
        void latestCount; // prevent tree-shake
        return results;
      },
      { records: RECORDS_5K, sampleCount: SAMPLE_COUNT },
    );

    const sorted = [...timings].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!;

    expect(p95).toBeLessThanOrEqual(KEYSTROKE_BUDGET_MS);
  });
});
