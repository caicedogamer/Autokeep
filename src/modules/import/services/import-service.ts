/*
 * ImportService — orchestrates file import for US3.
 *
 * Responsibilities:
 *   1. Accept a File from the user.
 *   2. Send it to the import worker for validation (off-thread).
 *   3. Return a ValidationReport to the caller for preview/confirmation.
 *   4. On `confirmCommit(truncate)`, fold valid rows into the workspace
 *      payload and call persistPayload.
 *
 * Design:
 *   - The service wraps the worker call in a Promise so the UI awaits it.
 *   - Graceful degradation: if the Worker constructor throws, validation
 *     runs synchronously on the main thread via validateCsvRows /
 *     validateJsonPayload (same predicates; no separate code path needed
 *     because the worker imports the same modules).
 *   - No silent truncation: if capacity would be exceeded the caller
 *     must explicitly pass truncate=true.
 */

import type { WorkspacePayloadV1 } from '../../workspace/services/workspace-service.js';
import type { FinancialRecord, Category, Counterparty } from '../../records/domain/types.js';
import { toId, toIsoDateTime } from '../../records/domain/types.js';
import type {
  ValidationReport,
  ParsedRow,
  ImportBatch,
  ImportBatchOutcome,
} from '../domain/types.js';
import { validateCsvRows } from '../domain/csv-schema.js';
import { validateJsonPayload } from '../domain/json-schema.js';
import type { ImportFinalMessage } from '../../../core/workers/messages.js';

type PersistPayload = (payload: WorkspacePayloadV1) => Promise<void>;

export interface ImportServiceDeps {
  readonly persistPayload: PersistPayload;
}

function generateId(): string {
  return crypto.randomUUID();
}

export class ImportService {
  private readonly deps: ImportServiceDeps;
  private worker: Worker | null = null;
  private workerAvailable = true;

  public constructor(deps: ImportServiceDeps) {
    this.deps = deps;
    this.trySpawnWorker();
  }

