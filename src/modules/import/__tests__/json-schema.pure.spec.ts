import { describe, it, expect } from 'vitest';

import { validateJsonPayload } from '../domain/json-schema.js';
import type { ImportCtx } from '../domain/types.js';

/* ---------- Fixture ---------- */

const ctx: ImportCtx = {
  currency: 'ARS',
  currencyMinorUnits: 2,
  existingCount: 0,
};

const VALID_RECORD = {
  date: '2026-05-01',
  type: 'income',
  amount: 10000,
  category: 'Ventas',
  description: 'Factura #1',
  counterparty: 'Acme',
};

function makePayload(records: unknown[] = [VALID_RECORD]): unknown {
  return {
    schemaVersion: 1,
    currency: 'ARS',
    currencyMinorUnits: 2,
    records,
  };
}

/* ---------- Structural rejections ---------- */

describe('validateJsonPayload — structural', () => {
  it('rejects null', () => {
    const r = validateJsonPayload(null, ctx);
    expect(r.outcome).toBe('rejected-structural');
    expect(r.structuralCode).toBe('WRONG_TOP_LEVEL_TYPE');
  });

  it('rejects array', () => {
    const r = validateJsonPayload([], ctx);
    expect(r.outcome).toBe('rejected-structural');
  });

  it('rejects missing schemaVersion', () => {
    const r = validateJsonPayload({ currency: 'ARS', currencyMinorUnits: 2, records: [] }, ctx);
    expect(r.structuralCode).toBe('MISSING_OR_WRONG_SCHEMA_VERSION');
  });

  it('rejects unknown schemaVersion', () => {
    const r = validateJsonPayload(
      { schemaVersion: 99, currency: 'ARS', currencyMinorUnits: 2, records: [] },
      ctx,
    );
    expect(r.structuralCode).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects currency mismatch', () => {
    const r = validateJsonPayload(
      { schemaVersion: 1, currency: 'USD', currencyMinorUnits: 2, records: [] },
      ctx,
    );
    expect(r.structuralCode).toBe('CURRENCY_MISMATCH');
  });

  it('rejects currencyMinorUnits mismatch', () => {
    const r = validateJsonPayload(
      { schemaVersion: 1, currency: 'ARS', currencyMinorUnits: 3, records: [] },
      ctx,
    );
    expect(r.structuralCode).toBe('MINOR_UNITS_MISMATCH');
  });

  it('rejects records as non-array', () => {
    const r = validateJsonPayload(
      { schemaVersion: 1, currency: 'ARS', currencyMinorUnits: 2, records: {} },
      ctx,
    );
    expect(r.structuralCode).toBe('RECORDS_NOT_ARRAY');
  });
});

/* ---------- Valid records ---------- */

describe('validateJsonPayload — valid', () => {
  it('parses a valid payload', () => {
    const r = validateJsonPayload(makePayload(), ctx);
    expect(r.outcome).toBe('valid');
    expect(r.validRows).toHaveLength(1);
    expect(r.validRows[0]!.amount).toBe(10000);
    expect(r.validRows[0]!.type).toBe('income');
  });

  it('omits counterpartyName when field is absent', () => {
    const record = { ...VALID_RECORD };
    const { counterparty: _, ...nocp } = record;
    void _;
    const r = validateJsonPayload(makePayload([nocp]), ctx);
    expect(r.validRows[0]).not.toHaveProperty('counterpartyName');
  });
});

/* ---------- Per-row errors ---------- */

describe('validateJsonPayload — per-row errors', () => {
  it('rejects non-integer amount', () => {
    const r = validateJsonPayload(makePayload([{ ...VALID_RECORD, amount: 10.5 }]), ctx);
    expect(r.errorRows[0]!.codes).toContain('AMOUNT_NOT_INTEGER');
  });

  it('rejects non-positive amount', () => {
    const r = validateJsonPayload(makePayload([{ ...VALID_RECORD, amount: 0 }]), ctx);
    expect(r.errorRows[0]!.codes).toContain('AMOUNT_NOT_POSITIVE');
  });

  it('rejects invalid date', () => {
    const r = validateJsonPayload(makePayload([{ ...VALID_RECORD, date: '2026/05/01' }]), ctx);
    expect(r.errorRows[0]!.codes).toContain('INVALID_DATE');
  });

  it('rejects invalid type', () => {
    const r = validateJsonPayload(makePayload([{ ...VALID_RECORD, type: 'debit' }]), ctx);
    expect(r.errorRows[0]!.codes).toContain('INVALID_TYPE');
  });

  it('rejects empty category', () => {
    const r = validateJsonPayload(makePayload([{ ...VALID_RECORD, category: '' }]), ctx);
    expect(r.errorRows[0]!.codes).toContain('CATEGORY_REQUIRED');
  });

  it('rejects category > 60 chars', () => {
    const r = validateJsonPayload(
      makePayload([{ ...VALID_RECORD, category: 'A'.repeat(61) }]),
      ctx,
    );
    expect(r.errorRows[0]!.codes).toContain('CATEGORY_TOO_LONG');
  });

  it('rejects empty description', () => {
    const r = validateJsonPayload(makePayload([{ ...VALID_RECORD, description: '' }]), ctx);
    expect(r.errorRows[0]!.codes).toContain('DESCRIPTION_REQUIRED');
  });

  it('rejects counterparty > 120 chars', () => {
    const r = validateJsonPayload(
      makePayload([{ ...VALID_RECORD, counterparty: 'X'.repeat(121) }]),
      ctx,
    );
    expect(r.errorRows[0]!.codes).toContain('COUNTERPARTY_TOO_LONG');
  });

  it('rejects unknown field', () => {
    const r = validateJsonPayload(makePayload([{ ...VALID_RECORD, extraField: 'bad' }]), ctx);
    expect(r.errorRows[0]!.codes).toContain('UNKNOWN_FIELD');
  });

  it('aggregates multiple errors', () => {
    const r = validateJsonPayload(
      makePayload([{ date: 'bad', type: 'debit', amount: 0, category: '', description: '' }]),
      ctx,
    );
    expect(r.errorRows[0]!.codes.length).toBeGreaterThan(2);
  });
});

describe('validateJsonPayload — capacity warning', () => {
  it('adds capacityWarning when valid rows would exceed 12 000', () => {
    const overCtx: ImportCtx = { ...ctx, existingCount: 11_999 };
    const r = validateJsonPayload(makePayload([VALID_RECORD, VALID_RECORD]), overCtx);
    expect(r.capacityWarning).toBeDefined();
    expect(r.capacityWarning!.allowedCount).toBe(1);
  });
});
