/*
 * Filter domain types for the filters module (US2).
 *
 * FilterState and its primitives are defined here canonically and
 * re-exported from the records module so both modules agree on the shape.
 */

import type { Id, IsoDate, MoneyMinor } from '../../records/domain/types.js';

export type { Id, IsoDate, MoneyMinor };

export interface FilterState {
  readonly query: string;
  readonly dateFrom: IsoDate | null;
  readonly dateTo: IsoDate | null;
  readonly types: ReadonlyArray<'income' | 'expense'>;
  readonly categoryIds: readonly Id[];
  readonly counterpartyIds: readonly Id[];
  readonly amountMin: MoneyMinor | null;
  readonly amountMax: MoneyMinor | null;
}

/** A FilterState with every criterion cleared — returns all records. */
export const emptyFilterState = (): FilterState => ({
  query: '',
  dateFrom: null,
  dateTo: null,
  types: [],
  categoryIds: [],
  counterpartyIds: [],
  amountMin: null,
  amountMax: null,
});

/** Returns true if none of the filter criteria are active. */
export const isFilterEmpty = (state: FilterState): boolean =>
  state.query === '' &&
  state.dateFrom === null &&
  state.dateTo === null &&
  state.types.length === 0 &&
  state.categoryIds.length === 0 &&
  state.counterpartyIds.length === 0 &&
  state.amountMin === null &&
  state.amountMax === null;
