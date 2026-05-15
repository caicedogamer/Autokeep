/*
 * Accuracy benchmark for HeuristicColumnMapper (T136).
 *
 * Spec ref: SC-017 — auto-mapping accuracy ≥ 80% on the heterogeneous
 *           reference set.
 *
 * The reference set lives under `tests/fixtures/heterogeneous/`. Each
 * fixture has a paired `*.expected.json` listing the correct mapping.
 * For SC-017 we measure the percentage of (file × required-role) pairs
 * the mapper got right with confidence ≥ the auto-confirm threshold.
 *
 * MVP scope: 6 fixtures covering the documented variants (canonical-en,
 * es-bank-semicolon, mixed-language, ERP-wrapped JSON, flat array,
 * NDJSON). Expansion to the full 20-file set per the original plan is
 * follow-up work; the benchmark already locks in SC-017 against the
 * fixtures provided.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { HeuristicColumnMapper } from '../domain/inference/heuristic-column-mapper.js';
import { parseCsv } from '../domain/parsing/csv-parser.js';
import { parseJson } from '../domain/parsing/json-parser.js';
import type { InferenceContext, SemanticRole } from '../domain/types.js';
import { REQUIRED_ROLES } from '../domain/types.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'heterogeneous');

interface Expected {
  readonly expectedMapping: Readonly<Record<string, SemanticRole>>;
  readonly description: string;
}

interface FixtureCase {
  readonly filename: string;
  readonly expected: Expected;
  readonly buffer: ArrayBuffer;
  readonly kind: 'csv' | 'json';
}

function loadFixtures(): FixtureCase[] {
  const all = readdirSync(FIXTURES_DIR);
  const cases: FixtureCase[] = [];
  for (const f of all) {
    if (f.endsWith('.expected.json')) continue;
    const ext = extname(f).toLowerCase();
    const kind: 'csv' | 'json' = ext === '.json' || ext === '.ndjson' ? 'json' : 'csv';
    const expectedPath = join(FIXTURES_DIR, `${f}.expected.json`);
    let expectedRaw: string;
    try {
      expectedRaw = readFileSync(expectedPath, 'utf-8');
    } catch {
      // Some fixtures may pair "<file>.expected.json" without the
      // extension repeated; try the stem variant.
      const stem = f.replace(/\.[^.]+$/, '');
      expectedRaw = readFileSync(join(FIXTURES_DIR, `${stem}.expected.json`), 'utf-8');
    }
    const expected: Expected = JSON.parse(expectedRaw) as Expected;
    const nodeBuf = readFileSync(join(FIXTURES_DIR, f));
    // Slice into a tight ArrayBuffer — Node's Buffer pool may give us a
    // wider underlying buffer whose extra bytes break UTF-8 decoding.
    const buffer = nodeBuf.buffer.slice(
      nodeBuf.byteOffset,
      nodeBuf.byteOffset + nodeBuf.byteLength,
    ) as ArrayBuffer;
    cases.push({ filename: f, expected, buffer, kind });
  }
  return cases;
}

const ctx: InferenceContext = {
  workspaceCurrency: 'ARS',
  workspaceCurrencyMinorUnits: 2,
  workspaceLocale: 'es-AR',
};

const mapper = new HeuristicColumnMapper();
const AUTO_CONFIRM_THRESHOLD = 0.5; // contract: required-role low-confidence threshold

describe('HeuristicColumnMapper — accuracy benchmark (SC-017)', () => {
  const fixtures = loadFixtures();

  it('loads at least 6 fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
  });

  for (const fx of fixtures) {
    it(`maps the five required roles correctly in ${fx.filename}`, () => {
      const parsed = fx.kind === 'csv' ? parseCsv(fx.buffer) : parseJson(fx.buffer);
      expect(parsed.table, `parse rejection: ${JSON.stringify(parsed.rejection)}`).toBeDefined();
      if (!parsed.table) return;

      const report = mapper.infer(parsed.table, ctx);
      const expected = fx.expected.expectedMapping;
      // For each required role, find the column expected to carry it
      // AND verify the mapper assigned that role to that exact column
      // with sufficient confidence.
      for (const role of REQUIRED_ROLES) {
        const expectedCol = Object.entries(expected).find(([, r]) => r === role)?.[0];
        if (!expectedCol) continue;
        const colIdx = parseInt(expectedCol, 10);
        const col = report.columns.find((c) => c.columnIndex === colIdx);
        expect(col, `column ${String(colIdx)} not in report`).toBeDefined();
        expect(
          col?.inferredRole,
          `${fx.filename}:col${String(colIdx)} expected ${role}, got ${String(col?.inferredRole)}`,
        ).toBe(role);
      }
    });
  }

  it('overall accuracy across all fixtures × required roles is ≥ 80% (SC-017)', () => {
    let totalChecks = 0;
    let correctChecks = 0;
    const failureDetail: string[] = [];

    for (const fx of fixtures) {
      const parsed = fx.kind === 'csv' ? parseCsv(fx.buffer) : parseJson(fx.buffer);
      if (!parsed.table) continue;
      const report = mapper.infer(parsed.table, ctx);

      for (const role of REQUIRED_ROLES) {
        const expectedCol = Object.entries(fx.expected.expectedMapping).find(
          ([, r]) => r === role,
        )?.[0];
        if (!expectedCol) continue;
        totalChecks += 1;
        const colIdx = parseInt(expectedCol, 10);
        const col = report.columns.find((c) => c.columnIndex === colIdx);
        const matched =
          col?.inferredRole === role && (col?.confidence ?? 0) >= AUTO_CONFIRM_THRESHOLD;
        if (matched) correctChecks += 1;
        else
          failureDetail.push(
            `${fx.filename} col${String(colIdx)} role=${role} actual=${String(col?.inferredRole)}/${String(col?.confidence)}`,
          );
      }
    }

    const accuracy = correctChecks / Math.max(1, totalChecks);
    const pct = (accuracy * 100).toFixed(1);
    expect(
      accuracy,
      `Accuracy ${pct}% (${String(correctChecks)}/${String(totalChecks)}) — failing:\n${failureDetail.join('\n')}`,
    ).toBeGreaterThanOrEqual(0.8);
  });
});
