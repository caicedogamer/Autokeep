/*
 * FilePicker — single-file drag-and-drop / click-to-select component.
 * Accepts CSV and JSON files only. Emits the selected file via onSelect.
 */

import './file-picker.css';

import { t } from '../../../core/i18n/index.js';

export interface FilePickerOpts {
  readonly onSelect: (file: File) => void;
}

export class FilePicker {
  private readonly host: HTMLElement;
  private readonly opts: FilePickerOpts;
  private fileInput!: HTMLInputElement;

  public constructor(host: HTMLElement, opts: FilePickerOpts) {
    this.host = host;
    this.opts = opts;
    this.render();
  }

  private render(): void {
    this.host.innerHTML = '';

    const zone = document.createElement('div');
    zone.className = 'file-picker-zone';
    zone.setAttribute('role', 'button');
    zone.setAttribute('tabindex', '0');
    zone.setAttribute('aria-label', t('import.picker.label' as Parameters<typeof t>[0]));

    const label = document.createElement('p');
    label.textContent = t('import.picker.label' as Parameters<typeof t>[0]);
    zone.appendChild(label);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.csv,.json,text/csv,application/json';
    this.fileInput.style.display = 'none';
    this.fileInput.setAttribute('aria-hidden', 'true');
    zone.appendChild(this.fileInput);

    zone.addEventListener('click', () => this.fileInput.click());
    zone.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.fileInput.click();
      }
    });

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) this.opts.onSelect(file);
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) this.opts.onSelect(file);
    });

    this.host.appendChild(zone);
  }
}
