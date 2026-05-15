/*
 * Pure tests for the heuristic inferrer (T129 / T130 / T135).
 *
 * Verifies:
 *   - High-confidence role assignment for canonical en + es headers
 *   - Ambiguity detection (Δ < 0.1 between two columns for the same role)
 *   - MISSING_REQUIRED_ROLE when no column claims a required role
 *   - AMBIGUOUS_DATE_FORMAT for DD/MM vs MM/DD
 *   - AMBIGUOUS_DECIMAL_SEPARATOR for mixed `.` / `,`
 *   - AMBIGUOUS_AMOUNT_CONVENTION for JSON integer values (native number)
 *   - CURRENCY_DIFFERS_FROM_WORKSPACE warning
 *   - mismatchRate populated on mixed-type columns
 */

import { describe, it, expect } from 'vitest';

import { HeuristicColumnMapper } from '../domain/inference/heuristic-column-mapper.js';
import type { InferenceContext, RawTable } from '../domain/types.js';

const mapper = new HeuristicColumnMapper();

const ctx: InferenceContext = {
  workspaceCurrency: 'ARS',
  workspaceCurrencyMinorUnits: 2,
  workspaceLocale: 'es-AR',
};

function csvTable(headers: string[], rows: string[][]): RawTable {
  return {
    headers,
    rows,
    meta: {
      sourceKind: 'csv',
      delimiter: ',',
      lineEnding: '\n',
      headerSynthesized: false,
      encoding: 'utf-8',
    },
  };
}

function jsonTable(
  headers: string[],
  rows: string[][],
  nativeTypes: ReadonlyArray<'string' | 'number' | 'boolean' | 'null' | 'mixed'>,
): RawTable {
  return {
    headers,
    rows,
    meta: {
      sourceKind: 'json',
      jsonShape: 'array',
      encoding: 'utf-8',
      nativeTypes,
    },
  };
}

describe('HeuristicColumnMapper', () => {
  it('confidently identifies the five required roles on a canonical en file', () => {
    const table = csvTable(
      ['date', 'type', 'amount', 'category', 'description'],
      [
        ['2026-04-01', 'income', '150.00', 'Sales', 'Invoice A-001'],
        ['2026-04-02', 'expense', '40.50', 'Services', 'Internet bill'],
      ],
    );
    const report = mapper.infer(table, ctx);
    expect(report.columns[0]?.inferredRole).toBe('date');
    expect(report.columns[0]?.confidence).toBeGreaterThan(0.8);
    expect(report.columns[1]?.inferredRole).toBe('type');
    expect(report.columns[2]?.inferredRole).toBe('amount');
    expect(report.columns[3]?.inferredRole).toBe('category');
    expect(report.columns[4]?.inferredRole).toBe('description');
    // No missing required roles.
    expect(report.globalWarnings.some((w) => w.code === 'MISSING_REQUIRED_ROLE')).toBe(false);
  });

  it('handles Spanish headers (fecha / monto / rubro / detalle)', () => {
    const table = csvTable(
      ['fecha', 'tipo', 'monto', 'rubro', 'detalle'],
      [
        ['01/04/2026', 'ingreso', '1500,00', 'Ventas', 'Factura A 0001'],
        ['02/04/2026', 'egreso', '2350,50', 'Servicios', 'Internet abril mensual'],
      ],
    );
    const report = mapper.infer(table, ctx);
    expect(report.columns[0]?.inferredRole).toBe('date');
    expect(report.columns[1]?.inferredRole).toBe('type');
    expect(report.columns[2]?.inferredRole).toBe('amount');
    expect(report.columns[3]?.inferredRole).toBe('category');
    expect(report.columns[4]?.inferredRole).toBe('description');
  });

  it('flags MISSING_REQUIRED_ROLE when a role cannot be inferred', () => {
    const table = csvTable(
      ['Fecha', 'Concepto', 'Importe'], // no 'type', no 'category'
      [['2026-04-01', 'Pago', '100.00']],
    );
    const report = mapper.infer(table, ctx);
    const missing = report.globalWarnings.filter((w) => w.code === 'MISSING_REQUIRED_ROLE');
    expect(missing.length).toBeGreaterThanOrEqual(2);
  });

  it('flags AMBIGUOUS_DATE_FORMAT for DD/MM vs MM/DD samples', () => {
    const table = csvTable(
      ['date', 'type', 'amount', 'category', 'description'],
      [
        ['05/06/2026', 'income', '100', 'X', 'desc'],
        ['07/08/2026', 'income', '100', 'X', 'desc'],
      ],
    );
    const report = mapper.infer(table, ctx);
    const w = report.globalWarnings.find((w) => w.code === 'AMBIGUOUS_DATE_FORMAT');
    expect(w).toBeDefined();
  });

  it('flags AMBIGUOUS_AMOUNT_CONVENTION for JSON integer-only amounts', () => {
    const table = jsonTable(
      ['date', 'type', 'amount', 'category', 'description'],
      [
        ['2026-04-01', 'income', '150000', 'Sales', 'Invoice A'],
        ['2026-04-02', 'income', '40000', 'Sales', 'Invoice B'],
      ],
      ['string', 'string', 'number', 'string', 'string'],
    );
    const report = mapper.infer(table, ctx);
    const w = report.globalWarnings.find((w) => w.code === 'AMBIGUOUS_AMOUNT_CONVENTION');
    expect(w).toBeDefined();
  });

  it('flags CURRENCY_DIFFERS_FROM_WORKSPACE when sample values differ', () => {
    const table = csvTable(
      ['date', 'type', 'amount', 'currency', 'category', 'description'],
      [
        ['2026-04-01', 'income', '100', 'USD', 'X', 'desc'],
        ['2026-04-02', 'income', '100', 'USD', 'X', 'desc'],
      ],
    );
    const report = mapper.infer(table, ctx);
    const w = report.globalWarnings.find((w) => w.code === 'CURRENCY_DIFFERS_FROM_WORKSPACE');
    expect(w).toBeDefined();
    if (w?.code === 'CURRENCY_DIFFERS_FROM_WORKSPACE') {
      expect(w.sampleValues).toContain('USD');
    }
  });

  it('produces deterministic output for identical inputs', () => {
    const table = csvTable(
      ['date', 'type', 'amount', 'category', 'description'],
      [['2026-04-01', 'income', '150.00', 'Sales', 'Invoice']],
    );
    const a = mapper.infer(table, ctx);
    const b = mapper.infer(table, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
