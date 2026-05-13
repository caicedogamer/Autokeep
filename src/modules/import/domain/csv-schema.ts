/*
 * CSV import validator (US3 / FR-012 / FR-013 / FR-015).
 *
 * Accepts a raw UTF-8 string that PapaParse has already split into rows.
 * Validates structural integrity first, then each row against the
 * contract defined in contracts/import-csv.schema.md.
 *
 * Pure function — no I/O. Runs in the import worker (off-thread).
 */

import { toIsoDate, toMoneyMinor } from '../../records/domain/types.js';
import type { ImportCtx, ValidationReport, RowError, ParsedRow, CsvRowErrorCode } from './types.js';

/** Canonical column order from the contract. */
const EXPECTED_HEADERS = [
  'date',
  'type',
  'amount',
  'currency',
  'category',
  'description',
  'counterparty',
] as const;

function isValidCalendarDate(value: string): boolean {
  const [ys, ms, ds] = value.split('-');
  const y = parseInt(ys ?? '', 10);
  const m = parseInt(ms ?? '', 10);
  const d = parseInt(ds ?? '', 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  const dt = new Date(`${value}T00:00:00`);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

function fractionalDigits(s: string): number {
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

type PapaRow = string[];

export interface ParsedCsvInput {
  /** Header row (raw strings). */
  readonly headers: string[];
  /** Data rows (raw strings per column). */
  readonly rows: PapaRow[];
}

/** Validates a pre-parsed CSV (headers + rows from PapaParse). */
export function validateCsvRows(input: ParsedCsvInput, ctx: ImportCtx): ValidationReport {
  const { headers, rows } = input;

  // --- Structural: header check ---
  const normHeaders = headers.map((h) => h.trim().toLowerCase());
  if (
    normHeaders.length !== EXPECTED_HEADERS.length ||
    !EXPECTED_HEADERS.every((h, i) => normHeaders[i] === h)
  ) {
    return {
      outcome: 'rejected-structural',
      structuralCode: 'HEADER_MISMATCH',
      totalRows: 0,
      validRows: [],
      errorRows: [],
    };
  }

  const validRows: ParsedRow[] = [];
  const errorRows: RowError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 2; // +1 for header, +1 for 1-based
    const codes: CsvRowErrorCode[] = [];

    if (row.length < EXPECTED_HEADERS.length) {
      errorRows.push({ rowNumber, codes: ['MISSING_FIELDS'] });
      continue;
    }
    if (row.length > EXPECTED_HEADERS.length) {
      codes.push('EXTRA_FIELDS');
    }

    const [rawDate, rawType, rawAmount, rawCurrency, rawCategory, rawDescription, rawCounterparty] =
      row;

    const date = (rawDate ?? '').trim();
    const type = (rawType ?? '').trim();
    const amount = (rawAmount ?? '').trim();
    const currency = (rawCurrency ?? '').trim();
    const category = (rawCategory ?? '').trim();
    const description = (rawDescription ?? '').trim();
    const counterparty = (rawCounterparty ?? '').trim();

    // Date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidCalendarDate(date)) {
      codes.push('INVALID_DATE');
    }

    // Type
    if (type !== 'income' && type !== 'expense') {
      codes.push('INVALID_TYPE');
    }

    // Amount
    const amountValid = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0;
    if (!amountValid) {
      if (Number(amount) <= 0 && /^\d+(\.\d+)?$/.test(amount)) {
        codes.push('AMOUNT_NOT_POSITIVE');
      } else {
        codes.push('INVALID_AMOUNT_FORMAT');
      }
    } else if (fractionalDigits(amount) > ctx.currencyMinorUnits) {
      codes.push('INVALID_AMOUNT_FORMAT');
    }

    // Currency
    if (currency !== ctx.currency) {
      codes.push('CURRENCY_MISMATCH');
    }

    // Category
    if (!category) codes.push('CATEGORY_REQUIRED');
    else if (category.length > 60) codes.push('CATEGORY_TOO_LONG');

    // Description
    if (!description) codes.push('DESCRIPTION_REQUIRED');
    else if (description.length > 280) codes.push('DESCRIPTION_TOO_LONG');

    // Counterparty
    if (counterparty.length > 120) codes.push('COUNTERPARTY_TOO_LONG');

    if (codes.length > 0) {
      errorRows.push({ rowNumber, codes });
    } else {
      const factor = Math.pow(10, ctx.currencyMinorUnits);
      validRows.push({
        rowNumber,
        date: toIsoDate(date),
        type: type as 'income' | 'expense',
        amount: toMoneyMinor(Math.round(Number(amount) * factor)),
        categoryName: category,
        description,
        ...(counterparty ? { counterpartyName: counterparty } : {}),
      });
    }
  }

  const totalRows = rows.length;
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
