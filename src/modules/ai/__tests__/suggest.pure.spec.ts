/*
 * SC-008 — suggestion heuristics: labeled evaluation set.
 * Node environment; no DOM.
 */

import { describe, it, expect } from 'vitest';

import { suggestCategory } from '../domain/suggest.js';
import type { AiSettings } from '../domain/types.js';
import type { FinancialRecord } from '../../records/domain/types.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../../records/domain/types.js';

/* ---------- fixtures ---------- */

let _seq = 0;
function rec(overrides: {
  type?: 'income' | 'expense';
  amount?: number;
  categoryId: string;
  description?: string;
  counterpartyId?: string;
  date?: string;
}): FinancialRecord {
  _seq += 1;
  const base = {
    id: toId(`r-${String(_seq)}`),
    date: toIsoDate(overrides.date ?? '2026-01-10'),
    type: overrides.type ?? ('income' as const),
    amount: toMoneyMinor(overrides.amount ?? 1000),
    categoryId: toId(overrides.categoryId),
    description: overrides.description ?? `Descripción ${String(_seq)}`,
    source: 'manual' as const,
    version: 1,
    createdAt: toIsoDateTime('2026-01-10T00:00:00Z'),
    updatedAt: toIsoDateTime('2026-01-10T00:00:00Z'),
    schemaVersion: 1 as const,
  };
  if (overrides.counterpartyId) {
    return { ...base, counterpartyId: toId(overrides.counterpartyId) };
  }
  return base;
}

const SETTINGS: AiSettings = {
  aiEnabled: true,
  suggestionMinSupport: 3,
  suggestionMinConfidence: 0.6,
};

/* ---------- labeled evaluation set (SC-008) ---------- */

// Pattern: Acme Corp → Servicios (5 records, 100% confidence)
const ACME_HISTORY: FinancialRecord[] = [
  rec({
    categoryId: 'cat-servicios',
    description: 'Factura Acme servicios enero',
    counterpartyId: 'cp-acme',
  }),
  rec({
    categoryId: 'cat-servicios',
    description: 'Factura Acme servicios febrero',
    counterpartyId: 'cp-acme',
  }),
  rec({
    categoryId: 'cat-servicios',
    description: 'Factura Acme servicios marzo',
    counterpartyId: 'cp-acme',
  }),
  rec({
    categoryId: 'cat-servicios',
    description: 'Pago Acme servicios',
    counterpartyId: 'cp-acme',
  }),
  rec({
    categoryId: 'cat-servicios',
    description: 'Acme Corp mensualidad',
    counterpartyId: 'cp-acme',
  }),
];

// Pattern: Renta → Alquiler (5 records, 100% confidence)
const RENTA_HISTORY: FinancialRecord[] = [
  rec({ categoryId: 'cat-alquiler', description: 'Pago renta enero', counterpartyId: 'cp-renta' }),
  rec({
    categoryId: 'cat-alquiler',
    description: 'Pago renta febrero',
    counterpartyId: 'cp-renta',
  }),
  rec({ categoryId: 'cat-alquiler', description: 'Pago renta marzo', counterpartyId: 'cp-renta' }),
  rec({ categoryId: 'cat-alquiler', description: 'Renta mensual', counterpartyId: 'cp-renta' }),
  rec({ categoryId: 'cat-alquiler', description: 'Alquiler oficina', counterpartyId: 'cp-renta' }),
];

const FULL_HISTORY = [...ACME_HISTORY, ...RENTA_HISTORY];

/* ---------- tests ---------- */

describe('suggestCategory', () => {
  it('returns null when aiEnabled=false', () => {
    const result = suggestCategory({ counterpartyId: toId('cp-acme') }, FULL_HISTORY, {
      ...SETTINGS,
      aiEnabled: false,
    });
    expect(result).toBeNull();
  });

  it('returns null for empty history', () => {
    const result = suggestCategory({ counterpartyId: toId('cp-acme') }, [], SETTINGS);
    expect(result).toBeNull();
  });

  it('returns null when support below threshold (sparse history)', () => {
    const sparse: FinancialRecord[] = [
      rec({ categoryId: 'cat-servicios', counterpartyId: 'cp-sparse' }),
      rec({ categoryId: 'cat-servicios', counterpartyId: 'cp-sparse' }),
      // only 2 records — below default minSupport of 3
    ];
    const result = suggestCategory({ counterpartyId: toId('cp-sparse') }, sparse, {
      ...SETTINGS,
      suggestionMinSupport: 5,
    });
    expect(result).toBeNull();
  });

  it('exact-counterparty match: suggests correct category (SC-008 labeled set)', () => {
    const result = suggestCategory(
      { counterpartyId: toId('cp-acme'), description: 'Nueva factura Acme' },
      FULL_HISTORY,
      SETTINGS,
    );
    expect(result).not.toBeNull();
    expect(result?.proposedCategoryId).toBe('cat-servicios');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result?.basis.length).toBeGreaterThan(0);
    expect(result?.basis[0]?.reason).toBe('exact-counterparty');
  });

  it('exact match for second counterparty pattern (SC-008)', () => {
    const result = suggestCategory(
      { counterpartyId: toId('cp-renta'), description: 'Renta de abril' },
      FULL_HISTORY,
      SETTINGS,
    );
    expect(result?.proposedCategoryId).toBe('cat-alquiler');
  });

  it('basis entries reference real record IDs', () => {
    const result = suggestCategory({ counterpartyId: toId('cp-acme') }, FULL_HISTORY, SETTINGS);
    const historyIds = new Set(FULL_HISTORY.map((r) => r.id));
    for (const entry of result?.basis ?? []) {
      expect(historyIds.has(entry.recordId)).toBe(true);
    }
  });

  it('token-overlap fallback: similar descriptions suggest same category', () => {
    // No counterpartyId — must use token overlap
    const history: FinancialRecord[] = Array.from({ length: 5 }, () =>
      rec({
        categoryId: 'cat-suministros',
        description: 'Compra suministros oficina material papelería',
      }),
    );
    const result = suggestCategory(
      { description: 'Suministros papelería oficina' },
      history,
      SETTINGS,
    );
    expect(result).not.toBeNull();
    expect(result?.proposedCategoryId).toBe('cat-suministros');
    expect(result?.basis[0]?.reason).toBe('token-overlap');
  });

  it('returns null when description is empty and no counterpartyId', () => {
    const result = suggestCategory({ description: '' }, FULL_HISTORY, SETTINGS);
    expect(result).toBeNull();
  });

  it('labeled accuracy ≥ 70% across all test patterns (SC-008)', () => {
    const testCases: Array<{ draft: Partial<FinancialRecord>; expectedCategoryId: string }> = [
      { draft: { counterpartyId: toId('cp-acme') }, expectedCategoryId: 'cat-servicios' },
      { draft: { counterpartyId: toId('cp-renta') }, expectedCategoryId: 'cat-alquiler' },
      {
        draft: { counterpartyId: toId('cp-acme'), description: 'Acme mensualidad' },
        expectedCategoryId: 'cat-servicios',
      },
    ];

    let correct = 0;
    for (const { draft, expectedCategoryId } of testCases) {
      const result = suggestCategory(draft, FULL_HISTORY, SETTINGS);
      if (result?.proposedCategoryId === expectedCategoryId) correct++;
    }

    const accuracy = correct / testCases.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.7);
  });
});
