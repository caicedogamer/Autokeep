/*
 * ImportPipeline — flexible-import orchestrator (US3v2).
 *
 * Coordinates the 6-stage pipeline:
 *   1. Parse        — worker (parseCsv / parseJson) → RawTable
 *   2. Infer        — worker (HeuristicColumnMapper) → InferenceReport
 *   3. Confirm      — main thread (operator confirms a MappingDecision)
 *   4. Normalize    — worker (normalize)
 *   5. Validate     — worker (validate, adaptive)
 *   6. Persist      — main thread, on `confirmCommit`
 *
 * Falls back to synchronous execution on the main thread when the
 * worker cannot be spawned (e.g. in jsdom unit tests).
 *
 * Spec refs:
 *   - contracts/import-csv.schema.md
 *   - contracts/import-json.schema.md
 *   - contracts/import-mapping.md
 */

import type { WorkspacePayloadV1 } from '../../workspace/services/workspace-service.js';
import type { Category, Counterparty, FinancialRecord } from '../../records/domain/types.js';
import { toId, toIsoDateTime } from '../../records/domain/types.js';
import type {
  FlexibleParsedRow,
  FlexibleValidationReport,
  ImportBatch,
  ImportBatchOutcome,
  ImportCtx,
  InferenceContext,
  InferenceReport,
  MappingDecision,
  ParserRejection,
  RawTable,
} from '../domain/types.js';
import { parseCsv } from '../domain/parsing/csv-parser.js';
import { parseJson } from '../domain/parsing/json-parser.js';
import { HeuristicColumnMapper } from '../domain/inference/heuristic-column-mapper.js';
import { normalize } from '../domain/normalization/normalizer.js';
import { validate } from '../domain/validation/validator.js';
import type {
  ImportPipelineRequest,
  ImportPipelineResponse,
} from '../../../core/workers/messages.js';

type PersistPayload = (payload: WorkspacePayloadV1) => Promise<void>;

export interface ImportPipelineDeps {
  readonly persistPayload: PersistPayload;
}

export interface ParseResult {
  readonly table?: RawTable;
  readonly rejection?: ParserRejection;
}

function generateId(): string {
  return crypto.randomUUID();
}

const mainThreadMapper = new HeuristicColumnMapper();

export class ImportPipeline {
  private readonly deps: ImportPipelineDeps;
  private worker: Worker | null = null;
  private workerAvailable = true;

