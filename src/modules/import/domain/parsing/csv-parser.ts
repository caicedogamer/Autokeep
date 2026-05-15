/*
 * CSV parser (Stage 1) — flexible import pipeline.
 *
 * Spec refs:
 *   - contracts/import-csv.schema.md §Stage 1 (Parsing)
 *   - research.md R16 (delimiter auto-detect via PapaParse)
 *
 * Input: a raw `ArrayBuffer` containing CSV bytes.
 * Output: `RawTable` with auto-detected delimiter / line-ending / encoding,
 *         OR a `ParserRejection` when the file is structurally unreadable.
 *
 * Pure function — no I/O. Runs in the import worker or on the main
 * thread (Principle II + V). PapaParse is invoked synchronously here;
 * for very large files the worker hosts the parser.
 */

import Papa from 'papaparse';

import type { ParserRejection, RawTable } from '../types.js';

const BOM_UTF8 = '﻿';

/**
 * Decode the buffer as UTF-8 (preferred) or UTF-16 with BOM.
 * Returns the decoded text + the resolved encoding tag.
 */
function decode(
  buffer: ArrayBuffer,
): { text: string; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' } | null {
  const bytes = new Uint8Array(buffer);

  // UTF-16 BOM detection
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

  // UTF-8 (with or without BOM)
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.startsWith(BOM_UTF8)) text = text.slice(1);
    return { text, encoding: 'utf-8' };
  } catch {
    return null;
  }
}

function detectLineEnding(text: string): '\r\n' | '\n' | '\r' {
  // Sample the first ~2 KB for a line break.
  const head = text.slice(0, 2048);
  if (head.includes('\r\n')) return '\r\n';
  if (head.includes('\n')) return '\n';
  if (head.includes('\r')) return '\r';
  return '\n';
}

/**
 * Heuristic for synthetic header: when ≥ 60% of cells in the first row
 * "look like data" (numeric or date-like), treat row 1 as data and
 * synthesize headers `col_1`, `col_2`, ...
 */
function looksLikeData(cell: string): boolean {
  const trimmed = cell.trim();
  if (trimmed === '') return false;
  if (/^-?\d+([.,]\d+)?$/.test(trimmed)) return true; // number
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return true; // ISO date
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(trimmed)) return true; // DD/MM or MM/DD
  return false;
}

function shouldSynthesizeHeader(firstRow: readonly string[]): boolean {
  if (firstRow.length === 0) return false;
  const dataLike = firstRow.filter(looksLikeData).length;
  return dataLike / firstRow.length >= 0.6;
}

function synthesizeHeaders(columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, i) => `col_${String(i + 1)}`);
}

export interface CsvParseResult {
  readonly table?: RawTable;
  readonly rejection?: ParserRejection;
}

export function parseCsv(buffer: ArrayBuffer): CsvParseResult {
  // Empty buffer
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

  // PapaParse with delimiter auto-detect.
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    delimiter: '', // auto-detect: comma / semicolon / tab / pipe
  });

  // PapaParse reports unrecoverable structural errors as 'Quotes' /
  // 'Delimiter' / 'FieldMismatch'. We treat any reported error with
  // type === 'Quotes' or 'Delimiter' as malformed.
  const fatalError = parsed.errors.find((e) => e.type === 'Quotes' || e.type === 'Delimiter');
  if (fatalError) {
    return { rejection: { code: 'MALFORMED_CSV', detail: fatalError.message } };
  }

  const data = parsed.data.filter((row) => row.length > 0);
  if (data.length === 0) {
    return { rejection: { code: 'EMPTY_FILE' } };
  }

  const delimiter = (parsed.meta.delimiter as ',' | ';' | '\t' | '|') ?? ',';
  const lineEnding = detectLineEnding(text);

  const firstRow = data[0] ?? [];
  const synthesized = shouldSynthesizeHeader(firstRow);

  const headers: string[] = synthesized
    ? synthesizeHeaders(firstRow.length)
    : firstRow.map((h) => h.trim());
  const rawRows = synthesized ? data : data.slice(1);

  // Normalize row widths: pad short rows with '' to match headers length;
  // truncate long rows to headers length (extras would have been an
  // EXTRA_FIELDS error in v1 — in v2 they're tolerated per the contract).
  const width = headers.length;
  const rows: string[][] = rawRows.map((row) => {
    if (row.length === width) return row.slice();
    if (row.length < width) {
      const padded = row.slice();
      while (padded.length < width) padded.push('');
      return padded;
    }
    return row.slice(0, width);
  });

  const table: RawTable = {
    headers,
    rows,
    meta: {
      sourceKind: 'csv',
      delimiter,
      lineEnding,
      headerSynthesized: synthesized,
      encoding: decoded.encoding,
    },
  };

  return { table };
}
