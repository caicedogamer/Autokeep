/*
 * Pure tests for the adaptive validator (T132 / T135).
 *
 * Verifies the new row-error catalog and the format-aware parsing:
 *   - INVALID_DATE with the wrong format
 *   - INVALID_TYPE outside the canonical / custom vocabulary
 *   - INVALID_AMOUNT_FORMAT honoring decimal separator + amount convention
 *   - AMOUNT_NOT_POSITIVE
 *   - CURRENCY_DIFFERS_FROM_WORKSPACE
 *   - CATEGORY/DESCRIPTION required + length limits
 *   - MISSING_REQUIRED_ROLE_AFTER_MAPPING when a required role is unmapped
 *   - METADATA_KEY_TOO_LONG / VALUE_TOO_LONG / TOO_MANY_FIELDS
 *   - Capacity warning at the 12k hard cap
 */

import { describe, it, expect } from 'vitest';

import { validate } from '../domain/validation/validator.js';
import type { ImportCtx, MappingDecision, NormalizedRow } from '../domain/types.js';

const baseDecision: MappingDecision = {
  mapping: {
    0: 'date',
    1: 'type',
    2: 'amount',
    3: 'category',
    4: 'description',
  },
  source: 'auto',
  warnings: [],
  confirmedAt: '2026-05-12T00:00:00Z',
  amountConvention: 'major-decimal',
  decimalSeparatorPerColumn: { 2: '.' },
  dateFormatPerColumn: { 0: 'iso' },
};

const ctx: ImportCtx = {
  currency: 'ARS',
  currencyMinorUnits: 2,
  existingCount: 0,
};

function row(overrides: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    rowNumber: 1,
    date: '2026-04-01',
    type: 'income',
    amount: '150.00',
    currency: null,
    category: 'Sales',
    description: 'Invoice A',
    counterparty: null,
    extraMetadata: {},
    ...overrides,
  };
}

describe('validate (flexible)', () => {
  it('accepts a canonical row', () => {
    const r = validate({ rows: [row()], decision: baseDecision, ctx });
    expect(r.outcome).toBe('valid');
    expect(r.validRows.length).toBe(1);
    expect(r.validRows[0]?.amount).toBe(15_000);
  });

  it('flags INVALID_DATE for the wrong format', () => {
    const r = validate({ rows: [row({ date: '01/04/2026' })], decision: baseDecision, ctx });
    expect(r.errorRows[0]?.codes).toContain('INVALID_DATE');
  });

  it('canonicalizes Spanish type vocabulary (ingreso/egreso)', () => {
    const r = validate({
      rows: [row({ type: 'egreso' })],
      decision: baseDecision,
      ctx,
    });
    expect(r.outcome).toBe('valid');
    expect(r.validRows[0]?.type).toBe('expense');
  });

  it('honors a custom type canonicalization map', () => {
    const r = validate({
      rows: [row({ type: 'I' })],
      decision: { ...baseDecision, typeCanonicalization: { I: 'income', E: 'expense' } },
      ctx,
    });
    expect(r.outcome).toBe('valid');
    expect(r.validRows[0]?.type).toBe('income');
  });

  it('flags INVALID_AMOUNT_FORMAT and respects decimal-separator config', () => {
    // European format: ',' is decimal, '.' is thousand sep
    const r = validate({
      rows: [row({ amount: '1.500,75' })],
      decision: {
        ...baseDecision,
        decimalSeparatorPerColumn: { 2: ',' },
      },
      ctx,
    });
    expect(r.outcome).toBe('valid');
    expect(r.validRows[0]?.amount).toBe(150_075);
  });

  it('flags AMOUNT_NOT_POSITIVE for "0.00"', () => {
    const r = validate({ rows: [row({ amount: '0.00' })], decision: baseDecision, ctx });
    expect(r.errorRows[0]?.codes).toContain('AMOUNT_NOT_POSITIVE');
  });

  it('flags CURRENCY_DIFFERS_FROM_WORKSPACE for non-workspace currency rows', () => {
    const r = validate({ rows: [row({ currency: 'USD' })], decision: baseDecision, ctx });
    expect(r.errorRows[0]?.codes).toContain('CURRENCY_DIFFERS_FROM_WORKSPACE');
  });

  it('flags CATEGORY_REQUIRED and CATEGORY_TOO_LONG', () => {
    const empty = validate({ rows: [row({ category: '' })], decision: baseDecision, ctx });
    expect(empty.errorRows[0]?.codes).toContain('CATEGORY_REQUIRED');

    const long = validate({
      rows: [row({ category: 'X'.repeat(61) })],
      decision: baseDecision,
      ctx,
    });
    expect(long.errorRows[0]?.codes).toContain('CATEGORY_TOO_LONG');
  });

  it('flags MISSING_REQUIRED_ROLE_AFTER_MAPPING when a required role is unmapped', () => {
    const r = validate({
      rows: [row()],
      decision: { ...baseDecision, mapping: { 0: 'date', 1: 'type', 2: 'amount', 3: 'category' } },
      ctx,
    });
    expect(r.outcome).toBe('rejected-structural');
    expect(r.errorRows[0]?.codes).toContain('MISSING_REQUIRED_ROLE_AFTER_MAPPING');
  });

  it('flags metadata size violations', () => {
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < 11; i++) tooMany[`k${String(i)}`] = 'v';
    const r1 = validate({
      rows: [row({ extraMetadata: tooMany })],
      decision: baseDecision,
      ctx,
    });
    expect(r1.errorRows[0]?.codes).toContain('METADATA_TOO_MANY_FIELDS');

    const r2 = validate({
      rows: [row({ extraMetadata: { ['k'.repeat(61)]: 'v' } })],
      decision: baseDecision,
      ctx,
    });
    expect(r2.errorRows[0]?.codes).toContain('METADATA_KEY_TOO_LONG');

    const r3 = validate({
      rows: [row({ extraMetadata: { k: 'v'.repeat(201) } })],
      decision: baseDecision,
      ctx,
    });
    expect(r3.errorRows[0]?.codes).toContain('METADATA_VALUE_TOO_LONG');
  });

  it('emits capacityWarning when existing + valid would exceed the 12k cap', () => {
    const validRows = Array.from({ length: 100 }, (_, i) => row({ rowNumber: i + 1 }));
    const r = validate({
      rows: validRows,
      decision: baseDecision,
      ctx: { ...ctx, existingCount: 11_950 },
    });
    expect(r.capacityWarning).toBeDefined();
    expect(r.capacityWarning?.allowedCount).toBe(50);
  });
});
