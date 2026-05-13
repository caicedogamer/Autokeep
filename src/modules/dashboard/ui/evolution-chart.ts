/*
 * EvolutionChart — Chart.js line chart for income/expense/net over time.
 *
 * Accessibility: wrapped in <figure aria-label>, plus a visually-hidden
 * <table> so screen readers can access the data (FR-037).
 */
import './evolution-chart.css';

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';

import type { EvolutionResult } from '../domain/aggregations.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
);

export interface EvolutionChartOpts {
  readonly currencyCode: string;
  readonly currencyMinorUnits: number;
}

export class EvolutionChart {
  private readonly host: HTMLElement;
  private readonly opts: EvolutionChartOpts;
  private chart: Chart | null = null;

  public constructor(host: HTMLElement, opts: EvolutionChartOpts) {
    this.host = host;
    this.opts = opts;
  }

  public update(result: EvolutionResult): void {
    this.host.innerHTML = '';

    const figure = document.createElement('figure');
    figure.className = 'evolution-chart';
    const title = `Evolución por ${result.granularity === 'day' ? 'día' : result.granularity === 'week' ? 'semana' : 'mes'}`;
    figure.setAttribute('aria-label', title);

    const heading = document.createElement('h3');
    heading.className = 'evolution-chart__title';
    heading.textContent = title;
    figure.appendChild(heading);

    if (result.isEmpty) {
      const empty = document.createElement('p');
      empty.className = 'evolution-chart__empty';
      empty.textContent = 'Sin datos en el período seleccionado.';
      figure.appendChild(empty);
      this.host.appendChild(figure);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'evolution-chart__canvas-wrap';

    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', title);
    wrap.appendChild(canvas);
    figure.appendChild(wrap);

    // Screen-reader table (FR-037)
    const srTable = this.buildSrTable(result);
    figure.appendChild(srTable);

    this.host.appendChild(figure);

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    const factor = Math.pow(10, this.opts.currencyMinorUnits);
    const labels = result.points.map((p) => p.label);
    const incomeData = result.points.map((p) => p.income / factor);
    const expensesData = result.points.map((p) => p.expenses / factor);

    this.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ingresos',
            data: incomeData,
            borderColor: '#1d6c3a',
            backgroundColor: 'rgba(29,108,58,0.1)',
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Egresos',
            data: expensesData,
            borderColor: '#b3261e',
            backgroundColor: 'rgba(179,38,30,0.1)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const raw = ctx.parsed.y ?? 0;
                return ` ${ctx.dataset.label ?? ''}: ${raw.toFixed(this.opts.currencyMinorUnits)} ${this.opts.currencyCode}`;
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true },
        },
      },
    });
  }

  private buildSrTable(result: EvolutionResult): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'evolution-chart__sr-table';
    table.setAttribute('aria-hidden', 'false');

    const caption = document.createElement('caption');
    caption.textContent = 'Datos de evolución financiera';
    table.appendChild(caption);

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const h of ['Período', 'Ingresos', 'Egresos', 'Neto']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const factor = Math.pow(10, this.opts.currencyMinorUnits);
    for (const p of result.points) {
      const tr = document.createElement('tr');
      const vals = [
        p.label,
        (p.income / factor).toFixed(this.opts.currencyMinorUnits),
        (p.expenses / factor).toFixed(this.opts.currencyMinorUnits),
        (p.net / factor).toFixed(this.opts.currencyMinorUnits),
      ];
      for (const v of vals) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      }
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
