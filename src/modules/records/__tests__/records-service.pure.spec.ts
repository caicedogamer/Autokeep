import { describe, it, expect } from 'vitest';

import {
  RecordsService,
  RecordNotFoundError,
  RecordConflictError,
} from '../services/records-service.js';
import { CapacityExceededError } from '../../workspace/services/capacity-gate.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../domain/types.js';
import type { WorkspacePayloadV1 } from '../../workspace/services/workspace-service.js';
import type { FinancialRecord, NewRecordInput } from '../domain/types.js';

/* ---------- Fixtures ---------- */

const makePayload = (records: FinancialRecord[] = []): WorkspacePayloadV1 => ({
  schemaVersion: 1,
  workspace: {
    id: toId('00000000-0000-0000-0000-000000000001'),
    name: 'Test',
    currency: 'ARS',
    currencyMinorUnits: 2,
    locale: 'es-AR',
    createdAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
    updatedAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
    schemaVersion: 1,
  },
  records,
  categories: [],
  counterparties: [],
  importBatches: [],
  inconsistencies: [],
  settings: { aiEnabled: true, suggestionMinSupport: 5, suggestionMinConfidence: 0.6 },
});

const makeInput = (overrides: Partial<NewRecordInput> = {}): NewRecordInput => ({
  date: toIsoDate('2026-05-01'),
  type: 'income',
  amount: toMoneyMinor(1000),
  categoryId: toId('00000000-0000-0000-0000-000000000002'),
  description: 'Venta',
  ...overrides,
});

const svc = new RecordsService();

/* ---------- create ---------- */

describe('RecordsService.create', () => {
  it('adds a record with version=1 and source=manual', () => {
    const payload = makePayload();
    const next = svc.create(payload, makeInput());
    expect(next.records).toHaveLength(1);
    const r = next.records[0] as FinancialRecord;
    expect(r.version).toBe(1);
    expect(r.source).toBe('manual');
    expect(r.schemaVersion).toBe(1);
  });

  it('trims description whitespace', () => {
    const payload = makePayload();
    const next = svc.create(payload, makeInput({ description: '  Venta  ' }));
    const r = next.records[0] as FinancialRecord;
    expect(r.description).toBe('Venta');
  });

  it('throws CapacityExceededError when hard cap is reached', () => {
    const records = Array.from({ length: 12_000 }, (_, i) => ({
      id: toId(`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`),
      date: toIsoDate('2026-01-01'),
      type: 'income' as const,
      amount: toMoneyMinor(100),
      categoryId: toId('00000000-0000-0000-0000-000000000002'),
      description: 'x',
      source: 'manual' as const,
      version: 1,
      createdAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
      updatedAt: toIsoDateTime('2026-01-01T00:00:00.000Z'),
      schemaVersion: 1 as const,
    }));
    const payload = makePayload(records);
    expect(() => svc.create(payload, makeInput())).toThrow(CapacityExceededError);
  });
});

/* ---------- update ---------- */

describe('RecordsService.update', () => {
  it('increments version on successful update', () => {
    const payload = makePayload();
    const p1 = svc.create(payload, makeInput());
    const r = p1.records[0] as FinancialRecord;
    const p2 = svc.update(p1, { id: r.id, version: 1, description: 'Updated' });
    const updated = (p2.records as FinancialRecord[]).find((x) => x.id === r.id)!;
    expect(updated.version).toBe(2);
    expect(updated.description).toBe('Updated');
  });

  it('throws RecordConflictError on version mismatch (FR-036)', () => {
    const payload = makePayload();
    const p1 = svc.create(payload, makeInput());
    const r = p1.records[0] as FinancialRecord;
    expect(() => svc.update(p1, { id: r.id, version: 99, description: 'Stale' })).toThrow(
      RecordConflictError,
    );
  });

  it('throws RecordNotFoundError for unknown id', () => {
    expect(() =>
      svc.update(makePayload(), {
        id: toId('ffffffff-ffff-ffff-ffff-ffffffffffff'),
        version: 1,
      }),
    ).toThrow(RecordNotFoundError);
  });

  it('removes counterpartyId when null passed', () => {
    const payload = makePayload();
    const p1 = svc.create(
      payload,
      makeInput({ counterpartyId: toId('00000000-0000-0000-0000-000000000003') }),
    );
    const r = p1.records[0] as FinancialRecord;
    const p2 = svc.update(p1, { id: r.id, version: 1, counterpartyId: null });
    const updated = (p2.records as FinancialRecord[]).find((x) => x.id === r.id)!;
    expect(updated.counterpartyId).toBeUndefined();
  });
});

/* ---------- delete ---------- */

describe('RecordsService.delete', () => {
  it('removes the record from the payload', () => {
    const payload = makePayload();
    const p1 = svc.create(payload, makeInput());
    const r = p1.records[0] as FinancialRecord;
    const p2 = svc.delete(p1, r.id);
    expect(p2.records).toHaveLength(0);
  });

  it('throws RecordNotFoundError for unknown id', () => {
    expect(() => svc.delete(makePayload(), toId('ffffffff-ffff-ffff-ffff-ffffffffffff'))).toThrow(
      RecordNotFoundError,
    );
  });
});

/* ---------- list ---------- */

describe('RecordsService.list', () => {
  it('returns cast FinancialRecord array', () => {
    const payload = makePayload();
    const p1 = svc.create(svc.create(payload, makeInput()), makeInput());
    expect(svc.list(p1)).toHaveLength(2);
  });
});
