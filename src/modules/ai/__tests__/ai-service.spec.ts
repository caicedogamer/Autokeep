import { describe, it, expect, vi } from 'vitest';

import { AiService } from '../services/ai-service.js';
import type { FinancialRecord } from '../../records/domain/types.js';
import { toId, toMoneyMinor, toIsoDate, toIsoDateTime } from '../../records/domain/types.js';

/* ---------- fixtures ---------- */

let _seq = 0;
function rec(overrides: {
  type?: 'income' | 'expense';
  amount?: number;
  categoryId: string;
  counterpartyId?: string;
  description?: string;
  date?: string;
}): FinancialRecord {
  _seq += 1;
  const base = {
    id: toId(`ai-r-${String(_seq)}`),
    date: toIsoDate(overrides.date ?? '2026-01-15'),
    type: overrides.type ?? ('expense' as const),
    amount: toMoneyMinor(overrides.amount ?? 1000),
    categoryId: toId(overrides.categoryId),
    description: overrides.description ?? `Descripción ${String(_seq)}`,
    source: 'manual' as const,
    version: 1,
    createdAt: toIsoDateTime('2026-01-15T00:00:00Z'),
    updatedAt: toIsoDateTime('2026-01-15T00:00:00Z'),
    schemaVersion: 1 as const,
  };
  if (overrides.counterpartyId) {
    return { ...base, counterpartyId: toId(overrides.counterpartyId) };
  }
  return base;
}

// 5 records with clear counterparty→category pattern
const HISTORY: FinancialRecord[] = [
  rec({ categoryId: 'cat-svc', counterpartyId: 'cp-a', description: 'Factura Acme enero' }),
  rec({ categoryId: 'cat-svc', counterpartyId: 'cp-a', description: 'Factura Acme febrero' }),
  rec({ categoryId: 'cat-svc', counterpartyId: 'cp-a', description: 'Factura Acme marzo' }),
  rec({ categoryId: 'cat-svc', counterpartyId: 'cp-a', description: 'Factura Acme abril' }),
  rec({ categoryId: 'cat-svc', counterpartyId: 'cp-a', description: 'Factura Acme mayo' }),
];

/* ---------- AiService tests ---------- */

describe('AiService — aiEnabled=false (SC-009)', () => {
  it('suggestForDraft returns null without consulting heuristics', () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const svc = new AiService({ settings: { aiEnabled: false }, persistFindings: persist });

    const result = svc.suggestForDraft({ counterpartyId: toId('cp-a') }, HISTORY);
    expect(result).toBeNull();
  });

  it('runInconsistenciesPass returns [] without calling persistFindings', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const svc = new AiService({ settings: { aiEnabled: false }, persistFindings: persist });

    const findings = await svc.runInconsistenciesPass(HISTORY);
    expect(findings).toHaveLength(0);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('AiService — aiEnabled=true', () => {
  it('suggestForDraft returns a non-null suggestion for a known pattern', () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const svc = new AiService({
      settings: { aiEnabled: true, suggestionMinSupport: 3, suggestionMinConfidence: 0.6 },
      persistFindings: persist,
    });

    const result = svc.suggestForDraft({ counterpartyId: toId('cp-a') }, HISTORY);
    expect(result).not.toBeNull();
    expect(result?.proposedCategoryId).toBe('cat-svc');
  });

  it('runInconsistenciesPass calls persistFindings with results', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const svc = new AiService({ settings: { aiEnabled: true }, persistFindings: persist });

    // Use enough records to trigger at least one detector (likely-duplicate)
    const dupRecords: FinancialRecord[] = [
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago duplicado proveedor',
        date: '2026-01-10',
      }),
      rec({
        amount: 5000,
        categoryId: 'cat-a',
        description: 'Pago duplicado proveedor',
        date: '2026-01-11',
      }),
    ];

    await svc.runInconsistenciesPass(dupRecords);
    expect(persist).toHaveBeenCalledOnce();
    const [findings] = persist.mock.calls[0] as [unknown[]];
    expect(Array.isArray(findings)).toBe(true);
  });

  it('toggling aiEnabled does not corrupt existing records', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const svcOn = new AiService({ settings: { aiEnabled: true }, persistFindings: persist });
    const svcOff = new AiService({ settings: { aiEnabled: false }, persistFindings: persist });

    // Both services share the same records but operate independently
    await svcOn.runInconsistenciesPass(HISTORY);
    const findingsOff = await svcOff.runInconsistenciesPass(HISTORY);

    expect(findingsOff).toHaveLength(0);
    // Original records are unmodified (pure functions don't mutate)
    expect(HISTORY).toHaveLength(5);
    expect(HISTORY[0]?.categoryId).toBe('cat-svc');
  });
});

describe('AiService — settings', () => {
  it('uses DEFAULT_AI_SETTINGS when no settings provided', () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const svc = new AiService({ persistFindings: persist });
    const settings = svc.getSettings();
    expect(settings.aiEnabled).toBe(true);
    expect(settings.suggestionMinSupport).toBeGreaterThan(0);
    expect(settings.suggestionMinConfidence).toBeGreaterThan(0);
  });

  it('partial settings override only specified fields', () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const svc = new AiService({
      settings: { suggestionMinSupport: 10 },
      persistFindings: persist,
    });
    const settings = svc.getSettings();
    expect(settings.suggestionMinSupport).toBe(10);
    // Other defaults preserved
    expect(settings.aiEnabled).toBe(true);
  });
});
