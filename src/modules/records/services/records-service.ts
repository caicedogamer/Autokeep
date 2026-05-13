/*
 * RecordsService — CRUD for FinancialRecord with optimistic concurrency (FR-036).
 *
 * All mutations operate on the in-memory WorkspacePayloadV1 snapshot and then
 * persist the whole payload back through EncryptedStore. The caller is
 * responsible for passing the current payload; the service returns an updated
 * payload that the caller should store as the new source of truth.
 *
 * Capacity gating (FR-041) is delegated to CapacityGate; the service only
 * calls it on create/import.
 */

import { AutoKeepError } from '../../../core/result.js';
import { evaluateCapacity, CapacityExceededError } from '../../workspace/services/capacity-gate.js';
import type { WorkspacePayloadV1 } from '../../workspace/services/workspace-service.js';
import type {
  FinancialRecord,
  Id,
  NewRecordInput,
  UpdateRecordInput,
  ConflictInfo,
} from '../domain/types.js';
import { toId, toIsoDateTime } from '../domain/types.js';

/* ---------- Errors ---------- */

export class RecordNotFoundError extends AutoKeepError {
  public readonly code = 'RECORD_NOT_FOUND';
  public constructor(id: Id) {
    super(`Record ${id} not found.`);
  }
}

export class RecordConflictError extends AutoKeepError {
  public readonly code = 'RECORD_CONFLICT';
  public readonly conflict: ConflictInfo;
  public constructor(conflict: ConflictInfo) {
    super(
      `Conflict on record ${conflict.recordId}: ` +
        `attempted v${String(conflict.attemptedVersion)}, ` +
        `stored v${String(conflict.storedVersion)}.`,
    );
    this.conflict = conflict;
  }
}

export class CategoryInUseError extends AutoKeepError {
  public readonly code = 'CATEGORY_IN_USE';
}

export class CounterpartyInUseError extends AutoKeepError {
  public readonly code = 'COUNTERPARTY_IN_USE';
}

/* ---------- Service ---------- */

const now = (): string => new Date().toISOString();

export class RecordsService {
  /**
   * Create a new record in the payload. Returns the updated payload.
   * Checks capacity (FR-041) before mutating.
   */
  public create(payload: WorkspacePayloadV1, input: NewRecordInput): WorkspacePayloadV1 {
    const capacity = evaluateCapacity(payload.records.length);
    if (capacity === 'hard-cap') {
      throw new CapacityExceededError(payload.records.length, 1);
    }

    const ts = now();
    const record: FinancialRecord = {
      id: toId(globalThis.crypto.randomUUID()),
      date: input.date,
      type: input.type,
      amount: input.amount,
      categoryId: input.categoryId,
      description: input.description.trim(),
      ...(input.counterpartyId !== undefined && { counterpartyId: input.counterpartyId }),
      source: 'manual',
      version: 1,
      createdAt: toIsoDateTime(ts),
      updatedAt: toIsoDateTime(ts),
      schemaVersion: 1,
    };

    return { ...payload, records: [...payload.records, record] };
  }

  /**
   * Update an existing record. Enforces FR-036 optimistic concurrency:
   * throws RecordConflictError if `input.version` != stored version.
   */
  public update(payload: WorkspacePayloadV1, input: UpdateRecordInput): WorkspacePayloadV1 {
    const stored = (payload.records as readonly FinancialRecord[]).find((r) => r.id === input.id);
    if (!stored) throw new RecordNotFoundError(input.id);

    if (stored.version !== input.version) {
      throw new RecordConflictError({
        recordId: input.id,
        storedVersion: stored.version,
        attemptedVersion: input.version,
        stored,
      });
    }

    const ts = now();

    // Handle counterpartyId: null = remove key, Id = set, undefined = keep.
    const withoutCounterparty = (r: FinancialRecord): FinancialRecord => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { counterpartyId: _, ...rest } = r;
      return rest as FinancialRecord;
    };

    const base: FinancialRecord =
      input.counterpartyId === null ? withoutCounterparty(stored) : stored;

    // Build updated record using explicit field overrides (no mutable patch
    // object — FinancialRecord fields are all readonly).
    const updated: FinancialRecord = {
      ...base,
      ...(input.date !== undefined && { date: input.date }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
      ...(input.description !== undefined && { description: input.description.trim() }),
      ...(input.counterpartyId != null && { counterpartyId: input.counterpartyId }),
      version: stored.version + 1,
      updatedAt: toIsoDateTime(ts),
    } as FinancialRecord;

    return {
      ...payload,
      records: (payload.records as readonly FinancialRecord[]).map((r) =>
        r.id === input.id ? updated : r,
      ),
    };
  }

  /**
   * Delete a record by id. Throws RecordNotFoundError if absent.
   */
  public delete(payload: WorkspacePayloadV1, id: Id): WorkspacePayloadV1 {
    const exists = (payload.records as readonly FinancialRecord[]).some((r) => r.id === id);
    if (!exists) throw new RecordNotFoundError(id);

    return {
      ...payload,
      records: (payload.records as readonly FinancialRecord[]).filter((r) => r.id !== id),
    };
  }

  /**
   * Returns all records cast to FinancialRecord[].
   * The payload stores `readonly unknown[]` to keep WorkspacePayloadV1 generic;
   * modules are responsible for casting within their own boundary.
   */
  public list(payload: WorkspacePayloadV1): readonly FinancialRecord[] {
    return payload.records as readonly FinancialRecord[];
  }

  /**
   * Returns how many records reference the given categoryId.
   * Used by category-delete gating.
   */
  public countByCategory(payload: WorkspacePayloadV1, categoryId: Id): number {
    return (payload.records as readonly FinancialRecord[]).filter(
      (r) => r.categoryId === categoryId,
    ).length;
  }

  /**
   * Returns how many records reference the given counterpartyId.
   */
  public countByCounterparty(payload: WorkspacePayloadV1, counterpartyId: Id): number {
    return (payload.records as readonly FinancialRecord[]).filter(
      (r) => r.counterpartyId === counterpartyId,
    ).length;
  }
}
