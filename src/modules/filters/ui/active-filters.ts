/*
 * ActiveFilters — renders removable chips for each active filter criterion.
 * Shows a "Limpiar todo" button when any criterion is active.
 *
 * Props: FilterState + label resolvers for IDs.
 * Emits: calls onRemove(field) or onClearAll() when user interacts.
 */

import './active-filters.css';

import type { FilterState } from '../domain/types.js';
import { isFilterEmpty } from '../domain/types.js';
import { t } from '../../../core/i18n/index.js';

export type FilterField = keyof FilterState;

export interface ActiveFiltersOpts {
  readonly categoryNames: ReadonlyMap<string, string>;
  readonly counterpartyNames: ReadonlyMap<string, string>;
  readonly onRemove: (field: FilterField, value?: string) => void;
  readonly onClearAll: () => void;
}

export class ActiveFilters {
  private readonly host: HTMLElement;
  private readonly opts: ActiveFiltersOpts;

  public constructor(host: HTMLElement, opts: ActiveFiltersOpts) {
    this.host = host;
    this.opts = opts;
  }

  public update(state: FilterState): void {
    this.host.innerHTML = '';
    if (isFilterEmpty(state)) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'active-filters';
    wrapper.setAttribute('aria-label', t('filters.active.label'));

    const chipList = document.createElement('ul');
    chipList.className = 'filter-chips';
    chipList.setAttribute('role', 'list');

    // Query chip
    if (state.query) {
      chipList.appendChild(this.makeChip(`"${state.query}"`, 'query'));
    }

    // Date range chips
    if (state.dateFrom !== null) {
      chipList.appendChild(this.makeChip(`≥ ${state.dateFrom}`, 'dateFrom'));
    }
    if (state.dateTo !== null) {
      chipList.appendChild(this.makeChip(`≤ ${state.dateTo}`, 'dateTo'));
    }

    // Type chips
    for (const type of state.types) {
      chipList.appendChild(this.makeChip(type, 'types', type));
    }

    // Category chips
    for (const catId of state.categoryIds) {
      const name = this.opts.categoryNames.get(catId) ?? catId;
      chipList.appendChild(this.makeChip(name, 'categoryIds', catId));
    }

    // Counterparty chips
    for (const cpId of state.counterpartyIds) {
      const name = this.opts.counterpartyNames.get(cpId) ?? cpId;
      chipList.appendChild(this.makeChip(name, 'counterpartyIds', cpId));
    }

    // Amount chips
    if (state.amountMin !== null) {
      chipList.appendChild(this.makeChip(`≥ ${String(state.amountMin)}`, 'amountMin'));
    }
    if (state.amountMax !== null) {
      chipList.appendChild(this.makeChip(`≤ ${String(state.amountMax)}`, 'amountMax'));
    }

    wrapper.appendChild(chipList);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'filter-clear-all';
    clearBtn.textContent = t('filters.active.clearAll');
    clearBtn.addEventListener('click', () => this.opts.onClearAll());
    wrapper.appendChild(clearBtn);

    this.host.appendChild(wrapper);
  }

  private makeChip(label: string, field: FilterField, value?: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'filter-chip';
    li.setAttribute('role', 'listitem');

    const text = document.createElement('span');
    text.textContent = label;
    li.appendChild(text);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', t('filters.active.removeChip').replace('{label}', label));
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => this.opts.onRemove(field, value));
    li.appendChild(removeBtn);

    return li;
  }
}
