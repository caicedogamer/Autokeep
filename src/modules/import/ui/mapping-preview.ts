/*
 * MappingPreview UI component (T139).
 *
 * Renders the inferred column→role mapping over the first ~20 rows of
 * the parsed file. The operator can:
 *   - Confirm the auto-inferred mapping (single click → MappingDecision.source: 'auto')
 *   - Override any column via the role dropdown (→ 'mixed' or 'manual')
 *   - See ambiguity / low-confidence / mixed-type warnings as badges
 *   - Cancel
 *
 * Implements the operator-facing contract in
 * contracts/import-mapping.md §5 (thresholds) and §3 (MappingDecision
 * shape). i18n strings live in core/i18n/es.ts (see `import.*` keys).
 *
 * Constitution Principle II: this is a UI module. It MAY touch the DOM
 * but consumes domain/services through typed interfaces only.
 *
 * Spec ref: T139 in tasks.md.
 */

import { t } from '../../../core/i18n/index.js';
import type {
  AmountConvention,
  ColumnInference,
  ColumnMapping,
  DateFormatId,
  DecimalSeparator,
  InferenceReport,
  MappingDecision,
  MappingSource,
  MappingWarning,
  RawTable,
  SemanticRole,
} from '../domain/types.js';
import { REQUIRED_ROLES } from '../domain/types.js';

import './mapping-preview.css';

const PREVIEW_ROW_LIMIT = 20;

const ROLE_ORDER: SemanticRole[] = [
  'date',
  'type',
  'amount',
  'category',
  'description',
  'counterparty',
  'currency',
  'metadata',
  'ignore',
];

const ROLE_LABEL_KEYS: Record<SemanticRole, Parameters<typeof t>[0]> = {
  date: 'import.role.date',
  type: 'import.role.type',
  amount: 'import.role.amount',
  category: 'import.role.category',
  description: 'import.role.description',
  counterparty: 'import.role.counterparty',
  currency: 'import.role.currency',
  metadata: 'import.role.metadata',
  ignore: 'import.role.ignore',
};

const WARNING_KEYS: Record<MappingWarning['code'], Parameters<typeof t>[0]> = {
  AMBIGUOUS_ROLE: 'import.warning.AMBIGUOUS_ROLE',
  LOW_CONFIDENCE: 'import.warning.LOW_CONFIDENCE',
  MIXED_TYPE_COLUMN: 'import.warning.MIXED_TYPE_COLUMN',
  MISSING_REQUIRED_ROLE: 'import.warning.MISSING_REQUIRED_ROLE',
  CURRENCY_DIFFERS_FROM_WORKSPACE: 'import.warning.CURRENCY_DIFFERS_FROM_WORKSPACE',
  AMBIGUOUS_DATE_FORMAT: 'import.warning.AMBIGUOUS_DATE_FORMAT',
  AMBIGUOUS_DECIMAL_SEPARATOR: 'import.warning.AMBIGUOUS_DECIMAL_SEPARATOR',
  AMBIGUOUS_AMOUNT_CONVENTION: 'import.warning.AMBIGUOUS_AMOUNT_CONVENTION',
};

const HIGH_CONFIDENCE = 0.8;
const MEDIUM_CONFIDENCE = 0.5;

function confidenceLevel(c: number): 'high' | 'medium' | 'low' {
  if (c >= HIGH_CONFIDENCE) return 'high';
  if (c >= MEDIUM_CONFIDENCE) return 'medium';
  return 'low';
}

export interface MappingPreviewOpts {
  readonly table: RawTable;
  readonly inferenceReport: InferenceReport;
  readonly onConfirm: (decision: MappingDecision) => void;
  readonly onCancel: () => void;
}

export class MappingPreview {
  private readonly container: HTMLElement;
  private readonly opts: MappingPreviewOpts;
  private mapping: ColumnMapping;
  private operatorEdits = 0;
  private autoConfirmable: boolean;
  // Per-column extras the operator may need to confirm.
  private dateFormatPerColumn: Record<number, DateFormatId> = {};
  private decimalSeparatorPerColumn: Record<number, DecimalSeparator> = {};
  private amountConvention: AmountConvention = 'major-decimal';
  /**
   * Identifiers of warnings the operator has not yet acknowledged via a
   * radio click. Format: `amountConvention` | `dateFormat:<col>` |
   * `decimalSeparator:<col>`. Confirm is disabled while non-empty.
   */
  private pendingResolutions: Set<string> = new Set();

