/*
 * SuggestionChip — shown next to the category field on the record form when
 * a suggestion is available (US6).
 *
 * - "Usar sugerencia" → applies the proposed category to the form field
 *   (NOT persisted to storage — FR-026).
 * - "Descartar" → records the rejection and hides the chip.
 */
import './suggestion-chip.css';

import type { Suggestion } from '../domain/types.js';
import { confidenceLabel } from '../domain/types.js';

export interface SuggestionChipOpts {
  /** Map of categoryId → display name for rendering. */
  readonly categoryNames: ReadonlyMap<string, string>;
  /** Called with the proposed categoryId when the operator accepts. */
  readonly onAccept: (categoryId: string) => void;
  /** Called when the operator dismisses; used to improve future suggestions. */
  readonly onDismiss: () => void;
}

export class SuggestionChip {
  private readonly host: HTMLElement;
  private readonly opts: SuggestionChipOpts;

  public constructor(host: HTMLElement, opts: SuggestionChipOpts) {
    this.host = host;
    this.opts = opts;
  }

  public show(suggestion: Suggestion): void {
    this.host.innerHTML = '';

    const categoryName =
      this.opts.categoryNames.get(suggestion.proposedCategoryId) ?? suggestion.proposedCategoryId;
    const label = confidenceLabel(suggestion.confidence);

    const chip = document.createElement('div');
    chip.className = 'suggestion-chip';
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-label', `Sugerencia de categoría: ${categoryName}, confianza ${label}`);

    const labelEl = document.createElement('span');
    labelEl.className = 'suggestion-chip__label';
    labelEl.textContent = 'Sugerencia:';
    chip.appendChild(labelEl);

    const catEl = document.createElement('span');
    catEl.className = 'suggestion-chip__category';
    catEl.textContent = categoryName;
    chip.appendChild(catEl);

    const confEl = document.createElement('span');
    confEl.className = `suggestion-chip__confidence suggestion-chip__confidence--${label}`;
    confEl.textContent = label;
    chip.appendChild(confEl);

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'suggestion-chip__btn suggestion-chip__btn--accept';
    acceptBtn.textContent = 'Usar sugerencia';
    acceptBtn.addEventListener('click', () => {
      this.host.innerHTML = '';
      this.opts.onAccept(suggestion.proposedCategoryId);
    });
    chip.appendChild(acceptBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'suggestion-chip__btn suggestion-chip__btn--dismiss';
    dismissBtn.textContent = 'Descartar';
    dismissBtn.addEventListener('click', () => {
      this.host.innerHTML = '';
      this.opts.onDismiss();
    });
    chip.appendChild(dismissBtn);

    this.host.appendChild(chip);
  }

  public hide(): void {
    this.host.innerHTML = '';
  }
}
