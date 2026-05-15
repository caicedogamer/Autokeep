/*
 * HeuristicColumnMapper — Stage 2 implementation.
 *
 * Spec refs:
 *   - contracts/import-mapping.md §3, §4, §5, §6
 *   - contracts/import-csv.schema.md §Stage 2
 *
 * Composes per-column heuristics (heuristics.ts) into a full
 * `InferenceReport` with the cross-column warnings:
 *   - AMBIGUOUS_ROLE          (Δ < 0.1 between top candidates for the same required role)
 *   - LOW_CONFIDENCE          (best confidence for a required role < 0.5)
 *   - MIXED_TYPE_COLUMN       (mismatchRate > 0.1)
 *   - MISSING_REQUIRED_ROLE   (no column mapped to a required role)
 *   - CURRENCY_DIFFERS_FROM_WORKSPACE
 *   - AMBIGUOUS_DATE_FORMAT
 *   - AMBIGUOUS_DECIMAL_SEPARATOR
 *   - AMBIGUOUS_AMOUNT_CONVENTION
 *
 * Pure, deterministic.
 */

import type {
  ColumnInference,
  InferenceContext,
  InferenceReport,
  MappingWarning,
  RawTable,
} from '../types.js';
import { REQUIRED_ROLES } from '../types.js';
import type { ColumnMapper } from './column-mapper.js';
import {
  inferAmountConvention,
  inferColumn,
  inferDateFormats,
  inferDecimalSeparator,
} from './heuristics.js';

const CURRENCY_ISO_RE = /^[A-Z]{3}$/;

export class HeuristicColumnMapper implements ColumnMapper {
  public infer(table: RawTable, ctx: InferenceContext): InferenceReport {
    const limit = ctx.sampleSizeLimit ?? 200;

    // Per-column native-type hint (JSON only).
    const nativeTypes = table.meta.sourceKind === 'json' ? (table.meta.nativeTypes ?? []) : [];

    const columns: ColumnInference[] = [];
    for (let c = 0; c < table.headers.length; c++) {
      const options: {
        sampleSizeLimit: number;
        nativeType?: 'string' | 'number' | 'boolean' | 'null' | 'mixed';
      } = {
        sampleSizeLimit: limit,
      };
      const native = nativeTypes[c];
      if (native !== undefined) options.nativeType = native;
      columns.push(inferColumn(table, c, options));
    }

    /* ---------- After per-column inference: claim required roles ----------
     *
     * For each required role, find the column whose inferredRole is that
     * role AND has the highest confidence. If multiple columns are
     * within Δ<0.1 of the leader, raise AMBIGUOUS_ROLE. If no column
     * claims the role, raise MISSING_REQUIRED_ROLE. */
    const globalWarnings: MappingWarning[] = [];

    for (const role of REQUIRED_ROLES) {
      const candidates = columns
        .filter((c) => c.inferredRole === role)
        .sort((a, b) => b.confidence - a.confidence);

      if (candidates.length === 0) {
        globalWarnings.push({ code: 'MISSING_REQUIRED_ROLE', role });
        continue;
      }

      const leader = candidates[0];
      if (!leader) continue;
      if (leader.confidence < 0.5) {
        globalWarnings.push({
          code: 'LOW_CONFIDENCE',
          columnIndex: leader.columnIndex,
          bestConfidence: leader.confidence,
        });
      }

      if (candidates.length > 1) {
        const ambiguousColumns = candidates
          .filter((c) => leader.confidence - c.confidence < 0.1)
          .map((c) => c.columnIndex);
        if (ambiguousColumns.length > 1) {
          globalWarnings.push({
            code: 'AMBIGUOUS_ROLE',
            role,
            candidateColumns: ambiguousColumns,
          });
        }
      }
    }

    /* ---------- Mixed-type column warnings ---------- */
    for (const col of columns) {
      if (col.mismatchRate > 0.1) {
        globalWarnings.push({
          code: 'MIXED_TYPE_COLUMN',
          columnIndex: col.columnIndex,
          dominantType: col.inferredType,
          mismatchRate: col.mismatchRate,
        });
      }
    }

    /* ---------- Per-role format ambiguity warnings ---------- */

    const dateColumns = columns.filter((c) => c.inferredRole === 'date');
    for (const dc of dateColumns) {
      const values = sampleValues(table, dc.columnIndex, limit);
      const formats = inferDateFormats(values);
      if (formats.length > 1) {
        globalWarnings.push({
          code: 'AMBIGUOUS_DATE_FORMAT',
          columnIndex: dc.columnIndex,
          candidates: formats,
        });
      }
    }

    const amountColumns = columns.filter((c) => c.inferredRole === 'amount');
    for (const ac of amountColumns) {
      const values = sampleValues(table, ac.columnIndex, limit);
      const decimalSeparators = inferDecimalSeparator(values);
      if (decimalSeparators.length > 1) {
        globalWarnings.push({
          code: 'AMBIGUOUS_DECIMAL_SEPARATOR',
          columnIndex: ac.columnIndex,
          candidates: decimalSeparators,
        });
      }
      const native = nativeTypes[ac.columnIndex];
      const convCandidates = inferAmountConvention(values, native);
      if (convCandidates.length > 1) {
        globalWarnings.push({
          code: 'AMBIGUOUS_AMOUNT_CONVENTION',
          columnIndex: ac.columnIndex,
          candidates: convCandidates,
        });
      }
    }

    /* ---------- Currency mismatch warning ---------- */

    const currencyColumns = columns.filter((c) => c.inferredRole === 'currency');
    for (const cc of currencyColumns) {
      const values = sampleValues(table, cc.columnIndex, limit).filter((v) => v.trim() !== '');
      const isos = values.map((v) => v.trim().toUpperCase()).filter((v) => CURRENCY_ISO_RE.test(v));
      const distinct = new Set(isos);
      const differing = [...distinct].filter((v) => v !== ctx.workspaceCurrency.toUpperCase());
      if (differing.length > 0) {
        globalWarnings.push({
          code: 'CURRENCY_DIFFERS_FROM_WORKSPACE',
          columnIndex: cc.columnIndex,
          sampleValues: differing.slice(0, 5),
        });
      }
    }

    return { columns, globalWarnings };
  }
}

function sampleValues(table: RawTable, columnIndex: number, limit: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.min(table.rows.length, limit); i++) {
    const row = table.rows[i];
    if (row && columnIndex < row.length) out.push(row[columnIndex] ?? '');
  }
  return out;
}
