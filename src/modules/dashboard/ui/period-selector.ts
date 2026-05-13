import './period-selector.css';

import type { DashboardPeriod, DashboardPeriodKind } from '../domain/period.js';
import { resolvePreset, customPeriod } from '../domain/period.js';
import type { IsoDate } from '../../records/domain/types.js';
import { toIsoDate } from '../../records/domain/types.js';

export const DASHBOARD_PERIOD_CHANGED = 'dashboard:period-changed' as const;

export interface PeriodSelectorOpts {
  readonly initial?: DashboardPeriod;
  readonly onChange: (period: DashboardPeriod) => void;
}

const PRESET_LABELS: Record<Exclude<DashboardPeriodKind, 'custom'>, string> = {
  thisMonth: 'Este mes',
  lastMonth: 'Mes anterior',
  thisQuarter: 'Este trimestre',
  lastQuarter: 'Trimestre anterior',
  thisYear: 'Este año',
};

export class PeriodSelector {
  private readonly host: HTMLElement;
  private readonly opts: PeriodSelectorOpts;
  private current: DashboardPeriod;

  public constructor(host: HTMLElement, opts: PeriodSelectorOpts) {
    this.host = host;
    this.opts = opts;
    this.current = opts.initial ?? resolvePreset('thisMonth');
    this.render();
  }

  private render(): void {
    this.host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'period-selector';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Período del tablero');

    const presetsEl = document.createElement('div');
    presetsEl.className = 'period-selector__presets';

    const presets: Exclude<DashboardPeriodKind, 'custom'>[] = [
      'thisMonth',
      'lastMonth',
      'thisQuarter',
      'lastQuarter',
      'thisYear',
    ];

    for (const kind of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'period-selector__btn';
      btn.textContent = PRESET_LABELS[kind];
      btn.setAttribute('aria-pressed', String(this.current.kind === kind));
      btn.addEventListener('click', () => {
        this.current = resolvePreset(kind);
        this.render();
        this.opts.onChange(this.current);
      });
      presetsEl.appendChild(btn);
    }

    root.appendChild(presetsEl);

    // Custom range inputs
    const customEl = document.createElement('div');
    customEl.className = 'period-selector__custom';

    const fromLabel = document.createElement('label');
    fromLabel.textContent = 'Desde';
    const fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.value = this.current.kind === 'custom' ? (this.current.from as string) : '';
    fromLabel.appendChild(fromInput);

    const toLabel = document.createElement('label');
    toLabel.textContent = 'Hasta';
    const toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.value = this.current.kind === 'custom' ? (this.current.to as string) : '';
    toLabel.appendChild(toInput);

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'period-selector__btn';
    applyBtn.textContent = 'Aplicar rango';
    applyBtn.addEventListener('click', () => {
      const from = fromInput.value;
      const to = toInput.value;
      if (from && to && from <= to) {
        this.current = customPeriod(toIsoDate(from) as IsoDate, toIsoDate(to) as IsoDate);
        this.render();
        this.opts.onChange(this.current);
      }
    });

    customEl.appendChild(fromLabel);
    customEl.appendChild(toLabel);
    customEl.appendChild(applyBtn);
    root.appendChild(customEl);

    this.host.appendChild(root);
  }

  public getCurrent(): DashboardPeriod {
    return this.current;
  }
}
