/*
 * Pure filter predicates for FinancialRecord (US2).
 *
 * No DOM imports. No I/O. All functions are referentially transparent.
 * These run in both the main thread (small datasets, synchronous fallback)
 * and the filter worker (off-thread, SC-002 budget).
 */

import type { FinancialRecord } from '../../records/domain/types.js';
import type { FilterState } from './types.js';

/* ---------- Individual predicates ---------- */

export const matchesQuery = (r: FinancialRecord, query: string): boolean => {
  if (!query) return true;
  const q = query.toLowerCase();
  return r.description.toLowerCase().includes(q);
};

export const matchesDateRange = (
  r: FinancialRecord,
  dateFrom: FilterState['dateFrom'],
  dateTo: FilterState['dateTo'],
): boolean => {
  // If both bounds present and inverted, treat as no date filter.
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) return true;
  if (dateFrom !== null && r.date < dateFrom) return false;
  if (dateTo !== null && r.date > dateTo) return false;
  return true;
};

export const matchesType = (r: FinancialRecord, types: FilterState['types']): boolean =>
  types.length === 0 || types.includes(r.type);

export const matchesCategory = (
  r: FinancialRecord,
  categoryIds: FilterState['categoryIds'],
): boolean => categoryIds.length === 0 || categoryIds.includes(r.categoryId);

export const matchesCounterparty = (
  r: FinancialRecord,
  counterpartyIds: FilterState['counterpartyIds'],
): boolean => {
  if (counterpartyIds.length === 0) return true;
  return r.counterpartyId !== undefined && counterpartyIds.includes(r.counterpartyId);
};

export const matchesAmountRange = (
  r: FinancialRecord,
  amountMin: FilterState['amountMin'],
  amountMax: FilterState['amountMax'],
): boolean => {
  if (amountMin !== null && r.amount < amountMin) return false;
  if (amountMax !== null && r.amount > amountMax) return false;
  return true;
};

/* ---------- Composed predicate ---------- */

/**
 * Returns true iff the record matches all active filter criteria.
 * Short-circuits on first mismatch for performance.
 */
export const matchesAll = (r: FinancialRecord, state: FilterState): boolean =>
  matchesType(r, state.types) &&
  matchesCategory(r, state.categoryIds) &&
  matchesCounterparty(r, state.counterpartyIds) &&
  matchesDateRange(r, state.dateFrom, state.dateTo) &&
  matchesAmountRange(r, state.amountMin, state.amountMax) &&
  matchesQuery(r, state.query);

/**
 * Applies the filter state to a records array.
 * On `emptyFilterState()`, this is a structural identity (same references).
 */
export const applyFilters = (
  records: readonly FinancialRecord[],
  state: FilterState,
): FinancialRecord[] => records.filter((r) => matchesAll(r, state));
