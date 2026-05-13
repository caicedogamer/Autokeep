/*
 * ValidationReport UI — shows validation outcome, per-row errors, and
 * commit/cancel actions.
 */

import './validation-report.css';

import type { ValidationReport } from '../domain/types.js';
import { t } from '../../../core/i18n/index.js';

export interface ValidationReportOpts {
  readonly onCommit: (truncate: boolean) => void;
  readonly onCancel: () => void;
}

export class ValidationReportView {
  private readonly host: HTMLElement;
  private readonly opts: ValidationReportOpts;

  public constructor(host: HTMLElement, opts: ValidationReportOpts) {
    this.host = host;
    this.opts = opts;
  }

  public update(report: ValidationReport): void {
    this.host.innerHTML = '';

    const section = document.createElement('section');
    section.className = 'validation-report';
    section.setAttribute('aria-live', 'polite');

    // Summary
    const summary = document.createElement('p');
    summary.className = `validation-outcome validation-outcome--${report.outcome}`;
    summary.textContent = `Resultado: ${report.outcome} — ${String(report.validRows.length)} válidos / ${String(report.errorRows.length)} errores`;
    section.appendChild(summary);

    // Capacity warning
    if (report.capacityWarning) {
      const warn = document.createElement('p');
      warn.className = 'capacity-warning';
      const { allowedCount, wouldExceed } = report.capacityWarning;
      warn.textContent = `Capacidad: ${String(wouldExceed)} filas exceden el límite. Se podrán importar ${String(allowedCount)}.`;
      section.appendChild(warn);
    }

    // Error table
    if (report.errorRows.length > 0) {
      const details = document.createElement('details');
      details.open = report.validRows.length === 0;
      const sum = document.createElement('summary');
      sum.textContent = `${String(report.errorRows.length)} filas con errores`;
      details.appendChild(sum);

      const table = document.createElement('table');
      table.setAttribute('aria-label', 'Errores de importación');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['Fila', 'Errores'].forEach((h) => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = h;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const err of report.errorRows) {
        const tr = document.createElement('tr');
        const rowTd = document.createElement('td');
        rowTd.textContent = String(err.rowNumber);
        const codesTd = document.createElement('td');
        codesTd.textContent = err.codes.join(', ');
        tr.appendChild(rowTd);
        tr.appendChild(codesTd);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      details.appendChild(table);
      section.appendChild(details);
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'validation-actions';

    if (report.outcome !== 'rejected-structural' && report.outcome !== 'rejected-all') {
      const commitBtn = document.createElement('button');
      commitBtn.type = 'button';
      const truncate = report.capacityWarning !== undefined;
      const warningAllowed = report.capacityWarning?.allowedCount ?? 0;
      commitBtn.textContent = truncate
        ? `Importar ${String(warningAllowed)} filas`
        : t('import.commit' as Parameters<typeof t>[0]);
      commitBtn.addEventListener('click', () => this.opts.onCommit(truncate));
      actions.appendChild(commitBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('common.cancel');
    cancelBtn.addEventListener('click', () => this.opts.onCancel());
    actions.appendChild(cancelBtn);

    section.appendChild(actions);
    this.host.appendChild(section);
  }
}
