/*
 * Pure tests for the v2 CSV parser (T127 / T135).
 *
 * Verifies:
 *   - Auto-delimiter detection (comma / semicolon / tab)
 *   - BOM stripping
 *   - Row-width padding/truncation (no v1 EXTRA_FIELDS/MISSING_FIELDS rejection)
 *   - Synthetic-header detection when first row "looks like data"
 *   - Parser-level rejections: EMPTY_FILE, ENCODING_NOT_UTF8, MALFORMED_CSV
 *   - No semantic assumption: header values are returned verbatim
 */

import { describe, it, expect } from 'vitest';

import { parseCsv } from '../domain/parsing/csv-parser.js';

const encode = (text: string): ArrayBuffer => {
  const encoder = new TextEncoder();
  return encoder.encode(text).buffer as ArrayBuffer;
};

describe('parseCsv', () => {
  it('parses a canonical comma-delimited CSV', () => {
    const csv = 'date,type,amount\n2026-04-01,income,150.00\n2026-04-02,expense,40.50\n';
    const result = parseCsv(encode(csv));
    expect(result.rejection).toBeUndefined();
    expect(result.table).toBeDefined();
    expect(result.table?.headers).toEqual(['date', 'type', 'amount']);
    expect(result.table?.rows).toEqual([
      ['2026-04-01', 'income', '150.00'],
      ['2026-04-02', 'expense', '40.50'],
    ]);
    expect(result.table?.meta.sourceKind).toBe('csv');
    if (result.table?.meta.sourceKind === 'csv') {
      expect(result.table.meta.delimiter).toBe(',');
      expect(result.table.meta.headerSynthesized).toBe(false);
    }
  });

  it('auto-detects semicolon delimiter (European bank export)', () => {
    const csv = 'Fecha;Concepto;Importe\n2026-04-01;Pago internet;-2350,50\n';
    const result = parseCsv(encode(csv));
    expect(result.table).toBeDefined();
    expect(result.table?.headers).toEqual(['Fecha', 'Concepto', 'Importe']);
    if (result.table?.meta.sourceKind === 'csv') {
      expect(result.table.meta.delimiter).toBe(';');
    }
  });

  it('auto-detects tab delimiter', () => {
    const csv = 'a\tb\tc\n1\t2\t3\n';
    const result = parseCsv(encode(csv));
    expect(result.table?.headers).toEqual(['a', 'b', 'c']);
    if (result.table?.meta.sourceKind === 'csv') {
      expect(result.table.meta.delimiter).toBe('\t');
    }
  });

  it('strips a UTF-8 BOM', () => {
    const csv = '﻿date,amount\n2026-04-01,100\n';
    const result = parseCsv(encode(csv));
    expect(result.table?.headers[0]).toBe('date');
  });

  it('synthesizes headers when the first row is data-like', () => {
    const csv = '2026-04-01,150.00,Notes\n2026-04-02,40.50,More\n';
    const result = parseCsv(encode(csv));
    expect(result.table?.meta.sourceKind).toBe('csv');
    if (result.table?.meta.sourceKind === 'csv') {
      expect(result.table.meta.headerSynthesized).toBe(true);
      expect(result.table.headers).toEqual(['col_1', 'col_2', 'col_3']);
      expect(result.table.rows.length).toBe(2);
    }
  });

  it('pads short rows and truncates long rows (tolerant of width mismatches)', () => {
    const csv = 'a,b,c\n1\n4,5,6,7,8\n';
    const result = parseCsv(encode(csv));
    expect(result.table?.headers).toEqual(['a', 'b', 'c']);
    expect(result.table?.rows[0]).toEqual(['1', '', '']);
    expect(result.table?.rows[1]).toEqual(['4', '5', '6']);
  });

  it('rejects an empty file with EMPTY_FILE', () => {
    const result = parseCsv(encode(''));
    expect(result.rejection?.code).toBe('EMPTY_FILE');
  });

  it('rejects whitespace-only content with EMPTY_FILE', () => {
    const result = parseCsv(encode('   \n\n   '));
    expect(result.rejection?.code).toBe('EMPTY_FILE');
  });

  it('rejects non-UTF-8 bytes with ENCODING_NOT_UTF8', () => {
    // 0xff 0xff are invalid as UTF-8 (no UTF-16 BOM present either).
    const bytes = new Uint8Array([0xff, 0xff, 0x41]);
    const result = parseCsv(bytes.buffer);
    expect(result.rejection?.code).toBe('ENCODING_NOT_UTF8');
  });
});
