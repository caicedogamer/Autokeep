/*
 * ChangePassphraseScreen — lets an operator change the workspace passphrase
 * (FR-040). Re-derives a new key and re-encrypts the payload atomically.
 */

import { t } from '../../../core/i18n/index.js';

export interface ChangePassphraseCallbacks {
  readonly onSubmit: (newPassphrase: string) => Promise<void>;
  readonly onCancel: () => void;
}

export class ChangePassphraseScreen {
  private readonly container: HTMLElement;
  private readonly callbacks: ChangePassphraseCallbacks;

  public constructor(container: HTMLElement, callbacks: ChangePassphraseCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(): void {
    this.container.innerHTML = '';

    const section = document.createElement('section');
    section.className = 'change-passphrase-screen';
    section.setAttribute('aria-labelledby', 'change-pp-title');

    const heading = document.createElement('h1');
    heading.id = 'change-pp-title';
    heading.textContent = t('workspace.changePassphrase.title');

    const form = document.createElement('form');
    form.className = 'change-passphrase-screen__form';
    form.noValidate = true;

    const errorEl = document.createElement('p');
    errorEl.role = 'alert';
    errorEl.className = 'change-passphrase__error visually-hidden';

    const successEl = document.createElement('p');
    successEl.role = 'status';
    successEl.className = 'change-passphrase__success visually-hidden';
    successEl.textContent = t('workspace.changePassphrase.success');

    const busyEl = document.createElement('p');
    busyEl.role = 'status';
    busyEl.className = 'change-passphrase__busy visually-hidden';
    busyEl.textContent = t('common.loading');

    form.appendChild(
      this.makePasswordInput('newPassphrase', t('workspace.changePassphrase.newPassphrase')),
    );
    form.appendChild(
      this.makePasswordInput(
        'confirmPassphrase',
        t('workspace.changePassphrase.confirmPassphrase'),
      ),
    );
    form.appendChild(errorEl);
    form.appendChild(successEl);
    form.appendChild(busyEl);

    const actions = document.createElement('div');
    actions.className = 'form-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = t('common.cancel');
    cancelBtn.addEventListener('click', () => {
      this.callbacks.onCancel();
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn--primary';
    submitBtn.textContent = t('workspace.changePassphrase.submit');

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.handleSubmit(form, errorEl, successEl, busyEl, submitBtn);
    });

    section.appendChild(heading);
    section.appendChild(form);
    this.container.appendChild(section);
  }

  private async handleSubmit(
    form: HTMLFormElement,
    errorEl: HTMLElement,
    successEl: HTMLElement,
    busyEl: HTMLElement,
    submitBtn: HTMLButtonElement,
  ): Promise<void> {
    const data = new FormData(form);
    const newPassphrase = data.get('newPassphrase') as string;
    const confirmPassphrase = data.get('confirmPassphrase') as string;

    if (newPassphrase.length < 8) {
      this.showError(errorEl, t('workspace.setup.error.passphraseTooShort'));
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      this.showError(errorEl, t('workspace.changePassphrase.error.mismatch'));
      return;
    }

    this.hideError(errorEl);
    busyEl.classList.remove('visually-hidden');
    submitBtn.disabled = true;

    try {
      await this.callbacks.onSubmit(newPassphrase);
      busyEl.classList.add('visually-hidden');
      successEl.classList.remove('visually-hidden');
      form.reset();
      submitBtn.disabled = false;
    } catch (err) {
      busyEl.classList.add('visually-hidden');
      submitBtn.disabled = false;
      this.showError(errorEl, err instanceof Error ? err.message : String(err));
    }
  }

  private makePasswordInput(name: string, label: string): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = `cpp-${name}`;
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'password';
    input.id = `cpp-${name}`;
    input.name = name;
    input.required = true;
    input.autocomplete = 'new-password';
    group.appendChild(lbl);
    group.appendChild(input);
    return group;
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
