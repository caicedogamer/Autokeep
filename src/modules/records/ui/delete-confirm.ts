/*
 * DeleteConfirm — accessible confirmation dialog before deleting a record.
 *
 * Follows the ARIA alertdialog pattern so screen-readers announce the
 * destructive nature of the action automatically.
 */

import type { FinancialRecord } from '../domain/types.js';
import { t } from '../../../core/i18n/index.js';

export interface DeleteConfirmCallbacks {
  readonly onConfirm: (record: FinancialRecord) => void;
  readonly onCancel: () => void;
}

export class DeleteConfirm {
  private readonly container: HTMLElement;
  private dialog: HTMLDialogElement | null = null;

  public constructor(container: HTMLElement) {
    this.container = container;
  }

  public open(record: FinancialRecord, callbacks: DeleteConfirmCallbacks): void {
    this.close();

    const dialog = document.createElement('dialog');
    dialog.className = 'delete-confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'delete-confirm-title');
    dialog.setAttribute('aria-describedby', 'delete-confirm-desc');

    const heading = document.createElement('h2');
    heading.id = 'delete-confirm-title';
    heading.textContent = t('records.delete.title');

    const desc = document.createElement('p');
    desc.id = 'delete-confirm-desc';
    desc.textContent = t('records.delete.body').replace('{description}', record.description);

    const actions = document.createElement('div');
    actions.className = 'delete-confirm__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = t('common.cancel');
    cancelBtn.addEventListener('click', () => {
      this.close();
      callbacks.onCancel();
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn--danger';
    confirmBtn.textContent = t('records.delete.confirm');
    confirmBtn.addEventListener('click', () => {
      this.close();
      callbacks.onConfirm(record);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(heading);
    dialog.appendChild(desc);
    dialog.appendChild(actions);
    this.container.appendChild(dialog);
    this.dialog = dialog;
    dialog.showModal();

    cancelBtn.focus();
  }

  public close(): void {
    if (this.dialog) {
      this.dialog.close();
      this.dialog.remove();
      this.dialog = null;
    }
  }
}
