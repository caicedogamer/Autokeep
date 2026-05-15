/*
 * Pure tests for the normalizer (T131 / T135).
 *
 * Verifies role routing, metadata preservation (incl. `meta:` prefix
 * stripping for export round-trip), and stripping of empty trimmed cells.
 */

import { describe, it, expect } from 'vitest';

import { normalize } from '../domain/normalization/normalizer.js';
import type { MappingDecision, RawTable } from '../domain/types.js';

const decision: MappingDecision = {
  mapping: {
    0: 'date',
    1: 'type',
    2: 'amount',
    3: 'category',
    4: 'description',
    5: 'metadata',
  },
  source: 'auto',
  warnings: [],
  confirmedAt: '2026-05-12T00:00:00Z',
};

function table(rows: string[][]): RawTable {
  return {
    headers: ['date', 'type', 'amount', 'category', 'description', 'internalId'],
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

describe('normalize', () => {
  it('routes cells to semantic-role slots without coercion', () => {
    const result = normalize(
      table([
        ['2026-04-01', 'income', '150.00', 'Sales', 'Invoice A', 'INV-1'],
        ['2026-04-02', 'expense', '40.50', 'Services', 'Internet', 'INV-2'],
      ]),
      decision,
    );
    expect(result.length).toBe(2);
    expect(result[0]?.date).toBe('2026-04-01');
    expect(result[0]?.type).toBe('income');
    expect(result[0]?.amount).toBe('150.00');
    expect(result[0]?.category).toBe('Sales');
    expect(result[0]?.description).toBe('Invoice A');
    expect(result[0]?.extraMetadata['internalId']).toBe('INV-1');
  });

  it('treats trimmed empty cells as null', () => {
    const result = normalize(table([['   ', 'income', '100', 'X', 'desc', '   ']]), decision);
    expect(result[0]?.date).toBeNull();
    expect(Object.keys(result[0]?.extraMetadata ?? {})).toHaveLength(0);
  });

  it("strips the 'meta:' prefix for export round-trip", () => {
    const t: RawTable = {
      headers: ['date', 'type', 'amount', 'category', 'description', 'meta:internalId'],
      rows: [['2026-04-01', 'income', '100', 'X', 'desc', 'INV-1']],
      meta: {
        sourceKind: 'csv',
        delimiter: ',',
        lineEnding: '\n',
        headerSynthesized: false,
        encoding: 'utf-8',
      },
    };
    const d: MappingDecision = {
      mapping: {
        0: 'date',
        1: 'type',
        2: 'amount',
        3: 'category',
        4: 'description',
        5: 'metadata',
      },
      source: 'auto',
      warnings: [],
      confirmedAt: '2026-05-12T00:00:00Z',
    };
    const result = normalize(t, d);
    expect(result[0]?.extraMetadata['internalId']).toBe('INV-1');
    expect(result[0]?.extraMetadata['meta:internalId']).toBeUndefined();
  });

  it('drops columns marked as ignore', () => {
    const t: RawTable = {
      headers: ['date', 'type', 'amount', 'category', 'description', 'balance'],
      rows: [['2026-04-01', 'income', '100', 'X', 'desc', '5000']],
      meta: {
        sourceKind: 'csv',
        delimiter: ',',
        lineEnding: '\n',
        headerSynthesized: false,
        encoding: 'utf-8',
      },
    };
    const d: MappingDecision = {
      mapping: {
        0: 'date',
        1: 'type',
        2: 'amount',
        3: 'category',
        4: 'description',
        5: 'ignore',
      },
      source: 'auto',
      warnings: [],
      confirmedAt: '2026-05-12T00:00:00Z',
    };
    const result = normalize(t, d);
    expect(Object.keys(result[0]?.extraMetadata ?? {})).toHaveLength(0);
  });
});
