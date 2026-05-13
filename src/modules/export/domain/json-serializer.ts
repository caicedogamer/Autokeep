/*
 * JSON export serializer (US4 / FR-017 / FR-019 / SC-005).
 *
 * Produces a JSON object matching contracts/export-json.schema.md.
 * Amount is in integer minor units (matches the in-memory MoneyMinor).
 *
 * Pure function — no I/O.
 */

import type { FinancialRecord, Category, Counterparty } from '../../records/domain/types.js';
import type { FilterState } from '../../filters/domain/types.js';
import { applyFilters } from '../../filters/domain/predicates.js';

export interface JsonExportInput {
  readonly records: readonly FinancialRecord[];
  readonly categories: ReadonlyMap<string, Category>;
  readonly counterparties: ReadonlyMap<string, Counterparty>;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly currency: string;
  readonly currencyMinorUnits: 0 | 2 | 3;
  readonly filterState: FilterState;
}

export interface JsonExportRecord {
  readonly date: string;
  readonly type: 'income' | 'expense';
  readonly amount: number;
  readonly category: string;
  readonly description: string;
  readonly counterparty?: string;
}

export interface JsonExportPayload {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly workspace: {
    readonly id: string;
    readonly name: string;
    readonly currency: string;
    readonly currencyMinorUnits: number;
  };
  readonly filter: FilterState;
  readonly records: readonly JsonExportRecord[];
}

function sortRecords(records: readonly FinancialRecord[]): readonly FinancialRecord[] {
  return [...records].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

export function serializeToJson(input: JsonExportInput): JsonExportPayload {
  const filtered = applyFilters(input.records, input.filterState);
  const sorted = sortRecords(filtered);

  const records: JsonExportRecord[] = sorted.map((record) => {
    const cat = input.categories.get(record.categoryId);
    const cp =
      record.counterpartyId !== undefined
        ? input.counterparties.get(record.counterpartyId)
        : undefined;

    const item: JsonExportRecord = {
      date: record.date,
      type: record.type,
      amount: record.amount,
      category: cat?.name ?? '',
      description: record.description,
      ...(cp !== undefined ? { counterparty: cp.name } : {}),
    };
    return item;
  });

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workspace: {
      id: input.workspaceId,
      name: input.workspaceName,
      currency: input.currency,
      currencyMinorUnits: input.currencyMinorUnits,
    },
    filter: input.filterState,
    records,
  };
}
