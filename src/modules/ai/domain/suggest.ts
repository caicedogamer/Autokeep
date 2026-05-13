/*
 * Category suggestion heuristics (US6, SC-008).
 * Pure function — no DOM, no I/O. Two-pass strategy:
 *  1. Exact-counterparty dominant-category match (highest precision).
 *  2. Token-overlap (Jaccard) fallback across full history.
 * Returns null when confidence < threshold or support < minSupport (no
 * low-confidence guesses — FR-026).
 */

import type { FinancialRecord, Id } from '../../records/domain/types.js';
import type { AiSettings, Suggestion, SuggestionBasisEntry } from './types.js';

/* ---------- tokenization ---------- */

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ---------- helper: dominant category ---------- */

function dominantCategory(
  records: readonly FinancialRecord[],
): { categoryId: Id; count: number; total: number } | null {
  const counts = new Map<string, number>();
  for (const r of records) {
    counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + 1);
  }
  let best: { categoryId: string; count: number } | null = null;
  for (const [categoryId, count] of counts) {
    if (!best || count > best.count) best = { categoryId, count };
  }
  if (!best) return null;
  return { categoryId: best.categoryId as Id, count: best.count, total: records.length };
}

/* ---------- main export ---------- */

export function suggestCategory(
  draft: Partial<FinancialRecord>,
  history: readonly FinancialRecord[],
  settings: AiSettings,
): Suggestion | null {
  if (!settings.aiEnabled || history.length === 0) return null;

  /* Pass 1: exact-counterparty match */
  if (draft.counterpartyId) {
    const counterpartyHistory = history.filter((r) => r.counterpartyId === draft.counterpartyId);
    if (counterpartyHistory.length >= settings.suggestionMinSupport) {
      const dom = dominantCategory(counterpartyHistory);
      if (dom) {
        const confidence = dom.count / dom.total;
        if (confidence >= settings.suggestionMinConfidence) {
          const basis: SuggestionBasisEntry[] = counterpartyHistory
            .filter((r) => r.categoryId === dom.categoryId)
            .slice(0, 5)
            .map((r) => ({ recordId: r.id, reason: 'exact-counterparty' as const }));
          return {
            targetRecordDraft: draft,
            proposedCategoryId: dom.categoryId,
            confidence,
            basis,
          };
        }
      }
    }
  }

  /* Pass 2: token-overlap fallback */
  const draftDesc = draft.description ?? '';
  if (!draftDesc.trim()) return null;
  const draftTokens = tokenize(draftDesc);

  type Scored = { record: FinancialRecord; score: number };
  const scored: Scored[] = history
    .map((r) => ({ record: r, score: jaccard(draftTokens, tokenize(r.description)) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  if (scored.length < settings.suggestionMinSupport) return null;

  /* weighted dominant-category from top scored records */
  const catWeight = new Map<string, { weight: number; records: FinancialRecord[] }>();
  for (const { record, score } of scored) {
    const e = catWeight.get(record.categoryId) ?? { weight: 0, records: [] };
    e.weight += score;
    e.records.push(record);
    catWeight.set(record.categoryId, e);
  }

  let bestCat: { categoryId: string; weight: number; records: FinancialRecord[] } | null = null;
  let totalWeight = 0;
  for (const [categoryId, { weight, records }] of catWeight) {
    totalWeight += weight;
    if (!bestCat || weight > bestCat.weight) bestCat = { categoryId, weight, records };
  }

  if (!bestCat || totalWeight === 0) return null;

  const confidence = bestCat.weight / totalWeight;
  if (confidence < settings.suggestionMinConfidence) return null;
  if (bestCat.records.length < settings.suggestionMinSupport) return null;

  const basis: SuggestionBasisEntry[] = bestCat.records
    .slice(0, 5)
    .map((r) => ({ recordId: r.id, reason: 'token-overlap' as const }));

  return {
    targetRecordDraft: draft,
    proposedCategoryId: bestCat.categoryId as Id,
    confidence,
    basis,
  };
}
