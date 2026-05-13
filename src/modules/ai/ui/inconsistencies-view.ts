/*
 * InconsistenciesView — list of open findings grouped by kind (US6).
 *
 * Per-finding actions:
 *  - "Confirmar correcto" → status: dismissed
 *  - "Editar" → opens the record edit form; caller handles navigation
 */
import './inconsistencies-view.css';

import type { InconsistencyFinding, InconsistencyKind } from '../domain/types.js';

const KIND_LABELS: Record<InconsistencyKind, string> = {
  'category-mismatch': 'Categoría inusual',
  'amount-outlier': 'Importe atípico',
  'likely-duplicate': 'Posible duplicado',
};

export interface InconsistenciesViewOpts {
  readonly onDismiss: (findingId: string) => void;
  readonly onEdit: (targetRecordId: string) => void;
}

export class InconsistenciesView {
  private readonly host: HTMLElement;
  private readonly opts: InconsistenciesViewOpts;

  public constructor(host: HTMLElement, opts: InconsistenciesViewOpts) {
    this.host = host;
    this.opts = opts;
  }

  public update(findings: readonly InconsistencyFinding[]): void {
    this.host.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'inconsistencies-view';

    const open = findings.filter((f) => f.status === 'open');

    if (open.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'inconsistencies-view__empty';
      empty.textContent = 'No hay inconsistencias detectadas.';
      container.appendChild(empty);
      this.host.appendChild(container);
      return;
    }

    // Group by kind
    const groups = new Map<InconsistencyKind, InconsistencyFinding[]>();
    for (const f of open) {
      const arr = groups.get(f.kind) ?? [];
      arr.push(f);
      groups.set(f.kind, arr);
    }

    for (const [kind, items] of groups) {
      const groupEl = document.createElement('section');
      groupEl.className = 'inconsistencies-view__group';
      groupEl.setAttribute('aria-label', KIND_LABELS[kind]);

      const title = document.createElement('h3');
      title.className = 'inconsistencies-view__group-title';
      title.textContent = KIND_LABELS[kind];
      groupEl.appendChild(title);

      for (const finding of items) {
        groupEl.appendChild(this.renderFinding(finding));
      }

      container.appendChild(groupEl);
    }

    this.host.appendChild(container);
  }

  private renderFinding(finding: InconsistencyFinding): HTMLElement {
    const item = document.createElement('article');
    item.className = 'inconsistencies-view__item';

    const reason = document.createElement('p');
    reason.className = 'inconsistencies-view__reason';
    reason.textContent = finding.reason;
    item.appendChild(reason);

    const actions = document.createElement('div');
    actions.className = 'inconsistencies-view__actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'inconsistencies-view__btn';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => {
      this.opts.onEdit(finding.targetRecordId);
    });
    actions.appendChild(editBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'inconsistencies-view__btn inconsistencies-view__btn--dismiss';
    dismissBtn.textContent = 'Confirmar correcto';
    dismissBtn.addEventListener('click', () => {
      this.opts.onDismiss(finding.id);
    });
    actions.appendChild(dismissBtn);

    item.appendChild(actions);
    return item;
  }
}
