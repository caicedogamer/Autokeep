/*
 * FilterBar — renders the combined filter controls for US2.
 *
 * Controls: free-text query, date-range, type toggle (income/expense),
 * category multi-select, counterparty combobox, amount range.
 *
 * Emits a `filter-change` CustomEvent<FilterState> on the host element
 * whenever any control changes. Parent component owns the FilterCoordinator.
 */

import './filter-bar.css';

import type { Category, Counterparty, Id } from '../../records/domain/types.js';
import type { FilterState } from '../domain/types.js';
import { emptyFilterState } from '../domain/types.js';
import { toIsoDate, toMoneyMinor } from '../../records/domain/types.js';
import { t } from '../../../core/i18n/index.js';

export interface FilterBarOpts {
  readonly categories: readonly Category[];
  readonly counterparties: readonly Counterparty[];
  readonly currencyMinorUnits: number;
  /** Called each time the filter state changes. */
  readonly onChange: (state: FilterState) => void;
}

export class FilterBar {
  private readonly host: HTMLElement;
  private readonly opts: FilterBarOpts;
  private state: FilterState = emptyFilterState();

  // Input refs
  private queryInput!: HTMLInputElement;
  private dateFromInput!: HTMLInputElement;
  private dateToInput!: HTMLInputElement;
  private incomeToggle!: HTMLButtonElement;
  private expenseToggle!: HTMLButtonElement;
  private categorySelect!: HTMLSelectElement;
  private counterpartySelect!: HTMLSelectElement;
  private amountMinInput!: HTMLInputElement;
  private amountMaxInput!: HTMLInputElement;

  public constructor(host: HTMLElement, opts: FilterBarOpts) {
    this.host = host;
    this.opts = opts;
    this.render();
  }

  public getState(): FilterState {
    return this.state;
  }

  public reset(): void {
    this.state = emptyFilterState();
    this.syncInputsToState();
    this.opts.onChange(this.state);
  }

  private render(): void {
    this.host.innerHTML = '';

    const fieldset = document.createElement('fieldset');
    fieldset.className = 'filter-bar';

    const legend = document.createElement('legend');
    legend.textContent = t('filters.bar.label');
    fieldset.appendChild(legend);

    // Query
    const queryGroup = this.createGroup();
    this.queryInput = this.createTextInput('filter-query', t('filters.bar.query'), 'search');
    queryGroup.appendChild(this.createLabel('filter-query', t('filters.bar.query')));
    queryGroup.appendChild(this.queryInput);
    this.queryInput.addEventListener('input', () => this.onQueryChange());
    fieldset.appendChild(queryGroup);

    // Date range
    const dateGroup = this.createGroup();
    this.dateFromInput = this.createDateInput('filter-date-from');
    this.dateToInput = this.createDateInput('filter-date-to');
    dateGroup.appendChild(this.createLabel('filter-date-from', t('filters.bar.dateFrom')));
    dateGroup.appendChild(this.dateFromInput);
    dateGroup.appendChild(this.createLabel('filter-date-to', t('filters.bar.dateTo')));
    dateGroup.appendChild(this.dateToInput);
    this.dateFromInput.addEventListener('change', () => this.onDateChange());
    this.dateToInput.addEventListener('change', () => this.onDateChange());
    fieldset.appendChild(dateGroup);

    // Type toggles
    const typeGroup = this.createGroup();
    const typeLabel = document.createElement('span');
    typeLabel.textContent = t('filters.bar.types');
    typeGroup.appendChild(typeLabel);

    this.incomeToggle = document.createElement('button');
    this.incomeToggle.type = 'button';
    this.incomeToggle.dataset['value'] = 'income';
    this.incomeToggle.textContent = t('records.type.income' as Parameters<typeof t>[0]);
    this.incomeToggle.setAttribute('aria-pressed', 'false');
    this.incomeToggle.addEventListener('click', () => this.onTypeToggle('income'));

    this.expenseToggle = document.createElement('button');
    this.expenseToggle.type = 'button';
    this.expenseToggle.dataset['value'] = 'expense';
    this.expenseToggle.textContent = t('records.type.expense' as Parameters<typeof t>[0]);
    this.expenseToggle.setAttribute('aria-pressed', 'false');
    this.expenseToggle.addEventListener('click', () => this.onTypeToggle('expense'));

    typeGroup.appendChild(this.incomeToggle);
    typeGroup.appendChild(this.expenseToggle);
    fieldset.appendChild(typeGroup);

    // Category multi-select
    const catGroup = this.createGroup();
    this.categorySelect = document.createElement('select');
    this.categorySelect.id = 'filter-category';
    this.categorySelect.multiple = true;
    this.categorySelect.setAttribute('aria-label', t('filters.bar.category'));
    this.populateCategoryOptions();
    this.categorySelect.addEventListener('change', () => this.onCategoryChange());
    catGroup.appendChild(this.createLabel('filter-category', t('filters.bar.category')));
    catGroup.appendChild(this.categorySelect);
    fieldset.appendChild(catGroup);

    // Counterparty combobox
    const cpGroup = this.createGroup();
    this.counterpartySelect = document.createElement('select');
    this.counterpartySelect.id = 'filter-counterparty';
    this.counterpartySelect.setAttribute('aria-label', t('filters.bar.counterparty'));
    this.populateCounterpartyOptions();
    this.counterpartySelect.addEventListener('change', () => this.onCounterpartyChange());
    cpGroup.appendChild(this.createLabel('filter-counterparty', t('filters.bar.counterparty')));
    cpGroup.appendChild(this.counterpartySelect);
    fieldset.appendChild(cpGroup);

    // Amount range
    const amountGroup = this.createGroup();
    this.amountMinInput = this.createNumberInput('filter-amount-min', t('filters.bar.amountMin'));
    this.amountMaxInput = this.createNumberInput('filter-amount-max', t('filters.bar.amountMax'));
    amountGroup.appendChild(this.createLabel('filter-amount-min', t('filters.bar.amountMin')));
    amountGroup.appendChild(this.amountMinInput);
    amountGroup.appendChild(this.createLabel('filter-amount-max', t('filters.bar.amountMax')));
    amountGroup.appendChild(this.amountMaxInput);
    this.amountMinInput.addEventListener('change', () => this.onAmountChange());
    this.amountMaxInput.addEventListener('change', () => this.onAmountChange());
    fieldset.appendChild(amountGroup);

    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = t('filters.bar.clear');
    clearBtn.addEventListener('click', () => this.reset());
    fieldset.appendChild(clearBtn);

    this.host.appendChild(fieldset);
  }

