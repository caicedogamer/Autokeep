/*
 * JSON parser (Stage 1) — flexible import pipeline.
 *
 * Spec refs:
 *   - contracts/import-json.schema.md §Stage 1 (Parsing)
 *   - research.md R17 (three accepted JSON shapes)
 *
 * Accepts three top-level structures (in priority order):
 *   1. Array of objects:  [{...}, {...}]
 *   2. Wrapped:           { records: [...], data: [...], transactions: [...], ... }
 *   3. NDJSON:            one JSON object per line.
 *
 * Output: RawTable with the union of object keys as headers and every
 * cell stringified. Non-string scalars are coerced to canonical strings
 * (numbers via .toString(), booleans as 'true'/'false', null as '').
 * Nested objects/arrays are JSON-serialized into a single string cell.
 *
 * Pure function — no I/O.
 */

import type { ParserRejection, RawTable } from '../types.js';

const WRAPPER_KEY_CANDIDATES = [
  'records',
  'data',
  'transactions',
  'items',
  'movements',
  'rows',
  'entries',
  'list',
  'payload',
  'results',
] as const;

const BOM_UTF8 = '﻿';

function decode(
  buffer: ArrayBuffer,
): { text: string; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' } | null {
  const bytes = new Uint8Array(buffer);

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    try {
      return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
    } catch {
      return null;
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
    } catch {
      return null;
    }
  }

  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.startsWith(BOM_UTF8)) text = text.slice(1);
    return { text, encoding: 'utf-8' };
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayOfObjects(value: unknown): value is ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

function tryParseNdjson(text: string): ReadonlyArray<Record<string, unknown>> | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isPlainObject(parsed)) return null;
      out.push(parsed);
    } catch {
      return null;
    }
  }
  return out;
}

function stringifyCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // Object / array — JSON-encode so it survives inference (will likely
  // land under role 'metadata').
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function nativeTypeOf(value: unknown): 'string' | 'number' | 'boolean' | 'null' | 'mixed' {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'mixed';
}

export interface JsonParseResult {
  readonly table?: RawTable;
  readonly rejection?: ParserRejection;
}

interface ShapeMatch {
  readonly shape: 'array' | 'wrapped' | 'ndjson';
  readonly wrapperKey?: string;
  readonly wrapperFields?: readonly string[];
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

function detectShape(text: string): ShapeMatch | null {
  // Try strict JSON.parse first.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (parsed !== undefined) {
    // Array of objects?
    if (isArrayOfObjects(parsed)) {
      return { shape: 'array', rows: parsed };
    }

    // Wrapped?
    if (isPlainObject(parsed)) {
      for (const key of WRAPPER_KEY_CANDIDATES) {
        const candidate = parsed[key];
        if (isArrayOfObjects(candidate)) {
          const wrapperFields = Object.keys(parsed).filter((k) => k !== key);
          return { shape: 'wrapped', wrapperKey: key, wrapperFields, rows: candidate };
        }
      }
      // No canonical wrapper key — try ANY array-of-objects field as a
      // last resort.
      for (const [key, value] of Object.entries(parsed)) {
        if (isArrayOfObjects(value)) {
          const wrapperFields = Object.keys(parsed).filter((k) => k !== key);
          return { shape: 'wrapped', wrapperKey: key, wrapperFields, rows: value };
        }
      }
    }
  }

  // NDJSON fallback
  const ndjson = tryParseNdjson(text);
  if (ndjson) {
    return { shape: 'ndjson', rows: ndjson };
  }

  return null;
}

export function parseJson(buffer: ArrayBuffer): JsonParseResult {
  if (buffer.byteLength === 0) {
    return { rejection: { code: 'EMPTY_FILE' } };
  }

  const decoded = decode(buffer);
  if (!decoded) {
    return { rejection: { code: 'ENCODING_NOT_UTF8' } };
  }

  const text = decoded.text;
  if (!text.trim()) {
    return { rejection: { code: 'EMPTY_FILE' } };
  }

  // First check parseability at all.
  let strictlyParseable = true;
  try {
    JSON.parse(text);
  } catch {
    strictlyParseable = false;
  }

  const shape = detectShape(text);
  if (!shape) {
    return {
      rejection: {
        code: strictlyParseable ? 'WRONG_TOP_LEVEL_SHAPE' : 'MALFORMED_JSON',
      },
    };
  }

  // Build union-of-keys headers (stable: insertion order across rows).
  const headerSet = new Map<string, number>(); // key → first-seen-index
  let nextIdx = 0;
  for (const row of shape.rows) {
    for (const key of Object.keys(row)) {
      if (!headerSet.has(key)) {
        headerSet.set(key, nextIdx);
        nextIdx += 1;
      }
    }
  }
  const headers = Array.from(headerSet.keys());

  // Build rows table (stringified cells). Also collect native types
  // per column for the inferrer.
  const nativeTypesPerCol: Array<Set<'string' | 'number' | 'boolean' | 'null' | 'mixed'>> =
    headers.map(() => new Set());

  const rows: string[][] = shape.rows.map((rec) => {
    return headers.map((key, colIdx) => {
      const raw = rec[key];
      nativeTypesPerCol[colIdx]?.add(nativeTypeOf(raw));
      return stringifyCell(raw);
    });
  });

  // Reduce per-column type sets to a single label.
  const nativeTypes: ReadonlyArray<'string' | 'number' | 'boolean' | 'null' | 'mixed'> =
    nativeTypesPerCol.map((set) => {
      // Treat 'null' as "missing" — only count non-null.
      const nonNull = new Set(set);
      nonNull.delete('null');
      if (nonNull.size === 0) return 'null';
      if (nonNull.size === 1) {
        const only = nonNull.values().next().value;
        return only ?? 'mixed';
      }
      return 'mixed';
    });

  const table: RawTable = {
    headers,
    rows,
    meta: {
      sourceKind: 'json',
      jsonShape: shape.shape,
      encoding: decoded.encoding,
      nativeTypes,
      ...(shape.wrapperKey !== undefined ? { wrapperKey: shape.wrapperKey } : {}),
      ...(shape.wrapperFields !== undefined ? { wrapperFields: shape.wrapperFields } : {}),
    },
  };

  return { table };
}
