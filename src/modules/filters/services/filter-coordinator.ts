/*
 * FilterCoordinator — debounces filter changes and dispatches to the
 * filter worker (T048), falling back to synchronous main-thread filtering
 * if the worker fails to spawn.
 *
 * Design:
 *   - Monotonically increasing requestId: the main thread only acts on
 *     responses whose requestId matches the latest request, so
 *     out-of-order worker responses are silently dropped.
 *   - 50 ms debounce: coalesces rapid keystroke bursts (SC-002 budget).
 *   - Graceful degradation: if the Worker constructor throws (e.g. in a
 *     test environment or strict CSP), `applyFilters` runs synchronously.
 */

import type { FinancialRecord } from '../../records/domain/types.js';
import type { FilterState } from '../domain/types.js';
import { emptyFilterState } from '../domain/types.js';
import { applyFilters } from '../domain/predicates.js';
import type { FilterResponse } from '../../../core/workers/messages.js';

export type FilterResultCallback = (ids: readonly string[], count: number) => void;

const DEBOUNCE_MS = 50;

export class FilterCoordinator {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private lastDispatchedId = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRecords: readonly FinancialRecord[] = [];
  private currentState: FilterState = emptyFilterState();
  private onResult: FilterResultCallback;
  private workerAvailable = true;

  public constructor(onResult: FilterResultCallback) {
    this.onResult = onResult;
    this.trySpawnWorker();
  }

  private trySpawnWorker(): void {
    try {
      this.worker = new Worker(new URL('../../../core/workers/filter.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (event: MessageEvent<FilterResponse>) => {
        const resp = event.data;
        if (resp.kind === 'apply-ok' && resp.requestId === this.lastDispatchedId) {
          this.onResult(resp.ids, resp.count);
        }
      });
      this.worker.addEventListener('error', () => {
        this.workerAvailable = false;
        this.worker = null;
        console.warn('[FilterCoordinator] Worker error — falling back to main-thread filtering.');
      });
    } catch {
      this.workerAvailable = false;
      console.warn('[FilterCoordinator] Worker unavailable — using main-thread filtering.');
    }
  }

  /**
   * Update the current records snapshot. Triggers a new filter pass if
   * a filter state is active.
   */
  public setRecords(records: readonly FinancialRecord[]): void {
    this.currentRecords = records;
    this.scheduleApply();
  }

  /**
   * Update the active filter state. Debounced by 50 ms.
   */
  public setFilter(state: FilterState): void {
    this.currentState = state;
    this.scheduleApply();
  }

  private scheduleApply(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.dispatch();
    }, DEBOUNCE_MS);
  }

  private dispatch(): void {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    this.lastDispatchedId = requestId;

    if (this.workerAvailable && this.worker !== null) {
      this.worker.postMessage({
        kind: 'apply',
        requestId,
        recordsSnapshotVersion: requestId,
        records: this.currentRecords,
        filterState: this.currentState,
      });
    } else {
      // Synchronous main-thread fallback.
      const matched = applyFilters(this.currentRecords, this.currentState);
      this.onResult(
        matched.map((r) => r.id),
        matched.length,
      );
    }
  }

  /**
   * Apply filters synchronously (used in tests and the fallback path).
   * Bypasses the debounce and worker.
   */
  public applyTo(records: readonly FinancialRecord[]): FinancialRecord[] {
    return applyFilters(records, this.currentState);
  }

  /** Flush a pending debounce and dispatch immediately. */
  public flush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.dispatch();
  }

  public dispose(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.worker?.terminate();
    this.worker = null;
  }
}
