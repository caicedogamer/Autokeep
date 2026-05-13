/*
 * ResultCount — renders "N resultado(s)" or empty-state / all-records text.
 */

import './result-count.css';

import { isFilterEmpty } from '../domain/types.js';
import type { FilterState } from '../domain/types.js';
import { t } from '../../../core/i18n/index.js';

export class ResultCount {
  private readonly host: HTMLElement;

  public constructor(host: HTMLElement) {
    this.host = host;
  }

  public update(count: number, state: FilterState): void {
    this.host.innerHTML = '';

    const p = document.createElement('p');
    p.className = 'result-count';
    p.setAttribute('aria-live', 'polite');
    p.setAttribute('aria-atomic', 'true');

    if (isFilterEmpty(state)) {
      p.textContent = t('filters.results.all');
    } else if (count === 0) {
      p.textContent = t('filters.results.empty');
    } else {
      p.textContent = t('filters.results.count').replace('{count}', String(count));
    }

    this.host.appendChild(p);
  }
}
