/*
 * PrivacySummary — a one-page explanation of how AutoKeep stores data
 * (Constitution Principle III: zero plaintext at rest; FR-040).
 *
 * Shown via a <dialog> or inline, depending on context.
 */

import './privacy-summary.css';

import { t } from '../../../core/i18n/index.js';

export class PrivacySummary {
  private readonly container: HTMLElement;
  private dialog: HTMLDialogElement | null = null;

  public constructor(container: HTMLElement) {
    this.container = container;
  }

  public open(): void {
    this.close();

    const dialog = document.createElement('dialog');
    dialog.className = 'privacy-summary-dialog';
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'privacy-title');

    const heading = document.createElement('h2');
    heading.id = 'privacy-title';
    heading.textContent = t('workspace.privacy.title');

    const body = document.createElement('p');
    body.textContent = t('workspace.privacy.body');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--primary';
    closeBtn.textContent = t('workspace.privacy.close');
    closeBtn.addEventListener('click', () => {
      this.close();
    });

    dialog.appendChild(heading);
    dialog.appendChild(body);
    dialog.appendChild(closeBtn);
    this.container.appendChild(dialog);
    this.dialog = dialog;
    dialog.showModal();
    closeBtn.focus();
  }

  public close(): void {
    if (this.dialog) {
      this.dialog.close();
      this.dialog.remove();
      this.dialog = null;
    }
  }
}
