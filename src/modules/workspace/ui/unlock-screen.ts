/*
 * UnlockScreen — passphrase prompt for an existing workspace (FR-040).
 *
 * Integrates with UnlockThrottle (SC-015): renders the backoff delay when
 * throttled and disables the submit button until the wait elapses.
 */

import './unlock-screen.css';

import { t } from '../../../core/i18n/index.js';
import type { WorkspaceIndexEntry } from '../services/workspace-service.js';
import type { UnlockThrottle } from '../services/unlock-throttle.js';

export interface UnlockScreenCallbacks {
  readonly onUnlock: (workspaceId: string, passphrase: string) => Promise<void>;
  readonly onCreateNew: () => void;
}

export class UnlockScreen {
  private readonly container: HTMLElement;
  private readonly callbacks: UnlockScreenCallbacks;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(container: HTMLElement, callbacks: UnlockScreenCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(workspaces: readonly WorkspaceIndexEntry[], throttle: UnlockThrottle): void {
    this.container.innerHTML = '';

    const section = document.createElement('section');
    section.className = 'unlock-screen';
    section.setAttribute('aria-labelledby', 'unlock-title');

    const heading = document.createElement('h1');
    heading.id = 'unlock-title';
    heading.textContent = t('workspace.unlock.title');

    const form = document.createElement('form');
    form.className = 'unlock-screen__form';
    form.noValidate = true;

    // Workspace selector (if multiple workspaces)
    const wsGroup = document.createElement('div');
    wsGroup.className = 'form-group';
    const wsSelect = document.createElement('select');
    wsSelect.id = 'unlock-workspace';
    wsSelect.name = 'workspaceId';
    for (const ws of workspaces) {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = ws.name;
      wsSelect.appendChild(opt);
    }
    if (workspaces.length > 1) {
      const wsLbl = document.createElement('label');
      wsLbl.htmlFor = 'unlock-workspace';
      wsLbl.textContent = 'Espacio de trabajo';
      wsGroup.appendChild(wsLbl);
      wsGroup.appendChild(wsSelect);
      form.appendChild(wsGroup);
    }

    // Passphrase field
    const ppGroup = document.createElement('div');
    ppGroup.className = 'form-group';
    const ppLbl = document.createElement('label');
    ppLbl.htmlFor = 'unlock-passphrase';
    ppLbl.textContent = t('workspace.unlock.passphrase');
    const ppInput = document.createElement('input');
    ppInput.type = 'password';
    ppInput.id = 'unlock-passphrase';
    ppInput.name = 'passphrase';
    ppInput.required = true;
    ppInput.autocomplete = 'current-password';
    ppGroup.appendChild(ppLbl);
    ppGroup.appendChild(ppInput);
    form.appendChild(ppGroup);

    const errorEl = document.createElement('p');
    errorEl.role = 'alert';
    errorEl.className = 'unlock-screen__error visually-hidden';

    const busyEl = document.createElement('p');
    busyEl.role = 'status';
    busyEl.className = 'unlock-screen__busy visually-hidden';
    busyEl.textContent = t('common.loading');

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn--primary';
    submitBtn.textContent = t('workspace.unlock.submit');

    form.appendChild(errorEl);
    form.appendChild(busyEl);
    form.appendChild(submitBtn);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const workspaceId = workspaces.length === 1 ? (workspaces[0]?.id ?? '') : wsSelect.value;
      void this.handleSubmit(workspaceId, ppInput, errorEl, busyEl, submitBtn, throttle);
    });

    // Create new workspace link
    const createLink = document.createElement('button');
    createLink.type = 'button';
    createLink.className = 'btn btn--link';
    createLink.textContent = t('workspace.unlock.createNew');
    createLink.addEventListener('click', () => {
      this.callbacks.onCreateNew();
    });

    section.appendChild(heading);
    section.appendChild(form);
    section.appendChild(createLink);
    this.container.appendChild(section);
    ppInput.focus();
  }

  private async handleSubmit(
    workspaceId: string,
    ppInput: HTMLInputElement,
    errorEl: HTMLElement,
    busyEl: HTMLElement,
    submitBtn: HTMLButtonElement,
    throttle: UnlockThrottle,
  ): Promise<void> {
    const check = await throttle.check();
    if (!check.allowed) {
      const waitMs = check.waitMs > 0 ? check.waitMs : 1000;
      this.showError(errorEl, t('workspace.unlock.throttle'));
      submitBtn.disabled = true;
      this.scheduleReEnable(submitBtn, errorEl, waitMs);
      return;
    }

    const passphrase = ppInput.value;
    ppInput.value = '';
    this.hideError(errorEl);
    busyEl.classList.remove('visually-hidden');
    submitBtn.disabled = true;

    try {
      await this.callbacks.onUnlock(workspaceId, passphrase);
      await throttle.recordSuccess();
    } catch {
      await throttle.recordFailure();
      busyEl.classList.add('visually-hidden');
      submitBtn.disabled = false;
      this.showError(errorEl, t('workspace.unlock.wrongPassphrase'));
    }
  }

  private scheduleReEnable(btn: HTMLButtonElement, errorEl: HTMLElement, waitMs: number): void {
    if (this.throttleTimer !== null) clearTimeout(this.throttleTimer);
    this.throttleTimer = setTimeout(() => {
      btn.disabled = false;
      this.hideError(errorEl);
      this.throttleTimer = null;
    }, waitMs);
  }

  public dispose(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  private showError(el: HTMLElement, msg: string): void {
    el.textContent = msg;
    el.classList.remove('visually-hidden');
  }

  private hideError(el: HTMLElement): void {
    el.textContent = '';
    el.classList.add('visually-hidden');
  }
}
