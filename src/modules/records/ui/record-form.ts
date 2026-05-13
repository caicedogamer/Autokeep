/*
 * RecordForm — create / edit a FinancialRecord.
 *
 * Renders a <form> element inside a <dialog> for accessible modal behavior
 * (WCAG 2.1 AA, FR-037). Focus is trapped inside the dialog while open.
 * Emits a submit callback with validated input; the parent service handles
 * the actual persist + conflict detection.
 */

import './record-form.css';

import type {
  FinancialRecord,
  Category,
  Counterparty,
  NewRecordInput,
  UpdateRecordInput,
} from '../domain/types.js';
import { toId, toMoneyMinor, toIsoDate } from '../domain/types.js';
import { fromDecimalString } from '../domain/money.js';
import { t } from '../../../core/i18n/index.js';

export interface RecordFormOptions {
  readonly container: HTMLElement;
  readonly categories: readonly Category[];
  readonly counterparties: readonly Counterparty[];
  readonly currencyMinorUnits: 0 | 2 | 3;
  readonly onSubmitNew: (input: NewRecordInput) => void;
  readonly onSubmitUpdate: (input: UpdateRecordInput) => void;
  readonly onCancel: () => void;
}

export class RecordForm {
  private readonly opts: RecordFormOptions;
  private dialog: HTMLDialogElement | null = null;
  private editingRecord: FinancialRecord | null = null;

  public constructor(opts: RecordFormOptions) {
    this.opts = opts;
  }

  /** Open form in create mode. */
  public openNew(): void {
    this.editingRecord = null;
    this.mount();
  }

  /** Open form in edit mode, pre-filling fields from the record. */
  public openEdit(record: FinancialRecord): void {
    this.editingRecord = record;
    this.mount();
  }

  public close(): void {
    if (this.dialog) {
      this.dialog.close();
      this.dialog.remove();
      this.dialog = null;
    }
  }

  private mount(): void {
    this.close();

    const dialog = document.createElement('dialog');
    dialog.className = 'record-form-dialog';
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'record-form-title');

    const heading = document.createElement('h2');
    heading.id = 'record-form-title';
    heading.textContent = this.editingRecord
      ? t('records.form.titleEdit')
      : t('records.form.titleNew');

    const form = document.createElement('form');
    form.method = 'dialog';
    form.noValidate = true;
    form.setAttribute('aria-describedby', 'record-form-error');

    const errorEl = document.createElement('p');
    errorEl.id = 'record-form-error';
    errorEl.role = 'alert';
    errorEl.className = 'record-form__error visually-hidden';

