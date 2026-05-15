/*
 * Adaptive validator (Stage 5) — flexible import pipeline.
 *
 * Spec ref: contracts/import-csv.schema.md §Stage 5 (error codes shared
 * with the JSON pipeline since they target the normalized model).
 *
 * Takes the operator-confirmed `MappingDecision` + `NormalizedRow[]`
 * and produces a `FlexibleValidationReport`. Validation is adaptive:
 * date / decimal formats and amount conventions are read from the
 * confirmed decision; required-role presence is enforced; metadata
 * size limits are enforced.
 *
 * Pure function — no I/O. Zod is used internally for primitive
 * sub-validators (length, regex) so error reporting is uniform.
 */

import { toIsoDate, toMoneyMinor } from '../../../records/domain/types.js';
import type {
  FlexibleParsedRow,
  FlexibleRowError,
  FlexibleRowErrorCode,
  FlexibleValidationReport,
  ImportCtx,
  MappingDecision,
  NormalizedRow,
  SemanticRole,
} from '../types.js';
import { REQUIRED_ROLES } from '../types.js';

const HARD_CAP = 12_000;

const TYPE_INCOME_VOCAB = new Set(['income', 'ingreso', 'ingresos', 'credit', 'cr', 'haber', '+']);
const TYPE_EXPENSE_VOCAB = new Set([
  'expense',
  'egreso',
  'egresos',
  'gasto',
  'gastos',
  'debit',
  'db',
  'debe',
  '-',
]);

const META_MAX_KEYS = 10;
const META_MAX_KEY_LEN = 60;
const META_MAX_VAL_LEN = 200;
const DESC_MAX = 280;
const CAT_MAX = 60;
const CP_MAX = 120;

