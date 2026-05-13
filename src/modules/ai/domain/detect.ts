/*
 * Inconsistency detectors (US6).
 * Three pure detectors — no DOM, no I/O.
 *
 * detectCategoryMismatch: dominant-category per counterparty; flags outliers.
 * detectAmountOutlier: median + MAD (k=3.5) per category.
 * detectLikelyDuplicate: same (date, amount, type) + token-overlap > 0.8
 *   within ±2 calendar days.
 */

import type { FinancialRecord, Id } from '../../records/domain/types.js';
import type { InconsistencyFinding, InconsistencyKind } from './types.js';
import { toId, toIsoDateTime } from '../../records/domain/types.js';

/* ---------- helpers ---------- */

function generateId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeFinding(
  targetRecordId: Id,
  kind: InconsistencyKind,
  reason: string,
  basis: readonly Id[],
): InconsistencyFinding {
  return {
    id: toId(generateId()),
    targetRecordId,
    kind,
    reason,
    basis,
    status: 'open',
    createdAt: toIsoDateTime(nowIso()),
    updatedAt: toIsoDateTime(nowIso()),
    schemaVersion: 1,
  };
}

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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function mad(values: number[], med: number): number {
  return median(values.map((v) => Math.abs(v - med)));
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

/* ---------- detector: category mismatch ---------- */

/**
 * For each counterparty with ≥ 3 records, find the dominant category.
 * Flag records that use a different category when confidence of dominant
 * is ≥ 0.7.
 */
export function detectCategoryMismatch(
  records: readonly FinancialRecord[],
): InconsistencyFinding[] {
  if (records.length === 0) return [];

  const byCounterparty = new Map<string, FinancialRecord[]>();
  for (const r of records) {
    if (!r.counterpartyId) continue;
    const arr = byCounterparty.get(r.counterpartyId) ?? [];
    arr.push(r);
    byCounterparty.set(r.counterpartyId, arr);
  }

  const findings: InconsistencyFinding[] = [];

  for (const [cpId, cpRecords] of byCounterparty) {
    if (cpRecords.length < 3) continue;

    const catCounts = new Map<string, number>();
    for (const r of cpRecords) {
      catCounts.set(r.categoryId, (catCounts.get(r.categoryId) ?? 0) + 1);
    }

    let dominantCat = '';
    let dominantCount = 0;
    for (const [catId, count] of catCounts) {
      if (count > dominantCount) {
        dominantCat = catId;
        dominantCount = count;
      }
    }

    const confidence = dominantCount / cpRecords.length;
    if (confidence < 0.7) continue;

    const basisIds = cpRecords
      .filter((r) => r.categoryId === dominantCat)
      .slice(0, 5)
      .map((r) => r.id);

    for (const r of cpRecords) {
      if (r.categoryId !== dominantCat) {
        findings.push(
          makeFinding(
            r.id,
            'category-mismatch',
            `La mayoría de los registros de esta contraparte usan una categoría diferente (${String(Math.round(confidence * 100))}% de ${String(cpRecords.length)} registros).`,
            basisIds,
          ),
        );
      }
    }

    void cpId;
  }

  return findings;
}

/* ---------- detector: amount outlier ---------- */

/**
 * Within each category, compute median + MAD. Flag records whose amount
 * deviates more than k=3.5 MADs from the median.
 * Requires at least 5 records per category to produce a robust estimate.
 */
export function detectAmountOutlier(records: readonly FinancialRecord[]): InconsistencyFinding[] {
  if (records.length === 0) return [];

  const K = 3.5;
  const MIN_SAMPLE = 5;

  const byCategory = new Map<string, FinancialRecord[]>();
  for (const r of records) {
    const arr = byCategory.get(r.categoryId) ?? [];
    arr.push(r);
    byCategory.set(r.categoryId, arr);
  }

  const findings: InconsistencyFinding[] = [];

  for (const [, catRecords] of byCategory) {
    if (catRecords.length < MIN_SAMPLE) continue;

    const amounts = catRecords.map((r) => r.amount);
    const med = median(amounts);
    const m = mad(amounts, med);

    if (m === 0) continue; // all same amount — no outlier possible

    const threshold = med + K * m;

    for (const r of catRecords) {
      if (r.amount > threshold) {
        const basisIds = catRecords
          .filter((b) => b.id !== r.id)
          .slice(0, 5)
          .map((b) => b.id);
        findings.push(
          makeFinding(
            r.id,
            'amount-outlier',
            `El importe (${String(r.amount)}) es inusualmente alto para esta categoría (mediana: ${String(Math.round(med))}, umbral: ${String(Math.round(threshold))}).`,
            basisIds,
          ),
        );
      }
    }
  }

  return findings;
}

/* ---------- detector: likely duplicate ---------- */

/**
 * Pairs of records with the same (type, amount) within ±2 days AND
 * description token-overlap > 0.8 are flagged as likely duplicates.
 * Both records in a pair receive a finding referencing the other.
 */
export function detectLikelyDuplicate(records: readonly FinancialRecord[]): InconsistencyFinding[] {
  if (records.length < 2) return [];

  const OVERLAP_THRESHOLD = 0.8;
  const MAX_DAYS = 2;

  const findings: InconsistencyFinding[] = [];
  const seen = new Set<string>(); // "id1:id2" to avoid double-flagging

  for (let i = 0; i < records.length; i++) {
    const a = records[i];
    if (!a) continue;
    const tokA = tokenize(a.description);

    for (let j = i + 1; j < records.length; j++) {
      const b = records[j];
      if (!b) continue;
      if (a.type !== b.type || a.amount !== b.amount) continue;
      if (daysBetween(a.date as string, b.date as string) > MAX_DAYS) continue;

      const tokB = tokenize(b.description);
      const overlap = jaccard(tokA, tokB);
      if (overlap <= OVERLAP_THRESHOLD) continue;

      const pairKey = [a.id, b.id].sort().join(':');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const reason = `Posible duplicado: mismo importe y tipo, fecha similar, descripciones muy parecidas (similitud: ${String(Math.round(overlap * 100))}%).`;
      findings.push(makeFinding(a.id, 'likely-duplicate', reason, [b.id]));
      findings.push(makeFinding(b.id, 'likely-duplicate', reason, [a.id]));
    }
  }

  return findings;
}
