/*
 * SC-005: Export round-trip test.
 *
 * Exports a set of records to CSV and JSON, then validates the output
 * through the corresponding import validators and asserts that every
 * exported record can be re-imported without errors.
 */

import { describe, it, expect } from 'vitest';

import { serializeToCsv } from '../domain/csv-serializer.js';
import { serializeToJson } from '../domain/json-serializer.js';
import { validateCsvRows } from '../../import/domain/csv-schema.js';
import { validateJsonPayload } from '../../import/domain/json-schema.js';
import { emptyFilterState } from '../../filters/domain/types.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../../records/domain/types.js';
import type { FinancialRecord, Category, Counterparty } from '../../records/domain/types.js';

/* ---------- Fixtures ---------- */

const catId = toId('00000000-0000-0000-0000-000000000001');
const cpId = toId('00000000-0000-0000-0000-000000000002');

const CAT: Category = {
  id: catId,
  name: 'Ventas',
  learnedFromAi: false,
  createdAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
  updatedAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
  schemaVersion: 1,
};

const CP: Counterparty = {
  id: cpId,
  name: 'Acme S.A.',
  aliases: [],
  createdAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
  updatedAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
  schemaVersion: 1,
};

const RECORDS: FinancialRecord[] = [
  {
    id: toId('00000000-0000-0000-0000-000000000010'),
    date: toIsoDate('2026-05-01'),
    type: 'income',
    amount: toMoneyMinor(150000), // ARS 1500.00
    categoryId: catId,
    counterpartyId: cpId,
    description: 'Factura A 0001-00012345',
    source: 'manual',
    version: 1,
    createdAt: toIsoDateTime('2026-05-01T10:00:00.000Z'),
    updatedAt: toIsoDateTime('2026-05-01T10:00:00.000Z'),
    schemaVersion: 1,
  },
  {
    id: toId('00000000-0000-0000-0000-000000000011'),
    date: toIsoDate('2026-05-02'),
    type: 'expense',
    amount: toMoneyMinor(5000), // ARS 50.00
    categoryId: catId,
    description: 'Gasto, con, comas en la descripción',
    source: 'manual',
    version: 1,
    createdAt: toIsoDateTime('2026-05-02T08:00:00.000Z'),
    updatedAt: toIsoDateTime('2026-05-02T08:00:00.000Z'),
    schemaVersion: 1,
  },
];

const CAT_MAP = new Map([[catId, CAT]]);
const CP_MAP = new Map([[cpId, CP]]);
const CURRENCY = 'ARS';
const MINOR_UNITS = 2 as const;
const CTX = { currency: CURRENCY, currencyMinorUnits: MINOR_UNITS, existingCount: 0 };

/* ---------- CSV round-trip ---------- */

describe('CSV round-trip (SC-005)', () => {
  it('all exported rows parse without errors', () => {
    const csvText = serializeToCsv({
      records: RECORDS,
      categories: CAT_MAP,
      counterparties: CP_MAP,
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      filterState: emptyFilterState(),
    });

    // Split into header + data rows
    const lines = csvText.split('\r\n').filter((l) => l.trim());
    const [headerLine, ...dataLines] = lines;
    const headers = headerLine!.split(',');
    const rows = dataLines.map((l) => {
      // Simple split respecting quotes
      const result: string[] = [];
      let inQuote = false;
      let cur = '';
      for (const ch of l) {
        if (ch === '"') {
          inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
          result.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      result.push(cur);
      return result;
    });

    const report = validateCsvRows({ headers, rows }, CTX);
    expect(report.outcome).toBe('valid');
    expect(report.validRows).toHaveLength(RECORDS.length);
    expect(report.errorRows).toHaveLength(0);
  });

  it('exported amount is correct decimal representation', () => {
    const csvText = serializeToCsv({
      records: RECORDS,
      categories: CAT_MAP,
      counterparties: CP_MAP,
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      filterState: emptyFilterState(),
    });

    // First data row: amount = 150000 minor → 1500.00
    const dataLines = csvText
      .split('\r\n')
      .filter((l) => l.trim())
      .slice(1);
    const firstLine = dataLines[0]!;
    // amount is 3rd column (index 2)
    const amount = firstLine.split(',')[2];
    expect(amount).toBe('1500.00');
  });

  it('fields with commas are properly quoted', () => {
    const csvText = serializeToCsv({
      records: RECORDS,
      categories: CAT_MAP,
      counterparties: CP_MAP,
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      filterState: emptyFilterState(),
    });

    // Second record has commas in description
    expect(csvText).toContain('"Gasto, con, comas en la descripción"');
  });

  it('rows are ordered by date ascending', () => {
    const reversed = [...RECORDS].reverse();
    const csvText = serializeToCsv({
      records: reversed,
      categories: CAT_MAP,
      counterparties: CP_MAP,
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      filterState: emptyFilterState(),
    });

    const lines = csvText
      .split('\r\n')
      .filter((l) => l.trim())
      .slice(1);
    const firstDate = lines[0]!.split(',')[0];
    const secondDate = lines[1]!.split(',')[0];
    expect(firstDate! <= secondDate!).toBe(true);
  });

  it('filter reduces exported rows', () => {
    const csvText = serializeToCsv({
      records: RECORDS,
      categories: CAT_MAP,
      counterparties: CP_MAP,
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      filterState: { ...emptyFilterState(), types: ['income'] },
    });

    const lines = csvText
      .split('\r\n')
      .filter((l) => l.trim())
      .slice(1);
    expect(lines).toHaveLength(1);
  });
});

/* ---------- JSON round-trip ---------- */

describe('JSON round-trip (SC-005)', () => {
  it('all exported rows parse without errors', () => {
    const payload = serializeToJson({
      records: RECORDS,
      categories: CAT_MAP,
      counterparties: CP_MAP,
      workspaceId: '00000000-0000-0000-0000-000000000001',
      workspaceName: 'Test',
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      filterState: emptyFilterState(),
    });

    // The JSON export payload wraps records inside; feed the re-shaped payload
    const importPayload = {
      schemaVersion: 1,
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      records: payload.records.map((r) => ({ ...r })),
    };

    const report = validateJsonPayload(importPayload, CTX);
    expect(report.outcome).toBe('valid');
    expect(report.validRows).toHaveLength(RECORDS.length);
    expect(report.errorRows).toHaveLength(0);
  });

  it('amount is in integer minor units', () => {
    const payload = serializeToJson({
      records: RECORDS,
      categories: CAT_MAP,
      counterparties: CP_MAP,
      workspaceId: '00000000-0000-0000-0000-000000000001',
      workspaceName: 'Test',
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      filterState: emptyFilterState(),
    });

    expect(payload.records[0]!.amount).toBe(150000);
    expect(Number.isInteger(payload.records[0]!.amount)).toBe(true);
  });

  it('counterparty is omitted when absent', () => {
    const payload = serializeToJson({
      records: RECORDS,
      categories: CAT_MAP,
      counterparties: CP_MAP,
      workspaceId: '00000000-0000-0000-0000-000000000001',
      workspaceName: 'Test',
      currency: CURRENCY,
      currencyMinorUnits: MINOR_UNITS,
      filterState: emptyFilterState(),
    });

    // Second record has no counterpartyId
    expect(payload.records[1]).not.toHaveProperty('counterparty');
  });
});
