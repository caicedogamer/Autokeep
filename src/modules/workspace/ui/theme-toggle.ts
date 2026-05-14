import type { ThemePreference, ThemeService } from '../../../core/theme/index.js';
import { t } from '../../../core/i18n/index.js';

import './theme-toggle.css';

/**
 * Segmented toggle for the topbar: System / Light / Dark.
 *
 * Renders three `<button role="radio">` inside a `<div role="radiogroup">`.
 * Arrow keys move focus between options; Enter/Space activates. Persists
 * the choice through the injected `ThemeService`.
 */
export interface ThemeToggleOptions {
  themeService: ThemeService;
}

interface OptionDef {
  value: ThemePreference;
  label: string;
  icon: string;
}

const ICON_SYSTEM = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.4"/><path d="M6 13.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_LIGHT = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1.05 1.05M11.15 11.15l1.05 1.05M3.8 12.2l1.05-1.05M11.15 4.85l1.05-1.05" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_DARK = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M13.2 9.8A5.5 5.5 0 0 1 6.2 2.8a5.5 5.5 0 1 0 7 7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

export class ThemeToggle {
  private readonly root: HTMLElement;
  private readonly options: HTMLButtonElement[] = [];
  private readonly themeService: ThemeService;

  constructor(container: HTMLElement, options: ThemeToggleOptions) {
    this.themeService = options.themeService;

    this.root = document.createElement('div');
    this.root.className = 'theme-toggle';
    this.root.setAttribute('role', 'radiogroup');
    this.root.setAttribute('aria-label', t('theme.toggle.label'));

    const defs: OptionDef[] = [
      { value: 'system', label: t('theme.option.system'), icon: ICON_SYSTEM },
      { value: 'light', label: t('theme.option.light'), icon: ICON_LIGHT },
      { value: 'dark', label: t('theme.option.dark'), icon: ICON_DARK },
    ];

    for (const def of defs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-toggle__option';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-label', def.label);
      button.title = def.label;
      button.dataset['value'] = def.value;
      button.innerHTML = def.icon;
      button.addEventListener('click', () => this.select(def.value));
      button.addEventListener('keydown', (e) => this.onKeyDown(e));
      this.options.push(button);
      this.root.appendChild(button);
    }

    this.refresh();
    container.appendChild(this.root);
  }

  private refresh(): void {
    const current = this.themeService.getPreference();
    for (const button of this.options) {
      const isChecked = button.dataset['value'] === current;
      button.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      button.tabIndex = isChecked ? 0 : -1;
    }
  }

  private select(value: ThemePreference): void {
    this.themeService.setPreference(value);
    this.refresh();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const current = this.themeService.getPreference();
    const idx = this.options.findIndex((b) => b.dataset['value'] === current);
    if (idx < 0) return;

    let nextIdx = idx;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIdx = (idx + 1) % this.options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIdx = (idx - 1 + this.options.length) % this.options.length;
        break;
      case 'Home':
        nextIdx = 0;
        break;
      case 'End':
        nextIdx = this.options.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const target = this.options[nextIdx];
    if (!target) return;
    const value = target.dataset['value'];
    if (value === 'system' || value === 'light' || value === 'dark') {
      this.select(value);
      target.focus();
    }
  }
}
