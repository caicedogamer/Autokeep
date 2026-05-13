/*
 * DashboardService — computes a DashboardViewModel from records + period +
 * active FilterState and notifies listeners on each recompute (US5).
 *
 * Constitution Principle II: no DOM; pure computation + event emission only.
 */

import type { FinancialRecord } from '../../records/domain/types.js';
import type { FilterState } from '../../filters/domain/types.js';
import { applyFilters } from '../../filters/domain/predicates.js';
import type { DashboardPeriod } from '../domain/period.js';
import { periodContainsDate } from '../domain/period.js';
import {
  computeTotals,
  evolution,
  topCategories,
  topCounterparties,
} from '../domain/aggregations.js';
import type {
  TotalsResult,
  EvolutionResult,
  CategoryRank,
  CounterpartyRank,
} from '../domain/aggregations.js';

export const DASHBOARD_RECOMPUTED = 'dashboard:recomputed' as const;

export interface DashboardViewModel {
  readonly period: DashboardPeriod;
  readonly totals: TotalsResult;
  readonly evolution: EvolutionResult;
  readonly topCategories: CategoryRank[];
  readonly topCounterparties: CounterpartyRank[];
  readonly isEmpty: boolean;
}

type Listener = (vm: DashboardViewModel) => void;

export class DashboardService {
  private listeners: Listener[] = [];

  public compute(
    records: readonly FinancialRecord[],
    period: DashboardPeriod,
    filterState: FilterState,
  ): DashboardViewModel {
    const filtered = applyFilters(records, filterState);
    const scoped = filtered.filter((r) => periodContainsDate(period, r.date));

    const vm: DashboardViewModel = {
      period,
      totals: computeTotals(scoped),
      evolution: evolution(scoped, period),
      topCategories: topCategories(scoped, 5),
      topCounterparties: topCounterparties(scoped, 5),
      isEmpty: scoped.length === 0,
    };

    this.notify(vm);
    return vm;
  }

  /** Subscribe to recompute events. Returns an unsubscribe function. */
  public on(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(vm: DashboardViewModel): void {
    for (const l of this.listeners) l(vm);
  }
}
