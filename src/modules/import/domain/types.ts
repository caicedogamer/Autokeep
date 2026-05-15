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
  /** Schema version (1 = v1 fixed-header, 2 = flexible). Optional for back-compat. */
  readonly schemaVersion?: 1 | 2;
  /** Flexible-import audit fields (FR-043). Populated by ImportPipeline v2. */
  readonly inferenceReport?: InferenceReport;
  readonly mappingDecision?: MappingDecision;
}

/* ============================================================
 * Phase 5b — Flexible import (US3v2) types
 *
 * These types implement the contracts in:
 *   - contracts/import-mapping.md
 *   - contracts/import-csv.schema.md
 *   - contracts/import-json.schema.md
 * ============================================================ */

/* ---------- Stage 1: RawTable (parser output) ---------- */

export type RawTableSourceKind = 'csv' | 'json';

export interface CsvRawTableMeta {
  readonly delimiter: ',' | ';' | '\t' | '|';
  readonly lineEnding: '\r\n' | '\n' | '\r';
  readonly headerSynthesized: boolean;
  readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
}

export interface JsonRawTableMeta {
  readonly jsonShape: 'array' | 'wrapped' | 'ndjson';
  readonly wrapperKey?: string;
  readonly wrapperFields?: readonly string[];
  readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
  /**
   * For JSON imports: per-column native type observed in the input (before
   * stringification). Used by the inferrer to distinguish `123` (number)
   * from `"123"` (string) for amount-convention disambiguation.
   */
  readonly nativeTypes?: ReadonlyArray<'string' | 'number' | 'boolean' | 'null' | 'mixed'>;
}

export type RawTableMeta =
  | (CsvRawTableMeta & { sourceKind: 'csv' })
  | (JsonRawTableMeta & { sourceKind: 'json' });

export interface RawTable {
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<readonly string[]>;
  readonly meta: RawTableMeta;
}

/* ---------- Stage 1: Parser-level rejection codes ---------- */

export type ParserRejectionCode =
  | 'EMPTY_FILE'
  | 'ENCODING_NOT_UTF8'
  | 'MALFORMED_CSV'
  | 'MALFORMED_JSON'
  | 'WRONG_TOP_LEVEL_SHAPE';

export interface ParserRejection {
  readonly code: ParserRejectionCode;
  readonly detail?: string;
}

/* ---------- Stage 2: SemanticRole + ColumnInference ---------- */

export type SemanticRole =
  | 'date'
  | 'type'
  | 'amount'
  | 'category'
  | 'description'
  | 'counterparty'
  | 'currency'
  | 'metadata'
  | 'ignore';

/** The five roles MUST each be mapped to a column for the import to proceed. */
export const REQUIRED_ROLES: ReadonlyArray<SemanticRole> = [
  'date',
  'type',
  'amount',
  'category',
  'description',
] as const;

export type InferredType = 'string' | 'number' | 'date' | 'enum' | 'boolean';

export interface AlternativeRole {
  readonly role: SemanticRole;
  readonly confidence: number;
}

export interface ColumnInference {
  readonly columnIndex: number;
  readonly header: string;
  readonly inferredType: InferredType;
  readonly inferredRole: SemanticRole;
  readonly confidence: number;
  readonly alternativeRoles: readonly AlternativeRole[];
  readonly sampleSize: number;
  readonly mismatchRate: number;
}

export interface InferenceReport {
  readonly columns: readonly ColumnInference[];
  readonly globalWarnings: readonly MappingWarning[];
}

/* ---------- Stage 3: ColumnMapping + MappingDecision ---------- */

/** Keyed by columnIndex. Every column from RawTable MUST have an entry. */
export type ColumnMapping = Readonly<Record<number, SemanticRole>>;

export type MappingSource = 'auto' | 'manual' | 'mixed';

export type DateFormatId = 'iso' | 'dd-mm-yyyy' | 'mm-dd-yyyy';
export type DecimalSeparator = '.' | ',';
export type AmountConvention = 'minor-units' | 'major-decimal';