  public constructor(container: HTMLElement, opts: MappingPreviewOpts) {
    this.container = container;
    this.opts = opts;
    // Start from inferrer's recommendation.
    this.mapping = Object.fromEntries(
      opts.inferenceReport.columns.map((c) => [c.columnIndex, c.inferredRole]),
    );
    this.autoConfirmable = this.computeAutoConfirmable();
    this.seedFormatDefaults();
    this.seedPendingResolutions();
    this.render();
  }

  /**
   * Ambiguity warnings used to require an explicit operator click on the
   * radio cards before confirming. That blocker has been removed:
   * `seedFormatDefaults` already applies the inferrer's first candidate,
   * the cards render that candidate pre-selected, and the operator can
   * override before confirming. Kept as a no-op so future code can still
   * push into `pendingResolutions` for non-default ambiguities if needed.
   */
  private seedPendingResolutions(): void {
    // intentionally empty — see method docstring
  }

  private computeAutoConfirmable(): boolean {
    // Every required role must be mapped at confidence ≥ 0.8 AND no
    // blocking warning is unresolved.
    const blockingCodes: Array<MappingWarning['code']> = [
      'AMBIGUOUS_ROLE',
      'AMBIGUOUS_DATE_FORMAT',
      'AMBIGUOUS_DECIMAL_SEPARATOR',
      'AMBIGUOUS_AMOUNT_CONVENTION',
      'LOW_CONFIDENCE',
      'MISSING_REQUIRED_ROLE',
      'CURRENCY_DIFFERS_FROM_WORKSPACE',
    ];
    const hasBlocker = this.opts.inferenceReport.globalWarnings.some((w) =>
      blockingCodes.includes(w.code),
    );
    if (hasBlocker) return false;
    return REQUIRED_ROLES.every((role) => {
      const col = this.opts.inferenceReport.columns.find(
        (c) => c.inferredRole === role && c.confidence >= HIGH_CONFIDENCE,
      );
      return col !== undefined;
    });
  }

  private seedFormatDefaults(): void {
    for (const w of this.opts.inferenceReport.globalWarnings) {
      if (w.code === 'AMBIGUOUS_DATE_FORMAT' && w.candidates[0]) {
        this.dateFormatPerColumn[w.columnIndex] = w.candidates[0];
      } else if (w.code === 'AMBIGUOUS_DECIMAL_SEPARATOR' && w.candidates[0]) {
        this.decimalSeparatorPerColumn[w.columnIndex] = w.candidates[0];
      } else if (w.code === 'AMBIGUOUS_AMOUNT_CONVENTION' && w.candidates[0]) {
        this.amountConvention = w.candidates[0];
      }
    }
  }

  private render(): void {
    this.container.innerHTML = '';
    this.container.classList.add('mapping-preview');

    const header = document.createElement('header');
    header.className = 'mapping-preview__header';
    header.innerHTML = `
      <h2 class="mapping-preview__title">${t('import.mapping.title')}</h2>
      <p class="mapping-preview__subtitle">${t('import.mapping.subtitle')}</p>
    `;
    this.container.appendChild(header);

    // Filter warnings: the three resolvable-by-operator codes are now
    // surfaced as interactive radio groups in the "resolutions" section.
    // The non-resolvable ones (AMBIGUOUS_ROLE, LOW_CONFIDENCE,
    // MIXED_TYPE_COLUMN, MISSING_REQUIRED_ROLE, CURRENCY_DIFFERS_FROM_WORKSPACE)
    // keep showing as passive .alert chips.
    const passiveWarnings = this.opts.inferenceReport.globalWarnings.filter(
      (w) =>
        w.code !== 'AMBIGUOUS_AMOUNT_CONVENTION' &&
        w.code !== 'AMBIGUOUS_DATE_FORMAT' &&
        w.code !== 'AMBIGUOUS_DECIMAL_SEPARATOR',
    );
    if (passiveWarnings.length > 0) {
      const warnList = document.createElement('section');
      warnList.className = 'mapping-preview__warnings';
      for (const w of passiveWarnings) {
        const alert = document.createElement('div');
        alert.className = 'alert alert--warning';
        const msg = t(WARNING_KEYS[w.code]);
        alert.innerHTML = `
          <div class="alert__body">
            <div class="alert__title">${msg}</div>
            <div>${this.warningDetail(w)}</div>
          </div>
        `;
        warnList.appendChild(alert);
      }
      this.container.appendChild(warnList);
    }

    // Resolutions section (interactive radio groups).
    const resolutionsSection = this.buildResolutionsSection();
    if (resolutionsSection) {
      this.container.appendChild(resolutionsSection);
    }

    // Preview table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'mapping-preview__table-wrapper';
    const table = document.createElement('table');
    table.className = 'mapping-preview__table';
    table.appendChild(this.buildHeaderRow());
    table.appendChild(this.buildDataBody());
    tableWrap.appendChild(table);
    this.container.appendChild(tableWrap);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'mapping-preview__footer';
    const info = document.createElement('div');
    info.className = 'mapping-preview__footer-info';
    info.textContent = this.footerInfo();

    const actions = document.createElement('div');
    actions.className = 'mapping-preview__footer-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--secondary';
    cancelBtn.textContent = t('import.mapping.cancel');
    cancelBtn.addEventListener('click', () => this.opts.onCancel());

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.id = 'mapping-preview-confirm';
    confirmBtn.className = 'btn btn--primary';
    confirmBtn.textContent = t('import.mapping.confirm');
    const blockers = this.confirmBlockers();
    confirmBtn.disabled = blockers.length > 0;
    if (blockers.length > 0) {
      confirmBtn.setAttribute('aria-describedby', 'mapping-preview-confirm-hint');
    }
    confirmBtn.addEventListener('click', () => this.emitDecision());

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    footer.appendChild(info);
    footer.appendChild(actions);
    this.container.appendChild(footer);

    // Disabled-button hint
    if (blockers.length > 0) {
      const hint = document.createElement('p');
      hint.id = 'mapping-preview-confirm-hint';
      hint.className = 'mapping-preview__confirm-hint';
      hint.setAttribute('role', 'status');
      hint.textContent = blockers.join(' · ');
      this.container.appendChild(hint);
    }
  }