  private trySpawnWorker(): void {
    try {
      this.worker = new Worker(new URL('../../../core/workers/import.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      this.workerAvailable = false;
    }
  }

  /**
   * Validate a file and return a ValidationReport.
   * Runs in the worker if available, synchronously otherwise.
   */
  public async validate(file: File, payload: WorkspacePayloadV1): Promise<ValidationReport> {
    const fileKind: 'csv' | 'json' = file.name.endsWith('.json') ? 'json' : 'csv';
    const workspace = payload.workspace;
    const existingCount = (payload.records as FinancialRecord[]).length;
    const importCtx = {
      currency: workspace.currency,
      currencyMinorUnits: workspace.currencyMinorUnits,
      existingCount,
    };

    if (this.workerAvailable && this.worker !== null) {
      const buffer = await file.arrayBuffer();
      return this.validateViaWorker(buffer, fileKind, importCtx);
    }

    // Synchronous fallback
    const text = await file.text();
    return this.validateSync(text, fileKind, importCtx);
  }

  private validateViaWorker(
    buffer: ArrayBuffer,
    fileKind: 'csv' | 'json',
    importCtx: { currency: string; currencyMinorUnits: 0 | 2 | 3; existingCount: number },
  ): Promise<ValidationReport> {
    return new Promise<ValidationReport>((resolve, reject) => {
      const requestId = generateId();
      const worker = this.worker as Worker;

      const onMessage = (event: MessageEvent<ImportFinalMessage>): void => {
        const msg = event.data;
        if (msg.requestId !== requestId) return;
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        resolve(msg.report as ValidationReport);
      };

      const onError = (): void => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        this.workerAvailable = false;
        reject(new Error('Import worker failed'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      worker.postMessage(
        { kind: 'import', requestId, fileKind, fileBuffer: buffer, ctx: importCtx },
        [buffer],
      );
    });
  }

  private async validateSync(
    text: string,
    fileKind: 'csv' | 'json',
    importCtx: { currency: string; currencyMinorUnits: 0 | 2 | 3; existingCount: number },
  ): Promise<ValidationReport> {
    if (fileKind === 'json') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          outcome: 'rejected-structural',
          structuralCode: 'MALFORMED_JSON',
          totalRows: 0,
          validRows: [],
          errorRows: [],
        };
      }
      return validateJsonPayload(parsed, importCtx);
    }

    // CSV — dynamic import PapaParse on main thread
    const Papa = (await import('papaparse')).default;
    const stripped = text.startsWith('﻿') ? text.slice(1) : text;
    const parsed = Papa.parse<string[]>(stripped, { skipEmptyLines: true });
    const [headers, ...rows] = parsed.data;
    if (!headers) {
      return {
        outcome: 'rejected-structural',
        structuralCode: 'HEADER_MISSING',
        totalRows: 0,
        validRows: [],
        errorRows: [],
      };
    }
    return validateCsvRows({ headers, rows }, importCtx);
  }

  /**
   * Commit validated rows into the workspace payload.
   *
   * @param report The ValidationReport from `validate()`.
   * @param payload Current workspace payload.
   * @param truncate If true and capacity would be exceeded, only commit
   *   `capacityWarning.allowedCount` rows. If false, reject the call.
   */
  public async confirmCommit(
    report: ValidationReport,
    payload: WorkspacePayloadV1,
    truncate: boolean,
  ): Promise<{
    outcome: ImportBatchOutcome;
    batch: ImportBatch;
    updatedPayload: WorkspacePayloadV1;
  }> {
    const startedAt = new Date().toISOString();

    let rowsToCommit: readonly ParsedRow[] = report.validRows;

    if (report.capacityWarning) {
      if (!truncate) {
        const batch: ImportBatch = {
          id: generateId(),
          startedAt,
          fileKind: 'csv',
          outcome: 'cancelled',
          totalRows: report.totalRows,
          committedRows: 0,
          errorRows: report.errorRows.length,
        };
        return { outcome: 'cancelled', batch, updatedPayload: payload };
      }
      rowsToCommit = report.validRows.slice(0, report.capacityWarning.allowedCount);
    }

    const existingRecords = payload.records as readonly FinancialRecord[];
    const existingCategories = payload.categories as readonly Category[];
    const existingCounterparties = payload.counterparties as readonly Counterparty[];

    // Build lookup maps for resolve/create categories and counterparties
    const catByName = new Map<string, Category>(
      existingCategories.map((c) => [c.name.toLowerCase(), c]),
    );
    const cpByName = new Map<string, Counterparty>(
      existingCounterparties.map((c) => [c.name.toLowerCase(), c]),
    );

    const newCategories: Category[] = [];
    const newCounterparties: Counterparty[] = [];
    const newRecords: FinancialRecord[] = [];
    const ts = new Date().toISOString();

    for (const row of rowsToCommit) {
      // Resolve or create category
      const catKey = row.categoryName.toLowerCase();
      let cat = catByName.get(catKey);
      if (!cat) {
        const newCat: Category = {
          id: toId(generateId()),
          name: row.categoryName,
          learnedFromAi: false,
          createdAt: toIsoDateTime(ts),
          updatedAt: toIsoDateTime(ts),
          schemaVersion: 1,
        };
        catByName.set(catKey, newCat);
        newCategories.push(newCat);
        cat = newCat;
      }

      // Resolve or create counterparty
      let cpId: string | undefined;
      if (row.counterpartyName) {
        const cpKey = row.counterpartyName.toLowerCase();
        let cp = cpByName.get(cpKey);
        if (!cp) {
          const newCp: Counterparty = {
            id: toId(generateId()),
            name: row.counterpartyName,
            aliases: [],
            createdAt: toIsoDateTime(ts),
            updatedAt: toIsoDateTime(ts),
            schemaVersion: 1,
          };
          cpByName.set(cpKey, newCp);
          newCounterparties.push(newCp);
          cp = newCp;
        }
        cpId = cp.id;
      }

      const record: FinancialRecord = {
        id: toId(generateId()),
        date: row.date,
        type: row.type,
        amount: row.amount,
        categoryId: cat.id,
        description: row.description,
        source: 'import',
        version: 1,
        createdAt: toIsoDateTime(ts),
        updatedAt: toIsoDateTime(ts),
        schemaVersion: 1,
        ...(cpId !== undefined ? { counterpartyId: toId(cpId) } : {}),
      };
      newRecords.push(record);
    }

    const committedAt = new Date().toISOString();
    const outcome: ImportBatchOutcome =
      report.capacityWarning && truncate ? 'partial-commit' : 'committed';

    const batch: ImportBatch = {
      id: generateId(),
      startedAt,
      committedAt,
      fileKind: 'csv',
      outcome,
      totalRows: report.totalRows,
      committedRows: newRecords.length,
      errorRows: report.errorRows.length,
    };

    const updatedPayload: WorkspacePayloadV1 = {
      ...payload,
      records: [...existingRecords, ...newRecords],
      categories: [...existingCategories, ...newCategories],
      counterparties: [...existingCounterparties, ...newCounterparties],
      importBatches: [...(payload.importBatches as ImportBatch[]), batch],
    };

    await this.deps.persistPayload(updatedPayload);

    return { outcome, batch, updatedPayload };
  }

  public dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
