/*
 * ExportService — orchestrates record export for US4.
 *
 * Responsibilities:
 *   1. Apply active filter to the current records snapshot.
 *   2. Serialize to CSV or JSON via the domain serializers.
 *   3. Trigger a browser download via URL.createObjectURL.
 *   4. Surface a confirmation dialog when zero records would be exported
 *      (FR-020).
 *
 * No worker: serialization is synchronous and fast enough for ≤ 12 000 records.
 */

import type { FinancialRecord, Category, Counterparty } from '../../records/domain/types.js';
import type { FilterState } from '../../filters/domain/types.js';
import type { WorkspacePayloadV1 } from '../../workspace/services/workspace-service.js';
import { serializeToCsv } from '../domain/csv-serializer.js';
import { serializeToJson } from '../domain/json-serializer.js';

export type ExportFormat = 'csv' | 'json';

export interface ExportOpts {
  readonly format: ExportFormat;
  readonly filterState: FilterState;
  /** Called when zero records match and the operator must confirm. */
  readonly onEmptyConfirm: () => Promise<boolean>;
  /** Triggers a file download; injected to keep DOM out of the service layer. */
  readonly triggerDownload: (content: string, filename: string, mimeType: string) => void;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').replace(/\s+/g, '-');
}

function formatDateStamp(): string {
  const now = new Date();
  const y = String(now.getFullYear());
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${y}${mo}${d}-${h}${mi}`;
}

export class ExportService {
  public async export(payload: WorkspacePayloadV1, opts: ExportOpts): Promise<void> {
    const records = payload.records as readonly FinancialRecord[];
    const categories = payload.categories as readonly Category[];
    const counterparties = payload.counterparties as readonly Counterparty[];
    const workspace = payload.workspace;

    const catMap = new Map<string, Category>(categories.map((c) => [c.id, c]));
    const cpMap = new Map<string, Counterparty>(counterparties.map((c) => [c.id, c]));

    const { format, filterState } = opts;

    // Check for empty export (FR-020)
    const { applyFilters } = await import('../../filters/domain/predicates.js');
    const filtered = applyFilters(records, filterState);

    if (filtered.length === 0) {
      const confirmed = await opts.onEmptyConfirm();
      if (!confirmed) return;
    }

    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === 'csv') {
      content = serializeToCsv({
        records,
        categories: catMap,
        counterparties: cpMap,
        currency: workspace.currency,
        currencyMinorUnits: workspace.currencyMinorUnits,
        filterState,
      });
      mimeType = 'text/csv;charset=utf-8;';
      ext = 'csv';
    } else {
      const jsonPayload = serializeToJson({
        records,
        categories: catMap,
        counterparties: cpMap,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        currency: workspace.currency,
        currencyMinorUnits: workspace.currencyMinorUnits,
        filterState,
      });
      content = JSON.stringify(jsonPayload, null, 2);
      mimeType = 'application/json;charset=utf-8;';
      ext = 'json';
    }

    const filename = `autokeep-export-${sanitizeFilename(workspace.name)}-${formatDateStamp()}.${ext}`;
    opts.triggerDownload(content, filename, mimeType);
  }
}
