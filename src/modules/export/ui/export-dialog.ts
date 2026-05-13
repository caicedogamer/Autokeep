/*
 * ExportDialog — modal dialog for selecting export format and confirming.
 * Accessible via role="dialog" and focus trap.
 */

import './export-dialog.css';

import type { ExportFormat } from '../services/export-service.js';
import { t } from '../../../core/i18n/index.js';

export interface ExportDialogOpts {
  readonly onExport: (format: ExportFormat) => void | Promise<void>;
  readonly onCancel: () => void;
}

export class ExportDialog {
  private readonly host: HTMLElement;
  private readonly opts: ExportDialogOpts;
  private dialog: HTMLDialogElement | null = null;

  public constructor(host: HTMLElement, opts: ExportDialogOpts) {
    this.host = host;
    this.opts = opts;
  }

  public open(): void {
    this.host.innerHTML = '';

    const dialog = document.createElement('dialog');
    dialog.className = 'export-dialog';
    dialog.setAttribute('aria-labelledby', 'export-dialog-title');
    this.dialog = dialog;

    const title = document.createElement('h2');
    title.id = 'export-dialog-title';
    title.textContent = t('export.title' as Parameters<typeof t>[0]);
    dialog.appendChild(title);

    // Format selector
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = t('export.format.label' as Parameters<typeof t>[0]);
    fieldset.appendChild(legend);

    const formats: ExportFormat[] = ['csv', 'json'];
    let selectedFormat: ExportFormat = 'csv';

    for (const fmt of formats) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'export-format';
      radio.value = fmt;
      radio.checked = fmt === 'csv';
      radio.addEventListener('change', () => {
        selectedFormat = fmt;
      });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(` ${fmt.toUpperCase()}`));
      fieldset.appendChild(label);
    }
    dialog.appendChild(fieldset);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = t('export.confirm' as Parameters<typeof t>[0]);
    exportBtn.addEventListener('click', () => {
      this.close();
      void this.opts.onExport(selectedFormat);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('common.cancel');
    cancelBtn.addEventListener('click', () => {
      this.close();
      this.opts.onCancel();
    });

    actions.appendChild(exportBtn);
    actions.appendChild(cancelBtn);
    dialog.appendChild(actions);

    dialog.addEventListener('cancel', () => {
      this.opts.onCancel();
    });

    this.host.appendChild(dialog);
    dialog.showModal();
    exportBtn.focus();
  }

  public close(): void {
    if (this.dialog?.open) {
      this.dialog.close();
    }
    this.host.innerHTML = '';
    this.dialog = null;
  }
}
