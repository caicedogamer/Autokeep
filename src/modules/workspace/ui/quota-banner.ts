/*
 * QuotaBanner — non-blocking storage-quota warning (FR-033).
 * Shows when remaining bytes < 10% of estimated quota.
 * Includes an "exportar ahora" call to action.
 */
import './quota-banner.css';

import type { LocalStorageAdapter } from '../../../core/storage/local-storage-adapter.js';

const LOW_QUOTA_FRACTION = 0.1; // show at < 10% remaining

export interface QuotaBannerOpts {
  readonly adapter: LocalStorageAdapter;
  readonly onExport: () => void;
}

export class QuotaBanner {
  private readonly host: HTMLElement;
  private readonly opts: QuotaBannerOpts;
  private visible = false;

  public constructor(host: HTMLElement, opts: QuotaBannerOpts) {
    this.host = host;
    this.opts = opts;
  }

  /** Call periodically (e.g., after each write) to refresh the estimate. */
  public async refresh(): Promise<void> {
    const fraction = await this.estimateRemainingFraction();
    const remaining = await this.opts.adapter.estimateRemainingBytes();

    if (fraction < LOW_QUOTA_FRACTION && !this.visible) {
      this.show(remaining ?? 0);
    } else if (fraction >= LOW_QUOTA_FRACTION && this.visible) {
      this.hide();
    }
  }

  private async estimateRemainingFraction(): Promise<number> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return 1; // unknown — assume safe
    }
    try {
      const est = await navigator.storage.estimate();
      const { quota, usage } = est;
      if (quota === undefined || usage === undefined || quota === 0) return 1;
      return Math.max(0, quota - usage) / quota;
    } catch {
      return 1;
    }
  }

  private show(remainingBytes: number): void {
    this.visible = true;
    this.host.innerHTML = '';
    const banner = document.createElement('div');
    banner.className = 'quota-banner';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');

    const icon = document.createElement('span');
    icon.className = 'quota-banner__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⚠';
    banner.appendChild(icon);

    const msg = document.createElement('span');
    msg.className = 'quota-banner__message';
    const kb = Math.round(remainingBytes / 1024);
    msg.textContent = `Espacio de almacenamiento bajo (~${String(kb)} KB disponibles). Exporta tus datos para liberar espacio.`;
    banner.appendChild(msg);

    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'quota-banner__cta';
    cta.textContent = 'Exportar ahora';
    cta.addEventListener('click', () => {
      this.opts.onExport();
    });
    banner.appendChild(cta);

    this.host.appendChild(banner);
  }

  private hide(): void {
    this.visible = false;
    this.host.innerHTML = '';
  }
}
