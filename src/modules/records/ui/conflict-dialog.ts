/*
 * ConflictDialog — shown when RecordsService throws RecordConflictError (FR-036).
 *
 * Presents the operator with a choice:
 *   a) Keep the stored version (discard their edits).
 *   b) Force-overwrite (save their edits over the stored version).
 *
 * Uses <dialog> for accessible modal behavior.
 */

import './conflict-dialog.css';

import type { ConflictInfo } from '../domain/types.js';
import { t } from '../../../core/i18n/index.js';

export interface ConflictDialogCallbacks {
  readonly onKeepStored: (info: ConflictInfo) => void;
  readonly onForceOverwrite: (info: ConflictInfo) => void;
}

export class ConflictDialog {
  private readonly container: HTMLElement;
  private dialog: HTMLDialogElement | null = null;

  public constructor(container: HTMLElement) {
    this.container = container;
  }

  public open(info: ConflictInfo, callbacks: ConflictDialogCallbacks): void {
    this.close();

    const dialog = document.createElement('dialog');
    dialog.className = 'conflict-dialog';
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'conflict-dialog-title');

    const heading = document.createElement('h2');
    heading.id = 'conflict-dialog-title';
    heading.textContent = t('records.conflict.title');

    const body = document.createElement('p');
    body.textContent = t('records.conflict.body');

    const actions = document.createElement('div');
    actions.className = 'conflict-dialog__actions';

    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.className = 'btn btn--secondary';
    keepBtn.textContent = t('records.conflict.keepStored');
    keepBtn.addEventListener('click', () => {
      this.close();
      callbacks.onKeepStored(info);
    });

    const overwriteBtn = document.createElement('button');
    overwriteBtn.type = 'button';
    overwriteBtn.className = 'btn btn--danger';
    overwriteBtn.textContent = t('records.conflict.forceOverwrite');
    overwriteBtn.addEventListener('click', () => {
      this.close();
      callbacks.onForceOverwrite(info);
    });

    actions.appendChild(keepBtn);
    actions.appendChild(overwriteBtn);
    dialog.appendChild(heading);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    this.container.appendChild(dialog);
    this.dialog = dialog;
    dialog.showModal();

    keepBtn.focus();
  }

  public close(): void {
    if (this.dialog) {
      this.dialog.close();
      this.dialog.remove();
      this.dialog = null;
    }
  }
}
