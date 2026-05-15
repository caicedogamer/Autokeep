/*
 * ColumnMapper interface — the extensibility seam for inference (FR-048).
 *
 * Spec ref: contracts/import-mapping.md §6.
 *
 * The MVP ships one implementation: `HeuristicColumnMapper`. A future
 * AI-based variant slots in without touching parser / normalizer /
 * validator / pipeline service.
 */

import type { InferenceContext, InferenceReport, RawTable } from '../types.js';

export interface ColumnMapper {
  infer(table: RawTable, ctx: InferenceContext): InferenceReport;
}
