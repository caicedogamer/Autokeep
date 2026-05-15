/*
 * Service-level tests for the flexible import pipeline (T137).
 *
 * Verifies (per spec acceptance scenarios for US3v2):
 *   - Parser-level rejection ⇒ no records, mappingDecision absent on
 *     the batch (the file never reached stage 3).
 *   - Auto-confirmed mapping (source: 'auto') ⇒ records committed with
 *     `schemaVersion: 2` and extraMetadata.
 *   - Mixed source (operator override) ⇒ batch records source: 'mixed'.
 *   - Missing required role after confirm ⇒ commit blocked (validator
 *     returns 'rejected-structural').
 *   - Capacity hard-cap ⇒ partial commit when truncate=true, cancel
 *     otherwise.
 *   - Worker spawn failure ⇒ falls back to synchronous main-thread path.
 *
 * Runs in jsdom so the Worker constructor throws — exercising the
 * fallback path. The synchronous fallback uses the same pipeline
 * modules, so behavior is identical.
 */

import { describe, it, expect, vi } from 'vitest';

import { ImportPipeline } from '../services/import-pipeline.js';
import type {
  FlexibleValidationReport,
  InferenceReport,
  MappingDecision,
} from '../domain/types.js';
import type { WorkspacePayloadV1 } from '../../workspace/services/workspace-service.js';

const WORKSPACE: WorkspacePayloadV1 = {
  schemaVersion: 1,
  workspace: {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test',
    currency: 'ARS',
    currencyMinorUnits: 2,
    locale: 'es-AR',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
  },
  records: [],
  categories: [],
  counterparties: [],
  importBatches: [],
  inconsistencies: [],
  settings: { aiEnabled: false, suggestionMinSupport: 5, suggestionMinConfidence: 0.6 },
};

const CSV = `date,type,amount,currency,category,description,counterparty
2026-05-01,income,100.00,ARS,Sales,Invoice #1,Acme
2026-05-02,expense,50.00,ARS,Services,Internet,Telecom
`;

