/*
 * CSV export serializer (US4 / FR-017 / SC-005).
 *
 * Produces a RFC-4180-compliant UTF-8 CSV with the column order defined in
 * contracts/export-csv.schema.md. Amount is rendered as a decimal string
 * with exactly `currencyMinorUnits` fractional digits.
 *
 * Pure function — no I/O. Round-trip tested with the CSV importer (SC-005).
 */

import type { FinancialRecord, Category, Counterparty } from '../../records/domain/types.js';
import type { FilterState } from '../../filters/domain/types.js';
import { applyFilters } from '../../filters/domain/predicates.js';

export interface CsvExportInput {
  readonly records: readonly FinancialRecord[];
  readonly categories: ReadonlyMap<string, Category>;
  readonly counterparties: ReadonlyMap<string, Counterparty>;
  readonly currency: string;
  readonly currencyMinorUnits: 0 | 2 | 3;
  readonly filterState: FilterState;
}

const HEADERS = ['date', 'type', 'amount', 'currency', 'category', 'description', 'counterparty'];
const CRLF = '\r\n';

function csvField(value: string): string {
  if (/[,"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toDecimal(minor: number, minorDigits: number): string {
  const factor = Math.pow(10, minorDigits);
  const whole = Math.floor(Math.abs(minor) / factor);
  const frac = Math.abs(minor) % factor;
  if (minorDigits === 0) return String(whole);
  return `${String(whole)}.${String(frac).padStart(minorDigits, '0')}`;
}

function sortRecords(records: readonly FinancialRecord[]): readonly FinancialRecord[] {
  return [...records].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

export function serializeToCsv(input: CsvExportInput): string {
  const filtered = applyFilters(input.records, input.filterState);
  const sorted = sortRecords(filtered);

  const lines: string[] = [HEADERS.join(',')];

  for (const record of sorted) {
    const cat = input.categories.get(record.categoryId);
    const cp =
      record.counterpartyId !== undefined
        ? input.counterparties.get(record.counterpartyId)
        : undefined;

    const row = [
      record.date,
      record.type,
      toDecimal(record.amount, input.currencyMinorUnits),
      input.currency,
      cat?.name ?? '',
      record.description,
      cp?.name ?? '',
    ].map(csvField);

    lines.push(row.join(','));
  }

  return lines.join(CRLF) + CRLF;
}
