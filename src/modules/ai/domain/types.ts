/*
 * AI module domain types (US6).
 * No DOM. No I/O. Pure TypeScript.
 */

import type { Id, IsoDateTime } from '../../records/domain/types.js';
import type { FinancialRecord } from '../../records/domain/types.js';

/* ---------- Suggestion (computed on demand, not persisted long-term) ---------- */

export interface SuggestionBasisEntry {
  readonly recordId: Id;
  readonly reason: 'exact-counterparty' | 'token-overlap';
}

export interface Suggestion {
  readonly targetRecordDraft: Partial<FinancialRecord>;
  readonly proposedCategoryId: Id;
  /** 0..1 — surface textually, never as a raw decimal (FR-026). */
  readonly confidence: number;
  readonly basis: readonly SuggestionBasisEntry[];
}

/* ---------- InconsistencyFinding (persisted while open) ---------- */

export type InconsistencyKind = 'category-mismatch' | 'amount-outlier' | 'likely-duplicate';

export type InconsistencyStatus = 'open' | 'dismissed' | 'resolved-by-edit';

export interface InconsistencyFinding {
  readonly id: Id;
  readonly targetRecordId: Id;
  readonly kind: InconsistencyKind;
  /** Operator-readable reason in Spanish (FR-038). */
  readonly reason: string;
  /** Record IDs that informed this finding (explainability, Principle VI). */
  readonly basis: readonly Id[];
  readonly status: InconsistencyStatus;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: 1;
}

/* ---------- AI settings ---------- */

export interface AiSettings {
  /** Global kill-switch (SC-009). When false, all AI paths short-circuit. */
  readonly aiEnabled: boolean;
  /**
   * Minimum number of historical records per counterparty before a
   * suggestion is emitted (prevents low-sample guesses).
   */
  readonly suggestionMinSupport: number;
  /** Minimum confidence (0..1) for a suggestion to be shown. */
  readonly suggestionMinConfidence: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  aiEnabled: true,
  suggestionMinSupport: 3,
  suggestionMinConfidence: 0.6,
};

/* ---------- Textual confidence labels (FR-026) ---------- */

export function confidenceLabel(confidence: number): 'alta' | 'media' | 'baja' {
  if (confidence >= 0.8) return 'alta';
  if (confidence >= 0.6) return 'media';
  return 'baja';
}
