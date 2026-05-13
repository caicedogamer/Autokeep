/*
 * RecordsList — renders a filterable, sortable table of FinancialRecord rows.
 *
 * Pure DOM manipulation; no framework. Emits custom events so parent
 * components can react (e.g., open the record form, request delete confirm).
 */

import './records-list.css';

import type { FinancialRecord, Category, Counterparty } from '../domain/types.js';
import { t } from '../../../core/i18n/index.js';
import { formatAmount } from '../../../core/i18n/format.js';

export type RecordsListEvents = {
  'record-edit': { record: FinancialRecord };
  'record-delete': { record: FinancialRecord };
};

export interface RecordsListOptions {
  readonly container: HTMLElement;
  readonly currencyCode: string;
  readonly currencyMinorUnits: 0 | 2 | 3;
  readonly locale: string;
  readonly onEdit: (record: FinancialRecord) => void;
  readonly onDelete: (record: FinancialRecord) => void;
}

export class RecordsList {
  private readonly container: HTMLElement;
  private readonly opts: RecordsListOptions;
  private categories: Map<string, Category> = new Map();
  private counterparties: Map<string, Counterparty> = new Map();

  public constructor(opts: RecordsListOptions) {
    this.container = opts.container;
    this.opts = opts;
  }

  public setLookups(
    categories: readonly Category[],
    counterparties: readonly Counterparty[],
  ): void {
    this.categories = new Map(categories.map((c) => [c.id, c]));
    this.counterparties = new Map(counterparties.map((c) => [c.id, c]));
  }

  public render(records: readonly FinancialRecord[]): void {
    this.container.innerHTML = '';

    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'records-list__empty';
      empty.setAttribute('role', 'status');
      empty.textContent = t('records.list.empty');
      this.container.appendChild(empty);
      return;
    }

    const table = this.buildTable(records);
    this.container.appendChild(table);
  }

  private buildTable(records: readonly FinancialRecord[]): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'records-list';
    table.setAttribute('aria-label', t('records.list.tableLabel'));

    table.appendChild(this.buildHeader());
    const tbody = document.createElement('tbody');
    for (const record of records) {
      tbody.appendChild(this.buildRow(record));
    }
    table.appendChild(tbody);
    return table;
  }

  private buildHeader(): HTMLTableSectionElement {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    const cols = [
      'records.col.date',
      'records.col.type',
      'records.col.description',
      'records.col.category',
      'records.col.amount',
      'records.col.actions',
    ];
    for (const key of cols) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = t(key as Parameters<typeof t>[0]);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    return thead;
  }

  private buildRow(record: FinancialRecord): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.dataset['recordId'] = record.id;
    tr.className = `records-list__row records-list__row--${record.type}`;

    const category = this.categories.get(record.categoryId);
    const counterparty = record.counterpartyId
      ? this.counterparties.get(record.counterpartyId)
      : undefined;

    const cells = [
      record.date,
      t(`records.type.${record.type}` as Parameters<typeof t>[0]),
      counterparty ? `${record.description} (${counterparty.name})` : record.description,
      category?.name ?? '—',
      formatAmount(
        record.amount,
        this.opts.currencyCode,
        this.opts.currencyMinorUnits,
        this.opts.locale,
      ),
    ];

    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }

    // Actions cell
    const actionsTd = document.createElement('td');
    actionsTd.className = 'records-list__actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn--ghost btn--sm';
    editBtn.textContent = t('common.edit');
    editBtn.setAttribute('aria-label', `${t('common.edit')} ${record.description}`);
    editBtn.addEventListener('click', () => {
      this.opts.onEdit(record);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn--ghost btn--sm btn--danger';
    deleteBtn.textContent = t('common.delete');
    deleteBtn.setAttribute('aria-label', `${t('common.delete')} ${record.description}`);
    deleteBtn.addEventListener('click', () => {
      this.opts.onDelete(record);
    });

    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);

    return tr;
  }
}
