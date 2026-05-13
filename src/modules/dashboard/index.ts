/*
 * Public surface of the `dashboard` module (US5).
 */

export { DashboardService, DASHBOARD_RECOMPUTED } from './services/dashboard-service.js';
export type { DashboardViewModel } from './services/dashboard-service.js';
export type { DashboardPeriod, DashboardPeriodKind } from './domain/period.js';
export {
  resolvePreset,
  customPeriod,
  autoGranularity,
  periodContainsDate,
} from './domain/period.js';
export type {
  TotalsResult,
  EvolutionResult,
  EvolutionPoint,
  CategoryRank,
  CounterpartyRank,
} from './domain/aggregations.js';
export {
  computeTotals,
  totalIncome,
  totalExpenses,
  net,
  evolution,
  topCategories,
  topCounterparties,
} from './domain/aggregations.js';
export { PeriodSelector, DASHBOARD_PERIOD_CHANGED } from './ui/period-selector.js';
export { TotalsCard } from './ui/totals-card.js';
export { EvolutionChart } from './ui/evolution-chart.js';
export { TopBarWidget } from './ui/top-bar-widget.js';
export { ScopeBanner } from './ui/scope-banner.js';

import type { FinancialRecord, Category, Counterparty } from '../records/domain/types.js';
import type { FilterState } from '../filters/domain/types.js';
import type { DashboardPeriod } from './domain/period.js';
import { resolvePreset } from './domain/period.js';
import { DashboardService } from './services/dashboard-service.js';
import { PeriodSelector } from './ui/period-selector.js';
import { TotalsCard } from './ui/totals-card.js';
import { EvolutionChart } from './ui/evolution-chart.js';
import { TopBarWidget } from './ui/top-bar-widget.js';
import { ScopeBanner } from './ui/scope-banner.js';
import { emptyFilterState } from '../filters/domain/types.js';

export interface DashboardDeps {
  readonly records: readonly FinancialRecord[];
  readonly categories: readonly Category[];
  readonly counterparties: readonly Counterparty[];
  readonly filterState?: FilterState;
  readonly currencyCode: string;
  readonly currencyMinorUnits: number;
}

/**
 * Mount the full dashboard UI into `container`.
 * Returns a dispose function that tears down Chart.js instances.
 */
export function mountDashboard(container: HTMLElement, deps: DashboardDeps): () => void {
  container.innerHTML = '';

  const categoryNames = new Map(deps.categories.map((c) => [c.id, c.name]));
  const counterpartyNames = new Map(deps.counterparties.map((c) => [c.id, c.name]));

  // Banner
  const bannerHost = document.createElement('div');
  bannerHost.className = 'dashboard-scope-banner';
  container.appendChild(bannerHost);
  const banner = new ScopeBanner(bannerHost);

  // Period selector
  const periodHost = document.createElement('div');
  periodHost.className = 'dashboard-period';
  container.appendChild(periodHost);

  // Totals
  const totalsHost = document.createElement('div');
  totalsHost.className = 'dashboard-totals';
  container.appendChild(totalsHost);
  const totalsCard = new TotalsCard(totalsHost, {
    currencyCode: deps.currencyCode,
    currencyMinorUnits: deps.currencyMinorUnits,
  });

  // Evolution
  const evoHost = document.createElement('div');
  evoHost.className = 'dashboard-evolution';
  container.appendChild(evoHost);
  const evoChart = new EvolutionChart(evoHost, {
    currencyCode: deps.currencyCode,
    currencyMinorUnits: deps.currencyMinorUnits,
  });

  // Top widgets (side-by-side)
  const topRow = document.createElement('div');
  topRow.className = 'dashboard-top-row';
  topRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:1rem;';
  container.appendChild(topRow);

  const catHost = document.createElement('div');
  topRow.appendChild(catHost);
  const catWidget = new TopBarWidget(catHost, {
    title: 'Top categorías',
    currencyCode: deps.currencyCode,
    currencyMinorUnits: deps.currencyMinorUnits,
  });

  const cpHost = document.createElement('div');
  topRow.appendChild(cpHost);
  const cpWidget = new TopBarWidget(cpHost, {
    title: 'Top contrapartes',
    currencyCode: deps.currencyCode,
    currencyMinorUnits: deps.currencyMinorUnits,
  });

  const svc = new DashboardService();
  const currentFilter: FilterState = deps.filterState ?? emptyFilterState();
  let currentPeriod: DashboardPeriod = resolvePreset('thisMonth');

  const recompute = (): void => {
    const vm = svc.compute(deps.records, currentPeriod, currentFilter);
    banner.update(currentPeriod, currentFilter);
    totalsCard.update(vm.totals);
    evoChart.update(vm.evolution);
    catWidget.updateFromCategories(vm.topCategories, categoryNames);
    cpWidget.updateFromCounterparties(vm.topCounterparties, counterpartyNames);
  };

  new PeriodSelector(periodHost, {
    initial: currentPeriod,
    onChange: (p) => {
      currentPeriod = p;
      recompute();
    },
  });

  recompute();

  return (): void => {
    evoChart.destroy();
    catWidget.destroy();
    cpWidget.destroy();
    container.innerHTML = '';
  };
}