export interface MappingDecision {
  readonly mapping: ColumnMapping;
  readonly source: MappingSource;
  readonly warnings: readonly MappingWarning[];
  readonly confirmedAt: string; // IsoDateTime
  readonly amountConvention?: AmountConvention;
  readonly dateFormatPerColumn?: Readonly<Record<number, DateFormatId>>;
  readonly decimalSeparatorPerColumn?: Readonly<Record<number, DecimalSeparator>>;
  readonly typeCanonicalization?: Readonly<Record<string, 'income' | 'expense'>>;
}

/* ---------- Mapping warnings (tagged union) ---------- */

export type MappingWarning =
  | {
      readonly code: 'AMBIGUOUS_ROLE';
      readonly role: SemanticRole;
      readonly candidateColumns: readonly number[];
    }
  | {
      readonly code: 'LOW_CONFIDENCE';
      readonly columnIndex: number;
      readonly bestConfidence: number;
    }
  | {
      readonly code: 'MIXED_TYPE_COLUMN';
      readonly columnIndex: number;
      readonly dominantType: InferredType;
      readonly mismatchRate: number;
    }
  | { readonly code: 'MISSING_REQUIRED_ROLE'; readonly role: SemanticRole }
  | {
      readonly code: 'CURRENCY_DIFFERS_FROM_WORKSPACE';
      readonly columnIndex: number;
      readonly sampleValues: readonly string[];
    }
  | {
      readonly code: 'AMBIGUOUS_DATE_FORMAT';
      readonly columnIndex: number;
      readonly candidates: ReadonlyArray<DateFormatId>;
    }
  | {
      readonly code: 'AMBIGUOUS_DECIMAL_SEPARATOR';
      readonly columnIndex: number;
      readonly candidates: ReadonlyArray<DecimalSeparator>;
    }
  | {
      readonly code: 'AMBIGUOUS_AMOUNT_CONVENTION';
      readonly columnIndex: number;
      readonly candidates: ReadonlyArray<AmountConvention>;
    };

export type MappingWarningCode = MappingWarning['code'];

/* ---------- Stage 2 input ---------- */

export interface InferenceContext {
  readonly workspaceCurrency: string;
  readonly workspaceCurrencyMinorUnits: 0 | 2 | 3;
  readonly workspaceLocale: string;
  /** Default 200. */
  readonly sampleSizeLimit?: number;
}

/* ---------- Stage 4 output: NormalizedRow ---------- */

export interface NormalizedRow {
  /** 1-based row number in the original file (header = 0). */
  readonly rowNumber: number;
  readonly date: string | null;
  readonly type: string | null;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly category: string | null;
  readonly description: string | null;
  readonly counterparty: string | null;
  readonly extraMetadata: Readonly<Record<string, string>>;
}

/* ---------- Stage 5: v2 error codes ---------- */

export type FlexibleRowErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_TYPE'
  | 'INVALID_AMOUNT_FORMAT'
  | 'AMOUNT_NOT_POSITIVE'
  | 'CURRENCY_DIFFERS_FROM_WORKSPACE'
  | 'CATEGORY_REQUIRED'
  | 'CATEGORY_TOO_LONG'
  | 'DESCRIPTION_REQUIRED'
  | 'DESCRIPTION_TOO_LONG'
  | 'COUNTERPARTY_TOO_LONG'
  | 'MISSING_REQUIRED_ROLE_AFTER_MAPPING'
  | 'METADATA_KEY_TOO_LONG'
  | 'METADATA_VALUE_TOO_LONG'
  | 'METADATA_TOO_MANY_FIELDS';

/* ---------- Stage 5 output: FlexibleValidationReport ---------- */

export interface FlexibleValidationReport {
  readonly outcome: ValidationOutcome;
  readonly parserRejection?: ParserRejection;
  readonly totalRows: number;
  readonly validRows: ReadonlyArray<FlexibleParsedRow>;
  readonly errorRows: ReadonlyArray<FlexibleRowError>;
  readonly capacityWarning?: ValidationReport['capacityWarning'];
}

export interface FlexibleParsedRow {
  readonly rowNumber: number;
  readonly date: IsoDate;
  readonly type: 'income' | 'expense';
  readonly amount: MoneyMinor;
  readonly categoryName: string;
  readonly description: string;
  readonly counterpartyName?: string;
  readonly extraMetadata: Readonly<Record<string, string>>;
}

export interface FlexibleRowError {
  readonly rowNumber: number;
  readonly codes: ReadonlyArray<FlexibleRowErrorCode>;
}
