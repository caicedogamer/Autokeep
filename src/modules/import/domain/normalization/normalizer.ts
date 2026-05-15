/*
 * Normalizer (Stage 4) — flexible import pipeline.
 *
 * Spec refs:
 *   - contracts/import-csv.schema.md §Stage 4
 *   - contracts/import-mapping.md
 *
 * Pure function: routes cells from each column to its semantic-role
 * slot per the operator-confirmed `MappingDecision`. Does NOT coerce
 * types — the validator (Stage 5) handles parsing under the confirmed
 * format. Preserves unmapped columns under `extraMetadata`.
 *
 * Out: NormalizedRow[] — one per data row in the RawTable.
 */

import type {
  ColumnMapping,
  MappingDecision,
  NormalizedRow,
  RawTable,
  SemanticRole,
} from '../types.js';

interface RoleLocation {
  readonly column: number;
}

function locateRoles(mapping: ColumnMapping): Map<SemanticRole, RoleLocation> {
  const out = new Map<SemanticRole, RoleLocation>();
  for (const [colStr, role] of Object.entries(mapping)) {
    const col = parseInt(colStr, 10);
    if (Number.isNaN(col)) continue;
    // The first column with the role wins. Required roles are
    // expected to be unique post-confirmation; this guard is defensive.
    if (!out.has(role)) out.set(role, { column: col });
  }
  return out;
}

export function normalize(table: RawTable, decision: MappingDecision): NormalizedRow[] {
  const roleByCol = decision.mapping;
  const locations = locateRoles(roleByCol);

  const dateLoc = locations.get('date');
  const typeLoc = locations.get('type');
  const amountLoc = locations.get('amount');
  const currencyLoc = locations.get('currency');
  const categoryLoc = locations.get('category');
  const descriptionLoc = locations.get('description');
  const counterpartyLoc = locations.get('counterparty');

  const metadataCols: number[] = [];
  for (const [colStr, role] of Object.entries(roleByCol)) {
    if (role === 'metadata') metadataCols.push(parseInt(colStr, 10));
  }

  const headers = table.headers;
  const out: NormalizedRow[] = [];

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    if (!row) continue;
    const rowNumber = i + 1; // 1-based

    const date = readCell(row, dateLoc);
    const type = readCell(row, typeLoc);
    const amount = readCell(row, amountLoc);
    const currency = readCell(row, currencyLoc);
    const category = readCell(row, categoryLoc);
    const description = readCell(row, descriptionLoc);
    const counterparty = readCell(row, counterpartyLoc);

    const extraMetadata: Record<string, string> = {};
    for (const col of metadataCols) {
      const header = headers[col];
      if (header === undefined) continue;
      const value = row[col] ?? '';
      const trimmed = value.trim();
      if (trimmed === '') continue;
      // Strip the export-round-trip prefix `meta:` if present (the
      // exporter prepends it so the importer's mapper auto-routes the
      // column back to `metadata`).
      const key = header.startsWith('meta:') ? header.slice('meta:'.length) : header;
      extraMetadata[key] = trimmed;
    }

    out.push({
      rowNumber,
      date,
      type,
      amount,
      currency,
      category,
      description,
      counterparty,
      extraMetadata,
    });
  }

  return out;
}

function readCell(row: readonly string[], loc: RoleLocation | undefined): string | null {
  if (!loc) return null;
  const value = row[loc.column];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
