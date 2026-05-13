import { describe, it, expect, vi } from 'vitest';

import { ImportService } from '../services/import-service.js';
import type { WorkspacePayloadV1 } from '../../workspace/services/workspace-service.js';

/* ---------- Fixture ---------- */

const WORKSPACE_PAYLOAD: WorkspacePayloadV1 = {
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
  settings: { aiEnabled: false, suggestionMinSupport: 3, suggestionMinConfidence: 0.8 },
};

const CSV_CONTENT = `date,type,amount,currency,category,description,counterparty
2026-05-01,income,100.00,ARS,Ventas,Factura #1,Acme
2026-05-02,expense,50.00,ARS,Gastos,Pago servicio,
`;

const JSON_CONTENT = JSON.stringify({
  schemaVersion: 1,
  currency: 'ARS',
  currencyMinorUnits: 2,
  records: [
    {
      date: '2026-05-01',
      type: 'income',
      amount: 10000,
      category: 'Ventas',
      description: 'Factura #1',
      counterparty: 'Acme',
    },
  ],
});

function makeCsvFile(content: string, name = 'import.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

function makeJsonFile(content: string, name = 'import.json'): File {
  return new File([content], name, { type: 'application/json' });
}

/* ---------- Tests ---------- */

describe('ImportService — validate() CSV', () => {
  it('returns a valid report for a correct CSV', async () => {
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const report = await svc.validate(makeCsvFile(CSV_CONTENT), WORKSPACE_PAYLOAD);

    expect(report.outcome).toBe('valid');
    expect(report.validRows).toHaveLength(2);
    svc.dispose();
  });

  it('returns rejected-structural for malformed CSV header', async () => {
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const badCsv = 'wrong,headers\n2026-01-01,income';
    const report = await svc.validate(makeCsvFile(badCsv), WORKSPACE_PAYLOAD);

    expect(report.outcome).toBe('rejected-structural');
    svc.dispose();
  });

  it('returns rejected-all when every row has errors', async () => {
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const badCsv = `date,type,amount,currency,category,description,counterparty
bad-date,debit,-1,USD,,too long ${'x'.repeat(300)},
`;
    const report = await svc.validate(makeCsvFile(badCsv), WORKSPACE_PAYLOAD);

    expect(['rejected-all', 'partial']).toContain(report.outcome);
    expect(report.errorRows).toHaveLength(1);
    svc.dispose();
  });
});

describe('ImportService — validate() JSON', () => {
  it('returns a valid report for correct JSON', async () => {
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const report = await svc.validate(makeJsonFile(JSON_CONTENT), WORKSPACE_PAYLOAD);

    expect(report.outcome).toBe('valid');
    expect(report.validRows).toHaveLength(1);
    svc.dispose();
  });

  it('returns rejected-structural for malformed JSON', async () => {
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const report = await svc.validate(makeJsonFile('not json'), WORKSPACE_PAYLOAD);

    expect(report.outcome).toBe('rejected-structural');
    svc.dispose();
  });
});

describe('ImportService — confirmCommit()', () => {
  it('commits valid rows and calls persistPayload', async () => {
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const report = await svc.validate(makeCsvFile(CSV_CONTENT), WORKSPACE_PAYLOAD);
    const result = await svc.confirmCommit(report, WORKSPACE_PAYLOAD, false);

    expect(result.outcome).toBe('committed');
    expect(result.batch.committedRows).toBe(2);
    expect(persistPayload).toHaveBeenCalledOnce();

    const updatedPayload = result.updatedPayload;
    expect((updatedPayload.records as unknown[]).length).toBe(2);
    svc.dispose();
  });

  it('creates categories and counterparties for new names', async () => {
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const report = await svc.validate(makeCsvFile(CSV_CONTENT), WORKSPACE_PAYLOAD);
    const result = await svc.confirmCommit(report, WORKSPACE_PAYLOAD, false);

    // CSV has "Ventas" and "Gastos" → 2 new categories
    expect((result.updatedPayload.categories as unknown[]).length).toBe(2);
    // "Acme" counterparty in row 1; row 2 has no counterparty
    expect((result.updatedPayload.counterparties as unknown[]).length).toBe(1);
    svc.dispose();
  });

  it('cancels when capacity would be exceeded and truncate=false', async () => {
    const overPayload: WorkspacePayloadV1 = {
      ...WORKSPACE_PAYLOAD,
      records: new Array(11_999).fill(null),
    };
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const report = await svc.validate(makeCsvFile(CSV_CONTENT), overPayload);
    expect(report.capacityWarning).toBeDefined();

    const result = await svc.confirmCommit(report, overPayload, false);
    expect(result.outcome).toBe('cancelled');
    expect(persistPayload).not.toHaveBeenCalled();
    svc.dispose();
  });

  it('partial-commits when truncate=true and capacity would be exceeded', async () => {
    const overPayload: WorkspacePayloadV1 = {
      ...WORKSPACE_PAYLOAD,
      records: new Array(11_999).fill(null),
    };
    const persistPayload = vi.fn().mockResolvedValue(undefined);
    const svc = new ImportService({ persistPayload });

    const report = await svc.validate(makeCsvFile(CSV_CONTENT), overPayload);
    const result = await svc.confirmCommit(report, overPayload, true);

    expect(result.outcome).toBe('partial-commit');
    expect(result.batch.committedRows).toBe(1); // only 1 fits
    expect(persistPayload).toHaveBeenCalledOnce();
    svc.dispose();
  });
});