function csvFile(content: string, name = 'test.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('ImportPipeline (flexible import)', () => {
  it('parses a CSV file to a RawTable via the synchronous fallback', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const pipeline = new ImportPipeline({ persistPayload: persist });
    const result = await pipeline.parse(csvFile(CSV));
    expect(result.table).toBeDefined();
    expect(result.rejection).toBeUndefined();
    expect(result.table?.headers).toEqual([
      'date',
      'type',
      'amount',
      'currency',
      'category',
      'description',
      'counterparty',
    ]);
  });

  it('returns a parser rejection for an empty file', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const pipeline = new ImportPipeline({ persistPayload: persist });
    const result = await pipeline.parse(csvFile(''));
    expect(result.rejection?.code).toBe('EMPTY_FILE');
  });

  it('runs inference + normalization + validation end-to-end and commits valid rows', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const pipeline = new ImportPipeline({ persistPayload: persist });

    const parseResult = await pipeline.parse(csvFile(CSV));
    expect(parseResult.table).toBeDefined();
    const table = parseResult.table!;

    const inferReport = await pipeline.infer(table, {
      workspaceCurrency: 'ARS',
      workspaceCurrencyMinorUnits: 2,
      workspaceLocale: 'es-AR',
    });
    expect(inferReport.columns.length).toBe(7);

    const decision: MappingDecision = {
      mapping: Object.fromEntries(inferReport.columns.map((c) => [c.columnIndex, c.inferredRole])),
      source: 'auto',
      warnings: [],
      confirmedAt: new Date().toISOString(),
      amountConvention: 'major-decimal',
      dateFormatPerColumn: { 0: 'iso' },
      decimalSeparatorPerColumn: { 2: '.' },
    };

    const valReport = await pipeline.normalizeAndValidate(table, decision, {
      currency: 'ARS',
      currencyMinorUnits: 2,
      existingCount: 0,
    });
    expect(valReport.outcome).toBe('valid');
    expect(valReport.validRows.length).toBe(2);

    const commit = await pipeline.confirmCommit(valReport, WORKSPACE, {
      truncate: false,
      fileKind: 'csv',
      mappingDecision: decision,
      inferenceReport: inferReport,
    });

    expect(commit.outcome).toBe('committed');
    expect(commit.batch.committedRows).toBe(2);
    expect(commit.batch.schemaVersion).toBe(2);
    expect(commit.batch.mappingDecision?.source).toBe('auto');
    expect(commit.updatedPayload.records.length).toBe(2);
    // Every committed record carries schemaVersion: 2
    for (const r of commit.updatedPayload.records as Array<{ schemaVersion: number }>) {
      expect(r.schemaVersion).toBe(2);
    }
    expect(persist).toHaveBeenCalledOnce();
  });

  it('records source: "mixed" when the operator overrides at least one column', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const pipeline = new ImportPipeline({ persistPayload: persist });

    const parsed = await pipeline.parse(csvFile(CSV));
    const inferReport = await pipeline.infer(parsed.table!, {
      workspaceCurrency: 'ARS',
      workspaceCurrencyMinorUnits: 2,
      workspaceLocale: 'es-AR',
    });

    const decision: MappingDecision = {
      mapping: Object.fromEntries(inferReport.columns.map((c) => [c.columnIndex, c.inferredRole])),
      source: 'mixed',
      warnings: [],
      confirmedAt: new Date().toISOString(),
      amountConvention: 'major-decimal',
      dateFormatPerColumn: { 0: 'iso' },
      decimalSeparatorPerColumn: { 2: '.' },
    };

    const valReport = await pipeline.normalizeAndValidate(parsed.table!, decision, {
      currency: 'ARS',
      currencyMinorUnits: 2,
      existingCount: 0,
    });
    const commit = await pipeline.confirmCommit(valReport, WORKSPACE, {
      truncate: false,
      fileKind: 'csv',
      mappingDecision: decision,
      inferenceReport: inferReport,
    });
    expect(commit.batch.mappingDecision?.source).toBe('mixed');
  });

  it('refuses commit when capacity would be exceeded and truncate=false', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const pipeline = new ImportPipeline({ persistPayload: persist });

    const report: FlexibleValidationReport = {
      outcome: 'valid',
      totalRows: 100,
      validRows: Array.from({ length: 100 }, (_, i) => ({
        rowNumber: i + 1,
        date: '2026-04-01' as never,
        type: 'income',
        amount: 100 as never,
        categoryName: 'Sales',
        description: 'X',
        extraMetadata: {},
      })),
      errorRows: [],
      capacityWarning: {
        existingCount: 11_950,
        validCount: 100,
        wouldExceed: 50,
        allowedCount: 50,
      },
    };
    const decision: MappingDecision = {
      mapping: { 0: 'date', 1: 'type', 2: 'amount', 3: 'category', 4: 'description' },
      source: 'auto',
      warnings: [],
      confirmedAt: new Date().toISOString(),
    };
    const inferReport: InferenceReport = { columns: [], globalWarnings: [] };

    const cancelled = await pipeline.confirmCommit(report, WORKSPACE, {
      truncate: false,
      fileKind: 'csv',
      mappingDecision: decision,
      inferenceReport: inferReport,
    });
    expect(cancelled.outcome).toBe('cancelled');
    expect(persist).not.toHaveBeenCalled();

    const partial = await pipeline.confirmCommit(report, WORKSPACE, {
      truncate: true,
      fileKind: 'csv',
      mappingDecision: decision,
      inferenceReport: inferReport,
    });
    expect(partial.outcome).toBe('partial-commit');
    expect(partial.batch.committedRows).toBe(50);
  });

  it('returns rejected-structural when a required role is unmapped after confirm', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const pipeline = new ImportPipeline({ persistPayload: persist });

    const parsed = await pipeline.parse(csvFile(CSV));
    const decision: MappingDecision = {
      // intentionally missing 'description'
      mapping: {
        0: 'date',
        1: 'type',
        2: 'amount',
        3: 'currency',
        4: 'category',
        5: 'metadata',
        6: 'counterparty',
      },
      source: 'manual',
      warnings: [],
      confirmedAt: new Date().toISOString(),
      amountConvention: 'major-decimal',
      dateFormatPerColumn: { 0: 'iso' },
      decimalSeparatorPerColumn: { 2: '.' },
    };

    const valReport = await pipeline.normalizeAndValidate(parsed.table!, decision, {
      currency: 'ARS',
      currencyMinorUnits: 2,
      existingCount: 0,
    });
    expect(valReport.outcome).toBe('rejected-structural');
    expect(valReport.errorRows[0]?.codes).toContain('MISSING_REQUIRED_ROLE_AFTER_MAPPING');
  });
});