  public constructor(deps: ImportPipelineDeps) {
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

  /** Stage 1 — parse file bytes to a RawTable (or a parser rejection). */
  public async parse(file: File): Promise<ParseResult> {
    const fileKind: 'csv' | 'json' =
      file.name.endsWith('.json') || file.name.endsWith('.ndjson') ? 'json' : 'csv';
    const buffer = await file.arrayBuffer();

    if (this.workerAvailable && this.worker) {
      return this.send<ParseResult>({
        kind: 'pipeline-parse',
        requestId: generateId(),
        fileKind,
        fileBuffer: buffer,
      });
    }

    return fileKind === 'csv' ? parseCsv(buffer) : parseJson(buffer);
  }

  /** Stage 2 — infer column types + semantic roles. */
  public async infer(table: RawTable, ctx: InferenceContext): Promise<InferenceReport> {
    if (this.workerAvailable && this.worker) {
      const response = await this.send<{ report: InferenceReport }>({
        kind: 'pipeline-infer',
        requestId: generateId(),
        table,
        ctx,
      });
      return response.report;
    }
    return mainThreadMapper.infer(table, ctx);
  }

  /** Stages 4 + 5 — normalize and validate against the confirmed mapping. */
  public async normalizeAndValidate(
    table: RawTable,
    decision: MappingDecision,
    ctx: ImportCtx,
  ): Promise<FlexibleValidationReport> {
    if (this.workerAvailable && this.worker) {
      const response = await this.send<{ report: FlexibleValidationReport }>({
        kind: 'pipeline-normalize-validate',
        requestId: generateId(),
        table,
        decision,
        ctx,
      });
      return response.report;
    }
    const normalized = normalize(table, decision);
    return validate({ rows: normalized, decision, ctx });
  }

  /**
   * Stage 6 — commit valid rows into the workspace payload. Mirrors the
   * legacy `ImportService.confirmCommit` semantics, but writes records
   * with `schemaVersion: 2` and persists `extraMetadata` per row.
   */
  public async confirmCommit(
    report: FlexibleValidationReport,
    payload: WorkspacePayloadV1,
    options: {
      readonly truncate: boolean;
      readonly fileKind: 'csv' | 'json';
      readonly mappingDecision: MappingDecision;
      readonly inferenceReport: InferenceReport;
    },
  ): Promise<{
    outcome: ImportBatchOutcome;
    batch: ImportBatch;
    updatedPayload: WorkspacePayloadV1;
  }> {
    const startedAt = new Date().toISOString();

    let rowsToCommit: readonly FlexibleParsedRow[] = report.validRows;

    if (report.capacityWarning) {
      if (!options.truncate) {
        const batch: ImportBatch = {
          id: generateId(),
          startedAt,
          fileKind: options.fileKind,
          outcome: 'cancelled',
          totalRows: report.totalRows,
          committedRows: 0,
          errorRows: report.errorRows.length,
          schemaVersion: 2,
          inferenceReport: options.inferenceReport,
          mappingDecision: options.mappingDecision,
        };
        return { outcome: 'cancelled', batch, updatedPayload: payload };
      }
      rowsToCommit = report.validRows.slice(0, report.capacityWarning.allowedCount);
    }

    const existingRecords = payload.records as readonly FinancialRecord[];
    const existingCategories = payload.categories as readonly Category[];
    const existingCounterparties = payload.counterparties as readonly Counterparty[];

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
      const catKey = row.categoryName.toLowerCase();
      let cat = catByName.get(catKey);
      if (!cat) {
        const newCat: Category = {
          id: toId(generateId()),
          name: row.categoryName,
          learnedFromAi: false,
          createdAt: toIsoDateTime(ts),
          updatedAt: toIsoDateTime(ts),
          schemaVersion: 2,
        };
        catByName.set(catKey, newCat);
        newCategories.push(newCat);
        cat = newCat;
      }

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
            schemaVersion: 2,
          };
          cpByName.set(cpKey, newCp);
          newCounterparties.push(newCp);
          cp = newCp;
        }
        cpId = cp.id;
      }

      const hasMetadata = Object.keys(row.extraMetadata).length > 0;
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
        schemaVersion: 2,
        ...(cpId !== undefined ? { counterpartyId: toId(cpId) } : {}),
        ...(hasMetadata ? { extraMetadata: row.extraMetadata } : {}),
      };
      newRecords.push(record);
    }

    const committedAt = new Date().toISOString();
    const outcome: ImportBatchOutcome =
      report.capacityWarning && options.truncate ? 'partial-commit' : 'committed';

    const batch: ImportBatch = {
      id: generateId(),
      startedAt,
      committedAt,
      fileKind: options.fileKind,
      outcome,
      totalRows: report.totalRows,
      committedRows: newRecords.length,
      errorRows: report.errorRows.length,
      schemaVersion: 2,
      inferenceReport: options.inferenceReport,
      mappingDecision: options.mappingDecision,
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

  /* ---------- Worker send/receive helpers ---------- */

  private send<T>(request: ImportPipelineRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const worker = this.worker;
      if (!worker) {
        reject(new Error('Import worker is not available.'));
        return;
      }
      const onMessage = (event: MessageEvent<ImportPipelineResponse>): void => {
        const msg = event.data;
        if (msg.requestId !== request.requestId) return;
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (msg.kind === 'pipeline-error') {
          reject(new Error(msg.reason));
          return;
        }
        resolve(msg as unknown as T);
      };
      const onError = (): void => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        this.workerAvailable = false;
        reject(new Error('Import worker failed'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      // Transfer the file buffer to avoid a copy for large CSVs.
      const transfers: Transferable[] = [];
      if (request.kind === 'pipeline-parse') transfers.push(request.fileBuffer);
      worker.postMessage(request, transfers);
    });
  }
}
