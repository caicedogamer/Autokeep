/*
 * Import domain types (US3 / FR-011 – FR-016).
 *
 * These are plain-data-only; no DOM, no I/O. They cross the worker
 * boundary via structuredClone so class instances are forbidden.
 */

import type { IsoDate, MoneyMinor } from '../../records/domain/types.js';

/* ---------- Structural rejection codes ---------- */

export type CsvStructuralCode =
  | 'EMPTY_FILE'
  | 'HEADER_MISSING'
  | 'HEADER_MISMATCH'
  | 'ENCODING_NOT_UTF8'
  | 'MALFORMED_CSV';

export type JsonStructuralCode =
  | 'MALFORMED_JSON'
  | 'WRONG_TOP_LEVEL_TYPE'
  | 'MISSING_OR_WRONG_SCHEMA_VERSION'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'CURRENCY_MISMATCH'
  | 'MINOR_UNITS_MISMATCH'
  | 'RECORDS_NOT_ARRAY';

export type CsvStructuralCsvCode = 'CURRENCY_MISMATCH' | CsvStructuralCode;
export type StructuralCode = CsvStructuralCode | JsonStructuralCode;

/* ---------- Per-row error codes ---------- */

export type CsvRowErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_TYPE'
  | 'INVALID_AMOUNT_FORMAT'
  | 'AMOUNT_NOT_POSITIVE'
  | 'CURRENCY_MISMATCH'
  | 'CATEGORY_REQUIRED'
  | 'CATEGORY_TOO_LONG'
  | 'DESCRIPTION_REQUIRED'
  | 'DESCRIPTION_TOO_LONG'
  | 'COUNTERPARTY_TOO_LONG'
  | 'EXTRA_FIELDS'
  | 'MISSING_FIELDS';

export type JsonRowErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_TYPE'
  | 'AMOUNT_NOT_INTEGER'
  | 'AMOUNT_NOT_POSITIVE'
  | 'CATEGORY_REQUIRED'
  | 'CATEGORY_TOO_LONG'
  | 'DESCRIPTION_REQUIRED'
  | 'DESCRIPTION_TOO_LONG'
  | 'COUNTERPARTY_TOO_LONG'
  | 'UNKNOWN_FIELD';

export type RowErrorCode = CsvRowErrorCode | JsonRowErrorCode;

/* ---------- Row-level report ---------- */

export interface RowError {
  /** 1-based row number (header = 0). */
  readonly rowNumber: number;
  readonly codes: readonly RowErrorCode[];
  readonly rawLine?: string;
}

/* ---------- Parsed valid row (ready for commit) ---------- */

export interface ParsedRow {
  readonly rowNumber: number;
  readonly date: IsoDate;
  readonly type: 'income' | 'expense';
  readonly amount: MoneyMinor;
  readonly categoryName: string;
  readonly description: string;
  readonly counterpartyName?: string;
}

/* ---------- Validation report ---------- */

export type ValidationOutcome =
  | 'valid' // all rows ok, ready to commit
  | 'partial' // some rows ok, some failed
  | 'rejected-structural' // file-level rejection, nothing to commit
  | 'rejected-all'; // every row failed

export interface ValidationReport {
  readonly outcome: ValidationOutcome;
  readonly structuralCode?: StructuralCode;
  readonly totalRows: number;
  readonly validRows: readonly ParsedRow[];
  readonly errorRows: readonly RowError[];
  /** Set when valid rows would exceed the 12 000-record hard cap. */
  readonly capacityWarning?: {
    readonly existingCount: number;
    readonly validCount: number;
    readonly wouldExceed: number;
    readonly allowedCount: number;
  };
}

/* ---------- Import context (workspace-specific constraints) ---------- */

export interface ImportCtx {
  readonly currency: string;
  readonly currencyMinorUnits: 0 | 2 | 3;
  readonly existingCount: number;
}

/* ---------- ImportBatch (audit log entry) ---------- */

export type ImportBatchOutcome = 'committed' | 'partial-commit' | 'cancelled' | 'rejected';

export interface ImportBatch {
  readonly id: string;
  readonly startedAt: string;
  readonly committedAt?: string;
  readonly fileKind: 'csv' | 'json';
  readonly outcome: ImportBatchOutcome;
  readonly totalRows: number;
  readonly committedRows: number;
  readonly errorRows: number;
}
