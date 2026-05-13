/*
 * SetupScreen — first-run flow for creating a new workspace (FR-040).
 *
 * Renders a form asking for workspace name, currency, locale, and passphrase.
 * The passphrase is validated locally (minimum length) and never stored.
 * Heavy KDF work is done inside the KDF worker; this screen only collects
 * input and delegates to WorkspaceService.
 */

import './setup-screen.css';

import { t } from '../../../core/i18n/index.js';
import type { CreateWorkspaceInput } from '../services/workspace-service.js';

export interface SetupScreenCallbacks {
  readonly onSubmit: (input: CreateWorkspaceInput) => Promise<void>;
}

const SUPPORTED_CURRENCIES: ReadonlyArray<{ code: string; minorUnits: 0 | 2 | 3; label: string }> =
  [
    { code: 'ARS', minorUnits: 2, label: 'ARS — Peso argentino' },
    { code: 'USD', minorUnits: 2, label: 'USD — Dólar estadounidense' },
    { code: 'EUR', minorUnits: 2, label: 'EUR — Euro' },
    { code: 'BRL', minorUnits: 2, label: 'BRL — Real brasileño' },
    { code: 'CLP', minorUnits: 0, label: 'CLP — Peso chileno' },
    { code: 'MXN', minorUnits: 2, label: 'MXN — Peso mexicano' },
    { code: 'UYU', minorUnits: 2, label: 'UYU — Peso uruguayo' },
    { code: 'JPY', minorUnits: 0, label: 'JPY — Yen japonés' },
  ] as const;

const SUPPORTED_LOCALES: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: 'es-AR', label: 'Español (Argentina)' },
  { tag: 'es-MX', label: 'Español (México)' },
  { tag: 'es-CL', label: 'Español (Chile)' },
  { tag: 'es', label: 'Español (genérico)' },
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'pt-BR', label: 'Português (Brasil)' },
];

export class SetupScreen {
  private readonly container: HTMLElement;
  private readonly callbacks: SetupScreenCallbacks;

  public constructor(container: HTMLElement, callbacks: SetupScreenCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(): void {
    this.container.innerHTML = '';

    const section = document.createElement('section');
    section.className = 'setup-screen';
    section.setAttribute('aria-labelledby', 'setup-title');

    const heading = document.createElement('h1');
    heading.id = 'setup-title';
    heading.textContent = t('workspace.setup.title');

    const passphraseHelp = document.createElement('p');
    passphraseHelp.className = 'setup-screen__passphrase-help';
    passphraseHelp.textContent = t('workspace.setup.passphraseHelp');

    const form = document.createElement('form');
    form.className = 'setup-screen__form';
    form.noValidate = true;

    const errorEl = document.createElement('p');
    errorEl.role = 'alert';
    errorEl.className = 'setup-screen__error visually-hidden';

    const busyEl = document.createElement('p');
    busyEl.role = 'status';
    busyEl.className = 'setup-screen__busy visually-hidden';
    busyEl.textContent = t('common.loading');

    form.appendChild(this.makeTextInput('name', t('workspace.setup.name'), true));
    form.appendChild(this.makeCurrencySelect());
    form.appendChild(this.makeLocaleSelect());
    form.appendChild(this.makePasswordInput('passphrase', t('workspace.setup.passphrase'), true));
    form.appendChild(
      this.makePasswordInput('passphraseConfirm', t('workspace.setup.passphraseConfirm'), true),
    );
    form.appendChild(errorEl);
    form.appendChild(busyEl);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn--primary';
    submit.textContent = t('workspace.setup.submit');
    form.appendChild(submit);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.handleSubmit(form, errorEl, busyEl, submit);
    });

    section.appendChild(heading);
    section.appendChild(passphraseHelp);
    section.appendChild(form);
    this.container.appendChild(section);
  }

  private async handleSubmit(
    form: HTMLFormElement,
    errorEl: HTMLElement,
    busyEl: HTMLElement,
    submitBtn: HTMLButtonElement,
  ): Promise<void> {
    const data = new FormData(form);
    const name = (data.get('name') as string).trim();
    const currencyRaw = data.get('currency') as string;
    const locale = data.get('locale') as string;
    const passphrase = data.get('passphrase') as string;
    const passphraseConfirm = data.get('passphraseConfirm') as string;

    if (name.length < 1) {
      this.showError(errorEl, t('workspace.setup.error.nameTooShort'));
      return;
    }
    if (passphrase.length < 8) {
      this.showError(errorEl, t('workspace.setup.error.passphraseTooShort'));
      return;
    }
    if (passphrase !== passphraseConfirm) {
      this.showError(errorEl, t('workspace.setup.error.passphraseMismatch'));
      return;
    }

    const currencyEntry = SUPPORTED_CURRENCIES.find((c) => c.code === currencyRaw);
    const currency = currencyEntry?.code ?? 'ARS';
    const currencyMinorUnits: 0 | 2 | 3 = currencyEntry?.minorUnits ?? 2;

    this.hideError(errorEl);
    busyEl.classList.remove('visually-hidden');
    submitBtn.disabled = true;

    try {
      await this.callbacks.onSubmit({ name, currency, currencyMinorUnits, locale, passphrase });
    } catch (err) {
      busyEl.classList.add('visually-hidden');
      submitBtn.disabled = false;
      this.showError(errorEl, err instanceof Error ? err.message : String(err));
    }
  }

  private makeTextInput(name: string, label: string, required: boolean): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = `setup-${name}`;
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `setup-${name}`;
    input.name = name;
    input.required = required;
    group.appendChild(lbl);
    group.appendChild(input);
    return group;
  }

  private makePasswordInput(name: string, label: string, required: boolean): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = `setup-${name}`;
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'password';
    input.id = `setup-${name}`;
    input.name = name;
    input.required = required;
    input.autocomplete = name === 'passphrase' ? 'new-password' : 'new-password';
    group.appendChild(lbl);
    group.appendChild(input);
    return group;
  }

  private makeCurrencySelect(): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = 'setup-currency';
    lbl.textContent = t('workspace.setup.currency');
    const select = document.createElement('select');
    select.id = 'setup-currency';
    select.name = 'currency';
    select.required = true;
    for (const c of SUPPORTED_CURRENCIES) {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = c.label;
      if (c.code === 'ARS') opt.selected = true;
      select.appendChild(opt);
    }
    group.appendChild(lbl);
    group.appendChild(select);
    return group;
  }

  private makeLocaleSelect(): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.htmlFor = 'setup-locale';
    lbl.textContent = t('workspace.setup.locale');
    const select = document.createElement('select');
    select.id = 'setup-locale';
    select.name = 'locale';
    select.required = true;
    for (const loc of SUPPORTED_LOCALES) {
      const opt = document.createElement('option');
      opt.value = loc.tag;
      opt.textContent = loc.label;
      if (loc.tag === 'es-AR') opt.selected = true;
      select.appendChild(opt);
    }
    group.appendChild(lbl);
    group.appendChild(select);
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
