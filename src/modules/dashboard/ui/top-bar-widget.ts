/*
 * TopBarWidget — shared bar-chart component for top categories and top
 * counterparties (US5). Instantiated twice with different aggregation data.
 *
 * Same accessibility treatment as EvolutionChart: aria-label on <figure> +
 * visually-hidden <table> (FR-037).
 */
import './top-bar-widget.css';

import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';

import type { CategoryRank, CounterpartyRank } from '../domain/aggregations.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export interface TopBarWidgetOpts {
  readonly title: string;
  readonly currencyCode: string;
  readonly currencyMinorUnits: number;
}

export type TopBarItem = { label: string; total: number };

export class TopBarWidget {
  private readonly host: HTMLElement;
  private readonly opts: TopBarWidgetOpts;
  private chart: Chart | null = null;

  public constructor(host: HTMLElement, opts: TopBarWidgetOpts) {
    this.host = host;
    this.opts = opts;
  }

  public updateFromCategories(
    ranks: CategoryRank[],
    categoryNames: ReadonlyMap<string, string>,
  ): void {
    const items = ranks.map((r) => ({
      label: categoryNames.get(r.categoryId) ?? r.categoryId,
      total: r.total,
    }));
    this.update(items);
  }

  public updateFromCounterparties(
    ranks: CounterpartyRank[],
    counterpartyNames: ReadonlyMap<string, string>,
  ): void {
    const items = ranks.map((r) => ({
      label: counterpartyNames.get(r.counterpartyId) ?? r.counterpartyId,
      total: r.total,
    }));
    this.update(items);
  }

  private update(items: TopBarItem[]): void {
    this.host.innerHTML = '';

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    const figure = document.createElement('figure');
    figure.className = 'top-bar-widget';
    figure.setAttribute('aria-label', this.opts.title);

    const heading = document.createElement('h3');
    heading.className = 'top-bar-widget__title';
    heading.textContent = this.opts.title;
    figure.appendChild(heading);

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'top-bar-widget__empty';
      empty.textContent = 'Sin datos en el período seleccionado.';
      figure.appendChild(empty);
      this.host.appendChild(figure);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'top-bar-widget__canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', this.opts.title);
    wrap.appendChild(canvas);
    figure.appendChild(wrap);

    // Screen-reader table (FR-037)
    figure.appendChild(this.buildSrTable(items));

    this.host.appendChild(figure);

    const factor = Math.pow(10, this.opts.currencyMinorUnits);
    const { currencyCode, currencyMinorUnits } = this.opts;

    this.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: items.map((i) => i.label),
        datasets: [
          {
            label: 'Total',
            data: items.map((i) => i.total / factor),
            backgroundColor: 'rgba(31,95,190,0.7)',
            borderColor: '#1f5fbe',
            borderWidth: 1,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${(ctx.parsed.x ?? 0).toFixed(currencyMinorUnits)} ${currencyCode}`,
            },
          },
        },
        scales: {
          x: { beginAtZero: true },
        },
      },
    });
  }

  private buildSrTable(items: TopBarItem[]): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'top-bar-widget__sr-table';

    const caption = document.createElement('caption');
    caption.textContent = this.opts.title;
    table.appendChild(caption);

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const h of ['Nombre', 'Total']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const factor = Math.pow(10, this.opts.currencyMinorUnits);
    for (const item of items) {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      tdLabel.textContent = item.label;
      const tdTotal = document.createElement('td');
      tdTotal.textContent = (item.total / factor).toFixed(this.opts.currencyMinorUnits);
      tr.appendChild(tdLabel);
      tr.appendChild(tdTotal);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  public destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}