function isValidCalendarDate(value: string): boolean {
  const [ys, ms, ds] = value.split('-');
  const y = parseInt(ys ?? '', 10);
  const m = parseInt(ms ?? '', 10);
  const d = parseInt(ds ?? '', 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return false;
  const dt = new Date(`${value}T00:00:00`);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

function tryParseDate(value: string, format: 'iso' | 'dd-mm-yyyy' | 'mm-dd-yyyy'): string | null {
  const t = value.trim();
  if (format === 'iso') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
    return isValidCalendarDate(t) ? t : null;
  }
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t);
  if (!m) return null;
  const a = parseInt(m[1] ?? '0', 10);
  const b = parseInt(m[2] ?? '0', 10);
  const yRaw = parseInt(m[3] ?? '0', 10);
  const y = yRaw < 100 ? 2000 + yRaw : yRaw;
  const day = format === 'dd-mm-yyyy' ? a : b;
  const month = format === 'dd-mm-yyyy' ? b : a;
  const padded = `${y.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return isValidCalendarDate(padded) ? padded : null;
}

function tryParseAmount(
  value: string,
  decimalSeparator: '.' | ',',
  minorUnits: 0 | 2 | 3,
  convention: 'minor-units' | 'major-decimal',
): number | null {
  let t = value.trim();
  if (t === '') return null;

  // Strip currency symbols and stray whitespace.
  t = t.replace(/[$€£¥₹]/g, '').replace(/\s+/g, '');
  // Reject explicit signs (sign is encoded by `type`).
  if (t.startsWith('+') || t.startsWith('-')) return null;

  // Normalize thousand separators / decimal separator.
  let normalized: string;
  if (decimalSeparator === ',') {
    // European format: '.' is thousand sep, ',' is decimal sep.
    normalized = t.replace(/\./g, '').replace(',', '.');
  } else {
    // US/UK format: ',' is thousand sep, '.' is decimal sep.
    normalized = t.replace(/,/g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) {
    // Keep the parse "valid" so the caller distinguishes parse-failure
    // from non-positive: returning 0 here would lose that signal. We
    // return null to mean "format invalid", and the caller checks
    // explicitly for non-positive via a separate code path below.
    return null;
  }

  if (convention === 'minor-units') {
    // Caller asserts the input is already integer minor units.
    if (!/^\d+$/.test(normalized)) return null;
    return Math.trunc(num);
  }

  // major-decimal: convert to minor units.
  const factor = Math.pow(10, minorUnits);
  const product = num * factor;
  // Reject excessive precision.
  if (Math.abs(Math.round(product) - product) > 1e-6) return null;
  return Math.round(product);
}

function canonicalizeType(
  rawValue: string,
  custom: Readonly<Record<string, 'income' | 'expense'>> | undefined,
): 'income' | 'expense' | null {
  const lc = rawValue.trim().toLowerCase();
  if (custom && lc in custom) return custom[lc] ?? null;
  if (custom) {
    // Allow custom keys to match in original case too.
    const exact = custom[rawValue.trim()];
    if (exact) return exact;
  }
  if (TYPE_INCOME_VOCAB.has(lc)) return 'income';
  if (TYPE_EXPENSE_VOCAB.has(lc)) return 'expense';
  return null;
}

export interface ValidationInput {
  readonly rows: ReadonlyArray<NormalizedRow>;
  readonly decision: MappingDecision;
  readonly ctx: ImportCtx;
}

export function validate(input: ValidationInput): FlexibleValidationReport {
  const { rows, decision, ctx } = input;

  // Pre-flight: did every required role get mapped?
  const mappedRoles = new Set<SemanticRole>(Object.values(decision.mapping));
  const missingRoles = REQUIRED_ROLES.filter((r) => !mappedRoles.has(r));
  if (missingRoles.length > 0) {
    return {
      outcome: 'rejected-structural',
      totalRows: rows.length,
      validRows: [],
      errorRows: rows.map((r) => ({
        rowNumber: r.rowNumber,
        codes: ['MISSING_REQUIRED_ROLE_AFTER_MAPPING' as const],
      })),
    };
  }

  const validRows: FlexibleParsedRow[] = [];
  const errorRows: FlexibleRowError[] = [];

  // Find the column indices for date / amount so we can look up
  // the operator-confirmed per-column formats.
  const dateColumn = entriesOfRole(decision.mapping, 'date')[0];
  const amountColumn = entriesOfRole(decision.mapping, 'amount')[0];

  const dateFormat: 'iso' | 'dd-mm-yyyy' | 'mm-dd-yyyy' =
    dateColumn !== undefined ? (decision.dateFormatPerColumn?.[dateColumn] ?? 'iso') : 'iso';
  const decimalSeparator: '.' | ',' =
    amountColumn !== undefined ? (decision.decimalSeparatorPerColumn?.[amountColumn] ?? '.') : '.';
  const amountConvention: 'minor-units' | 'major-decimal' =
    decision.amountConvention ?? 'major-decimal';

  for (const row of rows) {
    const codes: FlexibleRowErrorCode[] = [];

    // Date
    let parsedDate: string | null = null;
    if (row.date == null) {
      codes.push('MISSING_REQUIRED_ROLE_AFTER_MAPPING');
    } else {
      parsedDate = tryParseDate(row.date, dateFormat);
      if (!parsedDate) codes.push('INVALID_DATE');
    }

    // Type
    let parsedType: 'income' | 'expense' | null = null;
    if (row.type == null) {
      codes.push('MISSING_REQUIRED_ROLE_AFTER_MAPPING');
    } else {
      parsedType = canonicalizeType(row.type, decision.typeCanonicalization);
      if (!parsedType) codes.push('INVALID_TYPE');
    }

    // Amount
    let parsedAmount: number | null = null;
    if (row.amount == null) {
      codes.push('MISSING_REQUIRED_ROLE_AFTER_MAPPING');
    } else {
      const num = tryParseAmount(
        row.amount,
        decimalSeparator,
        ctx.currencyMinorUnits,
        amountConvention,
      );
      if (num === null) {
        // Try a softer parse to distinguish AMOUNT_NOT_POSITIVE from format errors.
        const softlyNumeric = /^-?\d+([.,]\d+)?$/.test(row.amount.trim().replace(/[$€£¥₹]/g, ''));
        if (softlyNumeric && /^-?0+([.,]0+)?$/.test(row.amount.trim().replace(/[$€£¥₹]/g, ''))) {
          codes.push('AMOUNT_NOT_POSITIVE');
        } else {
          codes.push('INVALID_AMOUNT_FORMAT');
        }
      } else if (num <= 0) {
        codes.push('AMOUNT_NOT_POSITIVE');
      } else {
        parsedAmount = num;
      }
    }

    // Currency (optional)
    if (row.currency != null) {
      const cur = row.currency.trim().toUpperCase();
      if (cur !== ctx.currency.toUpperCase()) {
        codes.push('CURRENCY_DIFFERS_FROM_WORKSPACE');
      }
    }

    // Category
    let category = '';
    if (row.category == null) {
      codes.push('CATEGORY_REQUIRED');
    } else {
      category = row.category.trim();
      if (!category) codes.push('CATEGORY_REQUIRED');
      else if (category.length > CAT_MAX) codes.push('CATEGORY_TOO_LONG');
    }

    // Description
    let description = '';
    if (row.description == null) {
      codes.push('DESCRIPTION_REQUIRED');
    } else {
      description = row.description.trim();
      if (!description) codes.push('DESCRIPTION_REQUIRED');
      else if (description.length > DESC_MAX) codes.push('DESCRIPTION_TOO_LONG');
    }

    // Counterparty (optional)
    let counterparty: string | undefined;
    if (row.counterparty != null) {
      const cp = row.counterparty.trim();
      if (cp.length > CP_MAX) codes.push('COUNTERPARTY_TOO_LONG');
      else if (cp.length > 0) counterparty = cp;
    }

    // Metadata size enforcement
    const metaKeys = Object.keys(row.extraMetadata);
    if (metaKeys.length > META_MAX_KEYS) codes.push('METADATA_TOO_MANY_FIELDS');
    for (const k of metaKeys) {
      if (k.length > META_MAX_KEY_LEN) {
        codes.push('METADATA_KEY_TOO_LONG');
        break;
      }
    }
    for (const v of Object.values(row.extraMetadata)) {
      if (v.length > META_MAX_VAL_LEN) {
        codes.push('METADATA_VALUE_TOO_LONG');
        break;
      }
    }

    if (codes.length > 0) {
      errorRows.push({ rowNumber: row.rowNumber, codes });
      continue;
    }

    // All checks passed.
    validRows.push({
      rowNumber: row.rowNumber,
      date: toIsoDate(parsedDate ?? ''),
      type: parsedType ?? 'income',
      amount: toMoneyMinor(parsedAmount ?? 0),
      categoryName: category,
      description,
      ...(counterparty !== undefined ? { counterpartyName: counterparty } : {}),
      extraMetadata: row.extraMetadata,
    });
  }

  const totalRows = rows.length;
  const outcome =
    errorRows.length === 0 ? 'valid' : validRows.length === 0 ? 'rejected-all' : 'partial';

  const report: FlexibleValidationReport = {
    outcome,
    totalRows,
    validRows,
    errorRows,
  };

  if (validRows.length > 0) {
    const wouldTotal = ctx.existingCount + validRows.length;
    if (wouldTotal > HARD_CAP) {
      const allowedCount = Math.max(0, HARD_CAP - ctx.existingCount);
      return {
        ...report,
        capacityWarning: {
          existingCount: ctx.existingCount,
          validCount: validRows.length,
          wouldExceed: wouldTotal - HARD_CAP,
          allowedCount,
        },
      };
    }
  }

  return report;
}

function entriesOfRole(
  mapping: Readonly<Record<number, SemanticRole>>,
  role: SemanticRole,
): number[] {
  const out: number[] = [];
  for (const [k, v] of Object.entries(mapping)) {
    if (v === role) out.push(parseInt(k, 10));
  }
  return out;
}