  private onQueryChange(): void {
    this.state = { ...this.state, query: this.queryInput.value.trim() };
    this.opts.onChange(this.state);
  }

  private onDateChange(): void {
    const from = this.dateFromInput.value;
    const to = this.dateToInput.value;
    this.state = {
      ...this.state,
      dateFrom: from ? toIsoDate(from) : null,
      dateTo: to ? toIsoDate(to) : null,
    };
    this.opts.onChange(this.state);
  }

  private onTypeToggle(type: 'income' | 'expense'): void {
    const current = this.state.types as Array<'income' | 'expense'>;
    const next: Array<'income' | 'expense'> = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    this.state = { ...this.state, types: next };
    this.syncTypeToggleState();
    this.opts.onChange(this.state);
  }

  private onCategoryChange(): void {
    const selected = Array.from(this.categorySelect.selectedOptions).map((o) => o.value as Id);
    this.state = { ...this.state, categoryIds: selected };
    this.opts.onChange(this.state);
  }

  private onCounterpartyChange(): void {
    const val = this.counterpartySelect.value as Id | '';
    this.state = {
      ...this.state,
      counterpartyIds: val ? [val as Id] : [],
    };
    this.opts.onChange(this.state);
  }

  private onAmountChange(): void {
    const minRaw = parseFloat(this.amountMinInput.value);
    const maxRaw = parseFloat(this.amountMaxInput.value);
    const factor = Math.pow(10, this.opts.currencyMinorUnits);
    this.state = {
      ...this.state,
      amountMin: isNaN(minRaw) ? null : toMoneyMinor(Math.round(minRaw * factor)),
      amountMax: isNaN(maxRaw) ? null : toMoneyMinor(Math.round(maxRaw * factor)),
    };
    this.opts.onChange(this.state);
  }

  private syncTypeToggleState(): void {
    const types = this.state.types as string[];
    this.incomeToggle.setAttribute('aria-pressed', String(types.includes('income')));
    this.expenseToggle.setAttribute('aria-pressed', String(types.includes('expense')));
  }

  private syncInputsToState(): void {
    this.queryInput.value = '';
    this.dateFromInput.value = '';
    this.dateToInput.value = '';
    this.incomeToggle.setAttribute('aria-pressed', 'false');
    this.expenseToggle.setAttribute('aria-pressed', 'false');
    Array.from(this.categorySelect.options).forEach((o) => {
      o.selected = false;
    });
    this.counterpartySelect.value = '';
    this.amountMinInput.value = '';
    this.amountMaxInput.value = '';
  }

  private populateCategoryOptions(): void {
    this.categorySelect.innerHTML = '';
    for (const cat of this.opts.categories) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      this.categorySelect.appendChild(opt);
    }
  }

  private populateCounterpartyOptions(): void {
    this.counterpartySelect.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— Todas —';
    this.counterpartySelect.appendChild(blank);
    for (const cp of this.opts.counterparties) {
      const opt = document.createElement('option');
      opt.value = cp.id;
      opt.textContent = cp.name;
      this.counterpartySelect.appendChild(opt);
    }
  }

  private createGroup(): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'filter-group';
    return div;
  }

  private createLabel(forId: string, text: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.htmlFor = forId;
    label.textContent = text;
    return label;
  }

  private createTextInput(id: string, placeholder: string, type = 'text'): HTMLInputElement {
    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.placeholder = placeholder;
    return input;
  }

  private createDateInput(id: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'date';
    input.id = id;
    return input;
  }

  private createNumberInput(id: string, placeholder: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.min = '0';
    input.step = '0.01';
    input.placeholder = placeholder;
    return input;
  }
}
