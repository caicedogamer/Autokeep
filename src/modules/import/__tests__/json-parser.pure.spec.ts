/*
 * Pure tests for the v2 JSON parser (T128 / T135).
 *
 * Verifies the three accepted shapes (array / wrapped / NDJSON), union-of-keys
 * header synthesis, native-type tracking for amount-convention detection,
 * and parser-level rejections (MALFORMED_JSON, WRONG_TOP_LEVEL_SHAPE, EMPTY_FILE).
 */

import { describe, it, expect } from 'vitest';

import { parseJson } from '../domain/parsing/json-parser.js';

const encode = (text: string): ArrayBuffer => {
  const encoder = new TextEncoder();
  return encoder.encode(text).buffer as ArrayBuffer;
};

describe('parseJson', () => {
  it('parses an array of objects with stable union-of-keys headers', () => {
    const json = JSON.stringify([
      { date: '2026-04-01', amount: 150, type: 'income' },
      { date: '2026-04-02', amount: 40, type: 'expense', counterparty: 'Acme' },
    ]);
    const result = parseJson(encode(json));
    expect(result.rejection).toBeUndefined();
    expect(result.table?.headers).toEqual(['date', 'amount', 'type', 'counterparty']);
    expect(result.table?.rows[0]).toEqual(['2026-04-01', '150', 'income', '']);
    expect(result.table?.rows[1]).toEqual(['2026-04-02', '40', 'expense', 'Acme']);
    expect(result.table?.meta.sourceKind).toBe('json');
    if (result.table?.meta.sourceKind === 'json') {
      expect(result.table.meta.jsonShape).toBe('array');
      // amount column is consistently numeric
      expect(result.table.meta.nativeTypes?.[1]).toBe('number');
    }
  });

  it('parses a wrapped array under "records"', () => {
    const json = JSON.stringify({
      exportedAt: '2026-04-30T10:00:00Z',
      records: [{ fecha: '2026-04-01', monto: 1500 }],
    });
    const result = parseJson(encode(json));
    expect(result.table?.meta.sourceKind).toBe('json');
    if (result.table?.meta.sourceKind === 'json') {
      expect(result.table.meta.jsonShape).toBe('wrapped');
      expect(result.table.meta.wrapperKey).toBe('records');
      expect(result.table.meta.wrapperFields).toEqual(['exportedAt']);
    }
    expect(result.table?.headers).toEqual(['fecha', 'monto']);
  });

  it('parses a wrapped array under "movements"', () => {
    const json = JSON.stringify({
      source: 'ERP',
      movements: [{ a: 1 }, { a: 2 }],
    });
    const result = parseJson(encode(json));
    if (result.table?.meta.sourceKind === 'json') {
      expect(result.table.meta.wrapperKey).toBe('movements');
    }
  });

  it('parses NDJSON (one object per line)', () => {
    const ndjson = '{"date":"2026-04-01","amount":150}\n{"date":"2026-04-02","amount":40}\n';
    const result = parseJson(encode(ndjson));
    expect(result.table?.meta.sourceKind).toBe('json');
    if (result.table?.meta.sourceKind === 'json') {
      expect(result.table.meta.jsonShape).toBe('ndjson');
    }
    expect(result.table?.rows.length).toBe(2);
  });

  it('rejects malformed JSON', () => {
    const result = parseJson(encode('{not valid json'));
    expect(result.rejection?.code).toBe('MALFORMED_JSON');
  });

  it('rejects a top-level scalar or empty array', () => {
    const result = parseJson(encode('42'));
    expect(result.rejection?.code).toBe('WRONG_TOP_LEVEL_SHAPE');

    const result2 = parseJson(encode('[]'));
    expect(result2.rejection?.code).toBe('WRONG_TOP_LEVEL_SHAPE');
  });

  it('rejects an empty file', () => {
    const result = parseJson(encode(''));
    expect(result.rejection?.code).toBe('EMPTY_FILE');
  });

  it('stringifies nested values as JSON for downstream metadata mapping', () => {
    const json = JSON.stringify([{ tags: ['a', 'b'], data: { x: 1 } }]);
    const result = parseJson(encode(json));
    expect(result.table?.rows[0]?.[0]).toBe('["a","b"]');
    expect(result.table?.rows[0]?.[1]).toBe('{"x":1}');
  });
});
