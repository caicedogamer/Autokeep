/*
 * CapBanner — dataset-cap warnings (FR-041, SC-016).
 *
 * Soft warning (8 000 records): non-blocking banner.
 * Hard cap (CapacityExceededError): blocking dialog with export + new-workspace guidance.
 */

import type { WorkspacePayloadV1 } from '../../workspace/services/workspace-service.js';
import {
  evaluateCapacity,
  CAPACITY_SOFT_WARNING_THRESHOLD,
} from '../../workspace/services/capacity-gate.js';

export interface CapBannerOpts {
  readonly onExport: () => void;
}

function injectBannerStyle(): void {
  if (document.getElementById('cap-banner-style')) return;
  const style = document.createElement('style');
  style.id = 'cap-banner-style';
  style.textContent = `
.cap-banner-soft{display:flex;align-items:center;gap:.75rem;padding:.5rem 1rem;background:#fef3c7;border-bottom:2px solid #8b5a00;font-size:.875rem;color:#8b5a00}
.cap-banner-soft button{padding:.25rem .75rem;border:1px solid #8b5a00;border-radius:4px;background:transparent;color:#8b5a00;font-weight:600;cursor:pointer}
.cap-banner-soft button:focus-visible{outline:3px solid #ffbf00;outline-offset:2px}
`;
  document.head.appendChild(style);
}

export class CapBanner {
  private readonly host: HTMLElement;
  private readonly opts: CapBannerOpts;

  public constructor(host: HTMLElement, opts: CapBannerOpts) {
    this.host = host;
    this.opts = opts;
    injectBannerStyle();
  }

  public evaluate(payload: WorkspacePayloadV1): void {
    const count = (payload.records as unknown[]).length;
    const status = evaluateCapacity(count);
    this.host.innerHTML = '';

    if (status === 'soft-warning') {
      const banner = document.createElement('div');
      banner.className = 'cap-banner-soft';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = `<span>⚠ El espacio de trabajo tiene ${String(count)} registros (límite: ${String(CAPACITY_SOFT_WARNING_THRESHOLD * 1.5)}). Exporta para hacer una copia de seguridad.</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Exportar ahora';
      btn.addEventListener('click', () => {
        this.opts.onExport();
      });
      banner.appendChild(btn);
      this.host.appendChild(banner);
    }
  }

  /**
   * Call this when `CapacityExceededError` is caught from `RecordsService.create`
   * or `ImportService.confirmCommit`. Shows a blocking modal.
   */
  public showHardCap(): void {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cap-dialog-title');
    dialog.style.cssText =
      'padding:1.5rem;border-radius:8px;border:2px solid #b3261e;max-width:480px;';

    const title = document.createElement('h2');
    title.id = 'cap-dialog-title';
    title.style.cssText = 'margin:0 0 1rem;color:#b3261e;';
    title.textContent = 'Límite de registros alcanzado';
    dialog.appendChild(title);

    const body = document.createElement('p');
    body.textContent =
      'Este espacio de trabajo ha alcanzado el límite máximo de 12 000 registros. Exporta tus datos y crea un nuevo espacio de trabajo para continuar.';
    dialog.appendChild(body);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:.75rem;margin-top:1rem;';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.style.cssText =
      'padding:.5rem 1rem;background:#b3261e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;';
    exportBtn.textContent = 'Exportar datos';
    exportBtn.addEventListener('click', () => {
      dialog.close();
      document.body.removeChild(dialog);
      this.opts.onExport();
    });
    actions.appendChild(exportBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.style.cssText =
      'padding:.5rem 1rem;border:1px solid #c7cdd5;border-radius:4px;cursor:pointer;';
    closeBtn.textContent = 'Cerrar';
    closeBtn.addEventListener('click', () => {
      dialog.close();
      document.body.removeChild(dialog);
    });
    actions.appendChild(closeBtn);

    dialog.appendChild(actions);
    document.body.appendChild(dialog);
    dialog.showModal();
    exportBtn.focus();
  }
}