  /**
   * Build the interactive resolutions section (radio groups for the
   * three operator-resolvable warnings). Returns null if there is
   * nothing to resolve.
   */
  private buildResolutionsSection(): HTMLElement | null {
    const warnings = this.opts.inferenceReport.globalWarnings;
    const amountWarning = warnings.find(
      (w): w is Extract<MappingWarning, { code: 'AMBIGUOUS_AMOUNT_CONVENTION' }> =>
        w.code === 'AMBIGUOUS_AMOUNT_CONVENTION',
    );
    const dateWarnings = warnings.filter(
      (w): w is Extract<MappingWarning, { code: 'AMBIGUOUS_DATE_FORMAT' }> =>
        w.code === 'AMBIGUOUS_DATE_FORMAT',
    );
    const decimalWarnings = warnings.filter(
      (w): w is Extract<MappingWarning, { code: 'AMBIGUOUS_DECIMAL_SEPARATOR' }> =>
        w.code === 'AMBIGUOUS_DECIMAL_SEPARATOR',
    );

    if (!amountWarning && dateWarnings.length === 0 && decimalWarnings.length === 0) {
      return null;
    }

    const section = document.createElement('section');
    section.className = 'mapping-preview__resolutions';

    if (amountWarning) {
      section.appendChild(this.buildAmountConventionCard());
    }
    for (const w of dateWarnings) {
      section.appendChild(this.buildDateFormatCard(w));
    }
    for (const w of decimalWarnings) {
      section.appendChild(this.buildDecimalSeparatorCard(w));
    }
    return section;
  }

  private buildResolutionCard(
    title: string,
    radioName: string,
    options: ReadonlyArray<{ value: string; label: string; selected: boolean }>,
    onChange: (value: string) => void,
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'mapping-preview__resolution-card';
    const titleEl = document.createElement('div');
    titleEl.className = 'mapping-preview__resolution-title';
    titleEl.textContent = title;
    card.appendChild(titleEl);

    const group = document.createElement('div');
    group.className = 'mapping-preview__resolution-options';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', title);

    for (const opt of options) {
      const label = document.createElement('label');
      label.className = 'mapping-preview__resolution-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = radioName;
      input.value = opt.value;
      input.checked = opt.selected;
      input.addEventListener('change', () => {
        onChange(opt.value);
        this.render();
      });
      label.appendChild(input);
      const span = document.createElement('span');
      span.textContent = opt.label;
      label.appendChild(span);
      group.appendChild(label);
    }
    card.appendChild(group);
    return card;
  }

  private buildAmountConventionCard(): HTMLElement {
    return this.buildResolutionCard(
      t('import.resolution.amountConvention.title'),
      'amount-convention',
      [
        {
          value: 'minor-units',
          label: t('import.resolution.amountConvention.minorUnits'),
          selected: this.amountConvention === 'minor-units',
        },
        {
          value: 'major-decimal',
          label: t('import.resolution.amountConvention.majorDecimal'),
          selected: this.amountConvention === 'major-decimal',
        },
      ],
      (value) => {
        this.amountConvention = value as AmountConvention;
        this.pendingResolutions.delete('amountConvention');
      },
    );
  }

