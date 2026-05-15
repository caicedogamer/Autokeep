/*
 * Regression: importing a wrapped-JSON file that mirrors AutoKeep's own
 * export shape (schemaVersion + currency + records[]) must produce four
 * valid rows when the operator clicks Confirm without overriding the
 * inferrer's defaults.
 *
 * Walks the full pure pipeline (parse → infer → simulate MappingPreview
 * auto-confirm → normalize → validate). The mirrored "auto-confirm"
 * stays in sync with `MappingPreview.seedFormatDefaults` + `emitDecision`.
 */

import { describe, it, expect } from 'vitest';

import { parseJson } from '../domain/parsing/json-parser.js';
import { HeuristicColumnMapper } from '../domain/inference/heuristic-column-mapper.js';
import { normalize } from '../domain/normalization/normalizer.js';
import { validate } from '../domain/validation/validator.js';
import type {
  AmountConvention,
  ColumnMapping,
  DateFormatId,
  DecimalSeparator,
  ImportCtx,
  InferenceContext,
  MappingDecision,
  SemanticRole,
} from '../domain/types.js';

const SAMPLE = JSON.stringify({
  schemaVersion: 1,
  currency: 'MXN',
  currencyMinorUnits: 2,
  records: [
    {
      date: '2024-01-15',
      type: 'income',
      amount: 500_000,
      category: 'Ventas',
      description: 'Pago de cliente ABC',
      counterparty: 'Cliente ABC',
    },
    {
      date: '2024-01-20',
      type: 'expense',
      amount: 120_050,
      category: 'Servicios',
      description: 'Renta de oficina',
      counterparty: 'Inmobiliaria XYZ',
    },
    {
      date: '2024-02-01',
      type: 'expense',
      amount: 35_000,
      category: 'Nómina',
      description: 'Pago quincena empleados',
      counterparty: '',
    },
    {
      date: '2024-02-10',
      type: 'income',
      amount: 1_250_000,
      category: 'Consultoría',
      description: 'Proyecto de auditoría Q1',
    },
  ],
});

function toBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

function autoConfirm(inferReport: ReturnType<HeuristicColumnMapper['infer']>): MappingDecision {
  const mapping: Record<number, SemanticRole> = {};
  for (const c of inferReport.columns) {
    mapping[c.columnIndex] = c.inferredRole;
  }
  const dateFormatPerColumn: Record<number, DateFormatId> = {};
  const decimalSeparatorPerColumn: Record<number, DecimalSeparator> = {};
  let amountConvention: AmountConvention = 'major-decimal';
  for (const w of inferReport.globalWarnings) {
    if (w.code === 'AMBIGUOUS_DATE_FORMAT' && w.candidates[0]) {
      dateFormatPerColumn[w.columnIndex] = w.candidates[0];
    } else if (w.code === 'AMBIGUOUS_DECIMAL_SEPARATOR' && w.candidates[0]) {
      decimalSeparatorPerColumn[w.columnIndex] = w.candidates[0];
    } else if (w.code === 'AMBIGUOUS_AMOUNT_CONVENTION' && w.candidates[0]) {
      amountConvention = w.candidates[0];
    }
  }
  return {
    mapping: mapping as ColumnMapping,
    source: 'auto',
    warnings: inferReport.globalWarnings,
    confirmedAt: '2026-05-14T00:00:00Z',
    amountConvention,
    ...(Object.keys(dateFormatPerColumn).length > 0 ? { dateFormatPerColumn } : {}),
    ...(Object.keys(decimalSeparatorPerColumn).length > 0 ? { decimalSeparatorPerColumn } : {}),
  };
}

describe('wrapped-JSON import (AutoKeep export re-import)', () => {
  it('imports all 4 rows without rejection when the operator accepts the inferrer defaults', () => {
    const parse = parseJson(toBuffer(SAMPLE));
    expect(parse.rejection).toBeUndefined();
    const table = parse.table;
    if (!table) throw new Error('parse returned no table');

    const inferCtx: InferenceContext = {
      workspaceCurrency: 'MXN',
      workspaceCurrencyMinorUnits: 2,
      workspaceLocale: 'es-MX',
    };
    const inferReport = new HeuristicColumnMapper().infer(table, inferCtx);

    // Confirm-with-defaults: the only ambiguity here is amountConvention
    // (all-integer amounts native to JSON). MappingPreview seeds the
    // first candidate (minor-units) and the operator can accept without
    // clicking a radio.
    const decision = autoConfirm(inferReport);
    expect(decision.amountConvention).toBe('minor-units');

    const normalized = normalize(table, decision);
    const ctx: ImportCtx = { currency: 'MXN', currencyMinorUnits: 2, existingCount: 0 };
    const report = validate({ rows: normalized, decision, ctx });

    expect(report.outcome).toBe('valid');
    expect(report.errorRows).toEqual([]);
    expect(report.validRows.length).toBe(4);
    expect(report.validRows[0]?.amount).toBe(500_000);
    expect(report.validRows[1]?.amount).toBe(120_050);
    expect(report.validRows[2]?.amount).toBe(35_000);
    expect(report.validRows[3]?.amount).toBe(1_250_000);
  });
});
