/*
 * ScopeBanner — always-visible banner showing active period + filter summary
 * so the operator knows what they are looking at (FR-024).
 */
import './scope-banner.css';

import type { DashboardPeriod } from '../domain/period.js';
import type { FilterState } from '../../filters/domain/types.js';
import { isFilterEmpty } from '../../filters/domain/types.js';

const PERIOD_LABELS: Record<string, string> = {
  thisMonth: 'Este mes',
  lastMonth: 'Mes anterior',
  thisQuarter: 'Este trimestre',
  lastQuarter: 'Trimestre anterior',
  thisYear: 'Este año',
  custom: 'Rango personalizado',
};

export class ScopeBanner {
  private readonly host: HTMLElement;

  public constructor(host: HTMLElement) {
    this.host = host;
  }

  public update(period: DashboardPeriod, filterState: FilterState): void {
    this.host.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'scope-banner';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');

    const periodLabel = PERIOD_LABELS[period.kind] ?? period.kind;
    const periodText =
      period.kind === 'custom'
        ? `${periodLabel}: ${period.from as string} – ${period.to as string}`
        : `${periodLabel} (${period.from as string} – ${period.to as string})`;

    const periodEl = document.createElement('span');
    periodEl.className = 'scope-banner__period';
    periodEl.textContent = periodText;
    el.appendChild(periodEl);

    if (isFilterEmpty(filterState)) {
      const noFilter = document.createElement('span');
      noFilter.className = 'scope-banner__no-filter';
      noFilter.textContent = '— sin filtros activos';
      el.appendChild(noFilter);
    } else {
      const tags = this.buildFilterTags(filterState);
      for (const tag of tags) el.appendChild(tag);
    }

    this.host.appendChild(el);
  }

  private buildFilterTags(filterState: FilterState): HTMLElement[] {
    const tags: HTMLElement[] = [];
    const addTag = (text: string): void => {
      const span = document.createElement('span');
      span.className = 'scope-banner__filter-tag';
      span.textContent = text;
      tags.push(span);
    };

    if (filterState.query) addTag(`Búsqueda: "${filterState.query}"`);
    if (filterState.types.length > 0) addTag(`Tipo: ${filterState.types.join(', ')}`);
    if (filterState.categoryIds.length > 0)
      addTag(`${String(filterState.categoryIds.length)} categoría(s)`);
    if (filterState.counterpartyIds.length > 0)
      addTag(`${String(filterState.counterpartyIds.length)} contraparte(s)`);
    if (filterState.amountMin !== null) addTag(`Mín: ${String(filterState.amountMin)}`);
    if (filterState.amountMax !== null) addTag(`Máx: ${String(filterState.amountMax)}`);
    if (filterState.dateFrom !== null) addTag(`Desde: ${filterState.dateFrom as string}`);
    if (filterState.dateTo !== null) addTag(`Hasta: ${filterState.dateTo as string}`);

    return tags;
  }
}
