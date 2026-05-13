import './totals-card.css';

import type { TotalsResult } from '../domain/aggregations.js';

export interface TotalsCardOpts {
  readonly currencyCode: string;
  readonly currencyMinorUnits: number;
}

function formatAmount(minor: number, minorUnits: number, currency: string): string {
  const factor = Math.pow(10, minorUnits);
  const value = minor / factor;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: minorUnits,
      maximumFractionDigits: minorUnits,
    }).format(value);
  } catch {
    return `${value.toFixed(minorUnits)} ${currency}`;
  }
}

export class TotalsCard {
  private readonly host: HTMLElement;
  private readonly opts: TotalsCardOpts;

  public constructor(host: HTMLElement, opts: TotalsCardOpts) {
    this.host = host;
    this.opts = opts;
  }

  public update(result: TotalsResult): void {
    this.host.innerHTML = '';
    const dl = document.createElement('dl');
    dl.className = 'totals-card';

    if (result.isEmpty) {
      const empty = document.createElement('p');
      empty.className = 'totals-card__empty';
      empty.textContent = 'Sin registros en el período seleccionado.';
      dl.appendChild(empty);
      this.host.appendChild(dl);
      return;
    }

    const { currencyCode, currencyMinorUnits } = this.opts;
    const fmt = (n: number): string => formatAmount(n, currencyMinorUnits, currencyCode);

    const items: Array<{ label: string; value: string; cls: string }> = [
      { label: 'Ingresos', value: fmt(result.income), cls: 'totals-card__value--income' },
      { label: 'Egresos', value: fmt(result.expenses), cls: 'totals-card__value--expense' },
      {
        label: 'Neto',
        value: fmt(Math.abs(result.net)),
        cls:
          result.net >= 0 ? 'totals-card__value--net-positive' : 'totals-card__value--net-negative',
      },
    ];

    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'totals-card__item';

      const dt = document.createElement('dt');
      dt.className = 'totals-card__label';
      dt.textContent = item.label;

      const dd = document.createElement('dd');
      dd.className = `totals-card__value ${item.cls}`;
      dd.textContent = item.value;

      div.appendChild(dt);
      div.appendChild(dd);
      dl.appendChild(div);
    }

    this.host.appendChild(dl);
  }
}
