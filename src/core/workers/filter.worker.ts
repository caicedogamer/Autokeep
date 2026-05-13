/// <reference lib="webworker" />
/*
 * Filter worker — applies FilterState to a records snapshot off-thread.
 *
 * Protocol:
 *   IN:  FilterRequest  { kind: 'apply', requestId, recordsSnapshotVersion, records, filterState }
 *   OUT: FilterResponse { kind: 'apply-ok', requestId, ids, count }
 *
 * Stale-response suppression:
 *   The worker tracks the most recently received requestId. If a new
 *   request arrives before the current one finishes (or right after),
 *   only the highest requestId is posted back. Because each request is
 *   synchronous (no awaits), cancellation is implicit: the main thread
 *   drops apply-ok messages whose requestId is below its own counter.
 */

import type { FilterRequest, FilterResponse } from './messages.js';
import type { FinancialRecord } from '../../modules/records/domain/types.js';
import type { FilterState } from '../../modules/filters/domain/types.js';
import { applyFilters } from '../../modules/filters/domain/predicates.js';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<FilterRequest>) => {
  const req = event.data;
  if (req.kind !== 'apply') return;

  const records = req.records as readonly FinancialRecord[];
  const filterState = req.filterState as FilterState;

  const matched = applyFilters(records, filterState);

  const response: FilterResponse = {
    kind: 'apply-ok',
    requestId: req.requestId,
    ids: matched.map((r) => r.id),
    count: matched.length,
  };
  ctx.postMessage(response);
});