    form.appendChild(
      this.buildField('date', 'date', t('records.form.date'), true, this.editingRecord?.date ?? ''),
    );
    form.appendChild(this.buildTypeField());
    form.appendChild(
      this.buildField(
        'amount',
        'text',
        t('records.form.amount'),
        true,
        this.editingRecord
          ? String(this.editingRecord.amount / 10 ** this.opts.currencyMinorUnits)
          : '',
      ),
    );
    form.appendChild(this.buildCategoryField());
    form.appendChild(
      this.buildField(
        'description',
        'text',
        t('records.form.description'),
        true,
        this.editingRecord?.description ?? '',
      ),
    );
    form.appendChild(this.buildCounterpartyField());
    form.appendChild(errorEl);
    form.appendChild(this.buildActions());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit(form, errorEl);
    });

    dialog.appendChild(heading);
    dialog.appendChild(form);
    this.opts.container.appendChild(dialog);
    this.dialog = dialog;
    dialog.showModal();

    // Focus first input
    const firstInput = dialog.querySelector<HTMLElement>('input, select, textarea');
    firstInput?.focus();
  }

  private buildField(
    name: string,
    type: string,
    label: string,
    required: boolean,
    value: string,
  ): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';

    const lbl = document.createElement('label');
    lbl.htmlFor = `rf-${name}`;
    lbl.textContent = label;

    const input = document.createElement('input');
    input.type = type;
    input.id = `rf-${name}`;
    input.name = name;
    input.value = value;
    input.required = required;
    if (type === 'date') input.setAttribute('autocomplete', 'off');

    group.appendChild(lbl);
    group.appendChild(input);
    return group;
  }

  private buildTypeField(): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = 'rf-type';
    lbl.textContent = t('records.form.type');
    const select = document.createElement('select');
    select.id = 'rf-type';
    select.name = 'type';
    select.required = true;
    for (const val of ['income', 'expense'] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = t(`records.type.${val}`);
      if (this.editingRecord?.type === val) opt.selected = true;
      select.appendChild(opt);
    }
    group.appendChild(lbl);
    group.appendChild(select);
    return group;
  }

  private buildCategoryField(): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = 'rf-category';
    lbl.textContent = t('records.form.category');
    const select = document.createElement('select');
    select.id = 'rf-category';
    select.name = 'categoryId';
    select.required = true;
    for (const cat of this.opts.categories) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      if (this.editingRecord?.categoryId === cat.id) opt.selected = true;
      select.appendChild(opt);
    }
    group.appendChild(lbl);
    group.appendChild(select);
    return group;
  }

  private buildCounterpartyField(): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = 'rf-counterparty';
    lbl.textContent = t('records.form.counterparty');
    const select = document.createElement('select');
    select.id = 'rf-counterparty';
    select.name = 'counterpartyId';
    // blank option = "none"
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = t('records.form.noCounterparty');
    select.appendChild(blank);
    for (const cp of this.opts.counterparties) {
      const opt = document.createElement('option');
      opt.value = cp.id;
      opt.textContent = cp.name;
      if (this.editingRecord?.counterpartyId === cp.id) opt.selected = true;
      select.appendChild(opt);
    }
    group.appendChild(lbl);
    group.appendChild(select);
    return group;
  }

  private buildActions(): HTMLDivElement {
    const actions = document.createElement('div');
    actions.className = 'form-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = t('common.cancel');
    cancelBtn.addEventListener('click', () => {
      this.close();
      this.opts.onCancel();
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn--primary';
    submitBtn.textContent = this.editingRecord ? t('common.save') : t('common.create');

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    return actions;
  }

  private handleSubmit(form: HTMLFormElement, errorEl: HTMLElement): void {
    const data = new FormData(form);
    const dateVal = data.get('date') as string;
    const typeVal = data.get('type') as 'income' | 'expense';
    const amountStr = (data.get('amount') as string).trim();
    const categoryId = data.get('categoryId') as string;
    const description = (data.get('description') as string).trim();
    const counterpartyIdRaw = data.get('counterpartyId') as string;

    let amountMinor: ReturnType<typeof toMoneyMinor>;
    try {
      amountMinor = fromDecimalString(amountStr, this.opts.currencyMinorUnits);
    } catch {
      this.showError(errorEl, t('records.form.error.invalidAmount'));
      return;
    }

    if (!description) {
      this.showError(errorEl, t('records.form.error.descriptionRequired'));
      return;
    }

    this.hideError(errorEl);

    if (this.editingRecord) {
      const input: UpdateRecordInput = {
        id: this.editingRecord.id,
        version: this.editingRecord.version,
        date: toIsoDate(dateVal),
        type: typeVal,
        amount: amountMinor,
        categoryId: toId(categoryId),
        description,
        counterpartyId: counterpartyIdRaw ? toId(counterpartyIdRaw) : null,
      };
      this.close();
      this.opts.onSubmitUpdate(input);
    } else {
      const input: NewRecordInput = {
        date: toIsoDate(dateVal),
        type: typeVal,
        amount: amountMinor,
        categoryId: toId(categoryId),
        description,
        ...(counterpartyIdRaw ? { counterpartyId: toId(counterpartyIdRaw) } : {}),
      };
      this.close();
      this.opts.onSubmitNew(input);
    }
  }

  private showError(el: HTMLElement, message: string): void {
    el.textContent = message;
    el.classList.remove('visually-hidden');
  }

  private hideError(el: HTMLElement): void {
    el.textContent = '';
    el.classList.add('visually-hidden');
  }
}
