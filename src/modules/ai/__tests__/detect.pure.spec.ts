/*
 * Inconsistency detectors — table-driven tests.
 * Node environment; no DOM.
 */

import { describe, it, expect } from 'vitest';

import {
  detectCategoryMismatch,
  detectAmountOutlier,
  detectLikelyDuplicate,
} from '../domain/detect.js';
import type { FinancialRecord } from '../../records/domain/types.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../../records/domain/types.js';

/* ---------- fixture builder ---------- */

let _seq = 0;
function rec(overrides: {
  type?: 'income' | 'expense';
  amount: number;
  categoryId: string;
  description?: string;
  counterpartyId?: string;
  date?: string;
}): FinancialRecord {
  _seq += 1;
  const base = {
    id: toId(`d-${String(_seq)}`),
    date: toIsoDate(overrides.date ?? '2026-01-15'),
    type: overrides.type ?? ('expense' as const),
    amount: toMoneyMinor(overrides.amount),
    categoryId: toId(overrides.categoryId),
    description: overrides.description ?? `Desc ${String(_seq)}`,
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

/* ---------- detectCategoryMismatch ---------- */

describe('detectCategoryMismatch', () => {
  it('returns [] for empty records', () => {
    expect(detectCategoryMismatch([])).toHaveLength(0);
  });

  it('returns [] when all records use the same category per counterparty', () => {
    const records = [
      rec({ amount: 100, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
      rec({ amount: 200, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
      rec({ amount: 300, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
    ];
    expect(detectCategoryMismatch(records)).toHaveLength(0);
  });

  it('flags the outlier record that uses a minority category', () => {
    const records = [
      rec({ amount: 100, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
      rec({ amount: 200, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
      rec({ amount: 300, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
      rec({ amount: 400, categoryId: 'cat-b', counterpartyId: 'cp-x' }), // mismatch
    ];
    const findings = detectCategoryMismatch(records);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('category-mismatch');
    expect(findings[0]?.targetRecordId).toBe(records[3]?.id);
  });

  it('basis array references real record IDs', () => {
    const records = [
      rec({ amount: 100, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
      rec({ amount: 200, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
      rec({ amount: 300, categoryId: 'cat-a', counterpartyId: 'cp-x' }),
      rec({ amount: 400, categoryId: 'cat-b', counterpartyId: 'cp-x' }),
    ];
    const findings = detectCategoryMismatch(records);
    const allIds = new Set(records.map((r) => r.id));
    for (const f of findings) {
      for (const bId of f.basis) {
        expect(allIds.has(bId)).toBe(true);
      }
    }
  });

  it('ignores records without counterpartyId', () => {
    const records = [
      rec({ amount: 100, categoryId: 'cat-a' }),
      rec({ amount: 200, categoryId: 'cat-b' }),
      rec({ amount: 300, categoryId: 'cat-c' }),
    ];
    expect(detectCategoryMismatch(records)).toHaveLength(0);
  });

  it('ignores counterparty with fewer than 3 records', () => {
    const records = [
      rec({ amount: 100, categoryId: 'cat-a', counterpartyId: 'cp-small' }),
      rec({ amount: 200, categoryId: 'cat-b', counterpartyId: 'cp-small' }),
    ];
    expect(detectCategoryMismatch(records)).toHaveLength(0);
  });
});

/* ---------- detectAmountOutlier ---------- */

describe('detectAmountOutlier', () => {
  it('returns [] for empty records', () => {
    expect(detectAmountOutlier([])).toHaveLength(0);
  });

  it('returns [] when all amounts are similar', () => {
    const records = [
      rec({ amount: 1000, categoryId: 'cat-a' }),
      rec({ amount: 1010, categoryId: 'cat-a' }),
      rec({ amount: 990, categoryId: 'cat-a' }),
      rec({ amount: 1005, categoryId: 'cat-a' }),
      rec({ amount: 995, categoryId: 'cat-a' }),
    ];
    expect(detectAmountOutlier(records)).toHaveLength(0);
  });

  it('flags a dramatically high amount as outlier', () => {
    const records = [
      rec({ amount: 100, categoryId: 'cat-a' }),
      rec({ amount: 110, categoryId: 'cat-a' }),
      rec({ amount: 95, categoryId: 'cat-a' }),
      rec({ amount: 105, categoryId: 'cat-a' }),
      rec({ amount: 102, categoryId: 'cat-a' }),
      rec({ amount: 100_000, categoryId: 'cat-a' }), // clear outlier
    ];
    const findings = detectAmountOutlier(records);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.kind).toBe('amount-outlier');
    expect(findings[0]?.targetRecordId).toBe(records[5]?.id);
  });

  it('basis array references real record IDs', () => {
    const records = [
      rec({ amount: 100, categoryId: 'cat-a' }),
      rec({ amount: 110, categoryId: 'cat-a' }),
      rec({ amount: 95, categoryId: 'cat-a' }),
      rec({ amount: 105, categoryId: 'cat-a' }),
      rec({ amount: 102, categoryId: 'cat-a' }),
      rec({ amount: 100_000, categoryId: 'cat-a' }),
    ];
    const findings = detectAmountOutlier(records);
    const allIds = new Set(records.map((r) => r.id));
    for (const f of findings) {
      for (const bId of f.basis) {
        expect(allIds.has(bId)).toBe(true);
      }
    }
  });

  it('ignores category with fewer than 5 records', () => {
    const records = [
      rec({ amount: 1000, categoryId: 'cat-small' }),
      rec({ amount: 1000, categoryId: 'cat-small' }),
      rec({ amount: 100_000, categoryId: 'cat-small' }), // would be outlier with enough records
    ];
    expect(detectAmountOutlier(records)).toHaveLength(0);
  });
});

/* ---------- detectLikelyDuplicate ---------- */

describe('detectLikelyDuplicate', () => {
  it('returns [] for empty records', () => {
    expect(detectLikelyDuplicate([])).toHaveLength(0);
  });

  it('returns [] for a single record', () => {
    const records = [rec({ amount: 1000, categoryId: 'cat-a', description: 'Factura X' })];
    expect(detectLikelyDuplicate(records)).toHaveLength(0);
  });

  it('returns [] when records have different amounts', () => {
    const records = [
      rec({ amount: 1000, categoryId: 'cat-a', description: 'Factura X enero' }),
      rec({ amount: 2000, categoryId: 'cat-a', description: 'Factura X enero' }),
    ];
    expect(detectLikelyDuplicate(records)).toHaveLength(0);
  });

  it('flags likely-duplicate pair — same amount+type, close date, similar description', () => {
    const records = [
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago factura proveedor enero',
        date: '2026-01-10',
      }),
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago factura proveedor enero',
        date: '2026-01-11',
      }),
    ];
    const findings = detectLikelyDuplicate(records);
    expect(findings).toHaveLength(2); // both records flagged
    expect(findings[0]?.kind).toBe('likely-duplicate');
    expect(findings[1]?.kind).toBe('likely-duplicate');
  });

  it('does not flag when dates are more than 2 days apart', () => {
    const records = [
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago factura proveedor',
        date: '2026-01-01',
      }),
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago factura proveedor',
        date: '2026-01-10',
      }),
    ];
    expect(detectLikelyDuplicate(records)).toHaveLength(0);
  });

  it('does not flag when descriptions are very different', () => {
    const records = [
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Factura servicio internet',
        date: '2026-01-01',
      }),
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Sueldo empleado marketing',
        date: '2026-01-01',
      }),
    ];
    expect(detectLikelyDuplicate(records)).toHaveLength(0);
  });

  it('basis in each finding references the other record in the pair', () => {
    const records = [
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago factura proveedor',
        date: '2026-01-10',
      }),
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago factura proveedor',
        date: '2026-01-11',
      }),
    ];
    const findings = detectLikelyDuplicate(records);
    expect(findings[0]?.basis).toContain(records[1]?.id);
    expect(findings[1]?.basis).toContain(records[0]?.id);
  });

  it('findings are deterministic (same input always same output count)', () => {
    const records = [
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago factura proveedor',
        date: '2026-01-10',
      }),
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago factura proveedor',
        date: '2026-01-11',
      }),
    ];
    const run1 = detectLikelyDuplicate(records);
    const run2 = detectLikelyDuplicate(records);
    expect(run1).toHaveLength(run2.length);
  });
});