  private buildDateFormatCard(
    w: Extract<MappingWarning, { code: 'AMBIGUOUS_DATE_FORMAT' }>,
  ): HTMLElement {
    const colHeader = this.opts.table.headers[w.columnIndex] ?? `col_${String(w.columnIndex + 1)}`;
    const key = `dateFormat:${String(w.columnIndex)}`;
    const labelByValue: Record<DateFormatId, string> = {
      iso: t('import.resolution.dateFormat.iso'),
      'dd-mm-yyyy': t('import.resolution.dateFormat.ddmmyyyy'),
      'mm-dd-yyyy': t('import.resolution.dateFormat.mmddyyyy'),
    };
    return this.buildResolutionCard(
      `${t('import.resolution.dateFormat.title')} — ${colHeader}`,
      `date-format-${String(w.columnIndex)}`,
      w.candidates.map((c) => ({
        value: c,
        label: labelByValue[c],
        selected: this.dateFormatPerColumn[w.columnIndex] === c,
      })),
      (value) => {
        this.dateFormatPerColumn = {
          ...this.dateFormatPerColumn,
          [w.columnIndex]: value as DateFormatId,
        };
        this.pendingResolutions.delete(key);
      },
    );
  }

  private buildDecimalSeparatorCard(
    w: Extract<MappingWarning, { code: 'AMBIGUOUS_DECIMAL_SEPARATOR' }>,
  ): HTMLElement {
    const colHeader = this.opts.table.headers[w.columnIndex] ?? `col_${String(w.columnIndex + 1)}`;
    const key = `decimalSeparator:${String(w.columnIndex)}`;
    const labelByValue: Record<DecimalSeparator, string> = {
      '.': t('import.resolution.decimalSeparator.dot'),
      ',': t('import.resolution.decimalSeparator.comma'),
    };
    return this.buildResolutionCard(
      `${t('import.resolution.decimalSeparator.title')} — ${colHeader}`,
      `decimal-separator-${String(w.columnIndex)}`,
      w.candidates.map((c) => ({
        value: c,
        label: labelByValue[c],
        selected: this.decimalSeparatorPerColumn[w.columnIndex] === c,
      })),
      (value) => {
        this.decimalSeparatorPerColumn = {
          ...this.decimalSeparatorPerColumn,
          [w.columnIndex]: value as DecimalSeparator,
        };
        this.pendingResolutions.delete(key);
      },
    );
  }

  /**
   * Returns human-readable reasons the confirm button is disabled.
   * Empty array means confirm is allowed.
   */
  private confirmBlockers(): string[] {
    const blockers: string[] = [];
    const missing = this.missingRequired();
    if (missing.length > 0) {
      blockers.push(
        t('import.confirm.missingRoles').replace(
          '{roles}',
          missing.map((r) => t(ROLE_LABEL_KEYS[r])).join(', '),
        ),
      );
    }
    if (this.pendingResolutions.size > 0) {
      const what = [...this.pendingResolutions]
        .map((k) => {
          if (k === 'amountConvention') return t('import.resolution.amountConvention.title');
          if (k.startsWith('dateFormat:')) return t('import.resolution.dateFormat.title');
          if (k.startsWith('decimalSeparator:'))
            return t('import.resolution.decimalSeparator.title');
          return k;
        })
        .join(', ');
      blockers.push(t('import.confirm.pending').replace('{what}', what));
    }
    return blockers;
  }

