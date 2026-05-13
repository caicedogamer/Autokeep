import { describe, it, expect } from 'vitest';

import { validateCsvRows } from '../domain/csv-schema.js';
import type { ParsedCsvInput } from '../domain/csv-schema.js';
import type { ImportCtx } from '../domain/types.js';

/* ---------- Fixture ---------- */

const ctx: ImportCtx = {
  currency: 'ARS',
  currencyMinorUnits: 2,
  existingCount: 0,
};

const VALID_HEADERS = [
  'date',
  'type',
  'amount',
  'currency',
  'category',
  'description',
  'counterparty',
];

function makeInput(rows: string[][]): ParsedCsvInput {
  return { headers: VALID_HEADERS, rows };
}

const VALID_ROW = ['2026-05-01', 'income', '100.00', 'ARS', 'Ventas', 'Factura #1', 'Acme'];

/* ---------- Header validation ---------- */

describe('validateCsvRows — header check', () => {
  it('rejects wrong column order', () => {
    const r = validateCsvRows(
      {
        headers: ['type', 'date', 'amount', 'currency', 'category', 'description', 'counterparty'],
        rows: [],
      },
      ctx,
    );
    expect(r.outcome).toBe('rejected-structural');
    expect(r.structuralCode).toBe('HEADER_MISMATCH');
  });

  it('rejects missing column', () => {
    const r = validateCsvRows(
      { headers: ['date', 'type', 'amount', 'currency', 'category', 'description'], rows: [] },
      ctx,
    );
    expect(r.outcome).toBe('rejected-structural');
  });

  it('accepts header with correct order', () => {
    const r = validateCsvRows(makeInput([VALID_ROW]), ctx);
    expect(r.outcome).toBe('valid');
  });
});

/* ---------- Per-row validation ---------- */

describe('validateCsvRows — valid rows', () => {
  it('parses a valid row correctly', () => {
    const r = validateCsvRows(makeInput([VALID_ROW]), ctx);
    expect(r.validRows).toHaveLength(1);
    expect(r.validRows[0]!.type).toBe('income');
    expect(r.validRows[0]!.categoryName).toBe('Ventas');
    expect(r.validRows[0]!.counterpartyName).toBe('Acme');
  });

  it('omits counterpartyName when cell is empty', () => {
    const row = [...VALID_ROW];
    row[6] = '';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.validRows[0]).not.toHaveProperty('counterpartyName');
  });

  it('converts amount to minor units', () => {
    const r = validateCsvRows(makeInput([VALID_ROW]), ctx);
    expect(r.validRows[0]!.amount).toBe(10000);
  });
});

describe('validateCsvRows — date errors', () => {
  it('rejects non-ISO date', () => {
    const row = [...VALID_ROW];
    row[0] = '01/05/2026';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('INVALID_DATE');
  });

  it('rejects invalid calendar date', () => {
    const row = [...VALID_ROW];
    row[0] = '2026-02-30';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('INVALID_DATE');
  });
});

describe('validateCsvRows — type errors', () => {
  it('rejects unknown type', () => {
    const row = [...VALID_ROW];
    row[1] = 'debit';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('INVALID_TYPE');
  });
});

describe('validateCsvRows — amount errors', () => {
  it('rejects negative amount', () => {
    const row = [...VALID_ROW];
    row[2] = '-100.00';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('INVALID_AMOUNT_FORMAT');
  });

  it('rejects amount with too many decimal places', () => {
    const row = [...VALID_ROW];
    row[2] = '100.001';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('INVALID_AMOUNT_FORMAT');
  });

  it('rejects zero amount', () => {
    const row = [...VALID_ROW];
    row[2] = '0';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('AMOUNT_NOT_POSITIVE');
  });
});

describe('validateCsvRows — currency errors', () => {
  it('rejects wrong currency', () => {
    const row = [...VALID_ROW];
    row[3] = 'USD';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('CURRENCY_MISMATCH');
  });
});

describe('validateCsvRows — category/description errors', () => {
  it('rejects empty category', () => {
    const row = [...VALID_ROW];
    row[4] = '';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('CATEGORY_REQUIRED');
  });

  it('rejects category > 60 chars', () => {
    const row = [...VALID_ROW];
    row[4] = 'A'.repeat(61);
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('CATEGORY_TOO_LONG');
  });

  it('rejects empty description', () => {
    const row = [...VALID_ROW];
    row[5] = '';
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('DESCRIPTION_REQUIRED');
  });

  it('rejects description > 280 chars', () => {
    const row = [...VALID_ROW];
    row[5] = 'B'.repeat(281);
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('DESCRIPTION_TOO_LONG');
  });

  it('rejects counterparty > 120 chars', () => {
    const row = [...VALID_ROW];
    row[6] = 'C'.repeat(121);
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('COUNTERPARTY_TOO_LONG');
  });
});

describe('validateCsvRows — multi-error aggregation', () => {
  it('collects multiple errors on one row', () => {
    const row = ['bad-date', 'debit', '-1', 'USD', '', '', ''];
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes.length).toBeGreaterThan(2);
  });
});

describe('validateCsvRows — mixed rows', () => {
  it('reports partial outcome when some rows pass and some fail', () => {
    const badRow = [...VALID_ROW];
    badRow[1] = 'debit';
    const r = validateCsvRows(makeInput([VALID_ROW, badRow]), ctx);
    expect(r.outcome).toBe('partial');
    expect(r.validRows).toHaveLength(1);
    expect(r.errorRows).toHaveLength(1);
  });
});

describe('validateCsvRows — field count', () => {
  it('rejects rows with too few fields', () => {
    const r = validateCsvRows(makeInput([['2026-01-01', 'income']]), ctx);
    expect(r.errorRows[0]!.codes).toContain('MISSING_FIELDS');
  });

  it('flags rows with extra fields', () => {
    const row = [...VALID_ROW, 'extra'];
    const r = validateCsvRows(makeInput([row]), ctx);
    expect(r.errorRows[0]!.codes).toContain('EXTRA_FIELDS');
  });
});

describe('validateCsvRows — capacity warning', () => {
  it('adds capacityWarning when valid rows would exceed 12 000', () => {
    const overCtx: ImportCtx = { ...ctx, existingCount: 11_999 };
    const rows = [VALID_ROW, VALID_ROW];
    const r = validateCsvRows(makeInput(rows), overCtx);
    expect(r.capacityWarning).toBeDefined();
    expect(r.capacityWarning!.allowedCount).toBe(1);
  });
});
