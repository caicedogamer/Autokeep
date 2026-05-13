// Public surface of the `filters` module (US2).
export type { FilterState } from './domain/types.js';
export { emptyFilterState, isFilterEmpty } from './domain/types.js';
export {
  matchesQuery,
  matchesDateRange,
  matchesType,
  matchesCategory,
  matchesCounterparty,
  matchesAmountRange,
  matchesAll,
  applyFilters,
} from './domain/predicates.js';
export type { FilterResultCallback } from './services/filter-coordinator.js';
export { FilterCoordinator } from './services/filter-coordinator.js';
export type { FilterBarOpts } from './ui/filter-bar.js';
export { FilterBar } from './ui/filter-bar.js';
export type { ActiveFiltersOpts, FilterField } from './ui/active-filters.js';
export { ActiveFilters } from './ui/active-filters.js';
export { ResultCount } from './ui/result-count.js';