  private buildHeaderRow(): HTMLTableSectionElement {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const col of this.opts.inferenceReport.columns) {
      tr.appendChild(this.buildColHeader(col));
    }
    thead.appendChild(tr);
    return thead;
  }

  private buildColHeader(col: ColumnInference): HTMLTableCellElement {
    const th = document.createElement('th');
    th.className = 'mapping-preview__col-header';
    const stack = document.createElement('div');
    stack.className = 'mapping-preview__col-header-stack';

    const name = document.createElement('span');
    name.className = 'mapping-preview__col-name';
    name.textContent = col.header || `col_${String(col.columnIndex + 1)}`;
    stack.appendChild(name);

    const level = confidenceLevel(col.confidence);
    const conf = document.createElement('span');
    conf.className = `mapping-preview__confidence mapping-preview__confidence--${level}`;
    conf.textContent = t(
      level === 'high'
        ? 'import.confidence.high'
        : level === 'medium'
          ? 'import.confidence.medium'
          : 'import.confidence.low',
    );
    stack.appendChild(conf);

    const select = document.createElement('select');
    select.className = 'mapping-preview__role-select';
    const currentRole = this.mapping[col.columnIndex];
    if (currentRole === 'metadata') {
      select.classList.add('mapping-preview__role-select--metadata');
    } else if (currentRole === 'ignore') {
      select.classList.add('mapping-preview__role-select--ignore');
    }
    select.setAttribute('aria-label', t('import.mapping.colRole'));
    for (const role of ROLE_ORDER) {
      const opt = document.createElement('option');
      opt.value = role;
      opt.textContent = t(ROLE_LABEL_KEYS[role]);
      if (role === currentRole) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const next = select.value as SemanticRole;
      const prev = this.mapping[col.columnIndex];
      if (prev !== next) {
        this.mapping = { ...this.mapping, [col.columnIndex]: next };
        this.operatorEdits += 1;
        this.render();
      }
    });
    stack.appendChild(select);

    th.appendChild(stack);
    return th;
  }

  private buildDataBody(): HTMLTableSectionElement {
    const tbody = document.createElement('tbody');
    const limit = Math.min(this.opts.table.rows.length, PREVIEW_ROW_LIMIT);
    for (let i = 0; i < limit; i++) {
      const tr = document.createElement('tr');
      tr.className = 'mapping-preview__row';
      const row = this.opts.table.rows[i] ?? [];
      for (let c = 0; c < this.opts.inferenceReport.columns.length; c++) {
        const td = document.createElement('td');
        td.className = 'mapping-preview__data-cell';
        const col = this.opts.inferenceReport.columns[c];
        if (col?.inferredType === 'number') td.classList.add('mapping-preview__data-cell--numeric');
        if (this.mapping[c] === 'metadata') {
          td.classList.add('mapping-preview__data-cell--metadata');
        }
        td.textContent = row[c] ?? '';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    return tbody;
  }

  private warningDetail(w: MappingWarning): string {
    switch (w.code) {
      case 'AMBIGUOUS_ROLE':
        return `${t(ROLE_LABEL_KEYS[w.role])} • cols ${w.candidateColumns.join(', ')}`;
      case 'LOW_CONFIDENCE':
        return `col ${String(w.columnIndex)} (${(w.bestConfidence * 100).toFixed(0)}%)`;
      case 'MIXED_TYPE_COLUMN':
        return `col ${String(w.columnIndex)} (${(w.mismatchRate * 100).toFixed(0)}% mismatch)`;
      case 'MISSING_REQUIRED_ROLE':
        return t(ROLE_LABEL_KEYS[w.role]);
      case 'CURRENCY_DIFFERS_FROM_WORKSPACE':
        return `col ${String(w.columnIndex)}: ${w.sampleValues.join(', ')}`;
      case 'AMBIGUOUS_DATE_FORMAT':
        return `col ${String(w.columnIndex)}: ${w.candidates.join(' / ')}`;
      case 'AMBIGUOUS_DECIMAL_SEPARATOR':
        return `col ${String(w.columnIndex)}: ${w.candidates.join(' / ')}`;
      case 'AMBIGUOUS_AMOUNT_CONVENTION':
        return `col ${String(w.columnIndex)}: ${w.candidates.join(' / ')}`;
    }
  }

  private footerInfo(): string {
    const total = this.opts.table.rows.length;
    return `${String(Math.min(total, PREVIEW_ROW_LIMIT))} / ${String(total)} filas en vista previa`;
  }

  private missingRequired(): SemanticRole[] {
    const mapped = new Set<SemanticRole>(Object.values(this.mapping));
    return REQUIRED_ROLES.filter((r) => !mapped.has(r));
  }

  private canConfirm(): boolean {
    return this.missingRequired().length === 0 && this.pendingResolutions.size === 0;
  }

  private emitDecision(): void {
    if (!this.canConfirm()) return;
    let source: MappingSource;
    if (this.operatorEdits === 0 && this.autoConfirmable) source = 'auto';
    else if (this.operatorEdits >= this.opts.inferenceReport.columns.length) source = 'manual';
    else source = 'mixed';

    const decision: MappingDecision = {
      mapping: this.mapping,
      source,
      warnings: this.opts.inferenceReport.globalWarnings,
      confirmedAt: new Date().toISOString(),
      amountConvention: this.amountConvention,
      ...(Object.keys(this.dateFormatPerColumn).length > 0
        ? { dateFormatPerColumn: this.dateFormatPerColumn }
        : {}),
      ...(Object.keys(this.decimalSeparatorPerColumn).length > 0
        ? { decimalSeparatorPerColumn: this.decimalSeparatorPerColumn }
        : {}),
    };
    this.opts.onConfirm(decision);
  }
}
