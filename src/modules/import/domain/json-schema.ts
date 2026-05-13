/*
 * JSON import validator (US3 / FR-012 / FR-013 / FR-015).
 *
 * Validates a parsed JSON payload against the contract in
 * contracts/import-json.schema.md. Amount is in integer minor units.
 *
 * Pure function — no I/O. Runs in the import worker (off-thread).
 */

import { toIsoDate, toMoneyMinor } from '../../records/domain/types.js';
import type {
  ImportCtx,
  ValidationReport,
  RowError,
  ParsedRow,
  JsonRowErrorCode,
} from './types.js';

const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

function isValidCalendarDate(value: string): boolean {
  const [ys, ms, ds] = value.split('-');
  const y = parseInt(ys ?? '', 10);
  const m = parseInt(ms ?? '', 10);
  const d = parseInt(ds ?? '', 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  const dt = new Date(`${value}T00:00:00`);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

const KNOWN_ROW_FIELDS = new Set([
  'date',
  'type',
  'amount',
  'category',
  'description',
  'counterparty',
]);

/** Validates a JSON import payload (already JSON.parse'd). */
export function validateJsonPayload(raw: unknown, ctx: ImportCtx): ValidationReport {
  // Structural: top-level type
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      outcome: 'rejected-structural',
      structuralCode: 'WRONG_TOP_LEVEL_TYPE',
      totalRows: 0,
      validRows: [],
      errorRows: [],
    };
  }

  const obj = raw as Record<string, unknown>;

  // Structural: schemaVersion
  if (!('schemaVersion' in obj) || typeof obj['schemaVersion'] !== 'number') {
    return {
      outcome: 'rejected-structural',
      structuralCode: 'MISSING_OR_WRONG_SCHEMA_VERSION',
      totalRows: 0,
      validRows: [],
      errorRows: [],
    };
  }
  const sv = obj['schemaVersion'] as number;
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(sv)) {
    return {
      outcome: 'rejected-structural',
      structuralCode: 'UNSUPPORTED_SCHEMA_VERSION',
      totalRows: 0,
      validRows: [],
      errorRows: [],
    };
  }

  // Structural: currency
  if (obj['currency'] !== ctx.currency) {
    return {
      outcome: 'rejected-structural',
      structuralCode: 'CURRENCY_MISMATCH',
      totalRows: 0,
      validRows: [],
      errorRows: [],
    };
  }

  // Structural: currencyMinorUnits
  if (obj['currencyMinorUnits'] !== ctx.currencyMinorUnits) {
    return {
      outcome: 'rejected-structural',
      structuralCode: 'MINOR_UNITS_MISMATCH',
      totalRows: 0,
      validRows: [],
      errorRows: [],
    };
  }

  // Structural: records array
  if (!Array.isArray(obj['records'])) {
    return {
      outcome: 'rejected-structural',
      structuralCode: 'RECORDS_NOT_ARRAY',
      totalRows: 0,
      validRows: [],
      errorRows: [],
    };
  }

  const records = obj['records'] as unknown[];
  const validRows: ParsedRow[] = [];
  const errorRows: RowError[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const rowNumber = i + 1;
    const codes: JsonRowErrorCode[] = [];

    if (typeof rec !== 'object' || rec === null || Array.isArray(rec)) {
      errorRows.push({ rowNumber, codes: ['UNKNOWN_FIELD'] });
      continue;
    }

    const r = rec as Record<string, unknown>;

    // Unknown fields
    for (const k of Object.keys(r)) {
      if (!KNOWN_ROW_FIELDS.has(k)) {
        codes.push('UNKNOWN_FIELD');
        break;
      }
    }

    // Date
    const date = typeof r['date'] === 'string' ? r['date'].trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidCalendarDate(date)) {
      codes.push('INVALID_DATE');
    }

    // Type
    const type = r['type'];
    if (type !== 'income' && type !== 'expense') {
      codes.push('INVALID_TYPE');
    }

    // Amount
    const amount = r['amount'];
    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      codes.push('AMOUNT_NOT_INTEGER');
    } else if (amount <= 0) {
      codes.push('AMOUNT_NOT_POSITIVE');
    }

    // Category
    const category = typeof r['category'] === 'string' ? r['category'].trim() : '';
    if (!category) codes.push('CATEGORY_REQUIRED');
    else if (category.length > 60) codes.push('CATEGORY_TOO_LONG');

    // Description
    const description = typeof r['description'] === 'string' ? r['description'].trim() : '';
    if (!description) codes.push('DESCRIPTION_REQUIRED');
    else if (description.length > 280) codes.push('DESCRIPTION_TOO_LONG');

    // Counterparty
    const counterparty =
      r['counterparty'] == null
        ? ''
        : typeof r['counterparty'] === 'string'
          ? r['counterparty'].trim()
          : '';
    if (counterparty.length > 120) codes.push('COUNTERPARTY_TOO_LONG');

    if (codes.length > 0) {
      errorRows.push({ rowNumber, codes });
    } else {
      validRows.push({
        rowNumber,
        date: toIsoDate(date),
        type: type as 'income' | 'expense',
        amount: toMoneyMinor(amount as number),
        categoryName: category,
        description,
        ...(counterparty ? { counterpartyName: counterparty } : {}),
      });
    }
  }

  const totalRows = records.length;
  const outcome =
    errorRows.length === 0 ? 'valid' : validRows.length === 0 ? 'rejected-all' : 'partial';

  const report: ValidationReport = { outcome, totalRows, validRows, errorRows };

  // Capacity check
  if (validRows.length > 0) {
    const HARD_CAP = 12_000;
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
