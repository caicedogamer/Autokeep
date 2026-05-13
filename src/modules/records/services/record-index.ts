/*
 * RecordIndex — an in-memory secondary index over the decrypted records array.
 *
 * The workspace payload stores records as a plain array. The index builds a
 * Map keyed by Id to enable O(1) lookup and fast predicate-based filtering
 * without scanning the full array on every operation.
 *
 * Callers must call `rebuild()` after the payload is loaded or mutated
 * externally (cross-tab reload). All read operations return immutable copies
 * so consumers cannot inadvertently modify the in-memory state.
 */

import type { FinancialRecord, Id, FilterState, IsoDate, MoneyMinor } from '../domain/types.js';

export class RecordIndex {
  private map: Map<Id, FinancialRecord> = new Map();

  /** Rebuild the index from the current workspace payload array. */
  public rebuild(records: readonly FinancialRecord[]): void {
    this.map = new Map(records.map((r) => [r.id, r]));
  }

  public get(id: Id): FinancialRecord | undefined {
    return this.map.get(id);
  }

  public has(id: Id): boolean {
    return this.map.has(id);
  }

  public count(): number {
    return this.map.size;
  }

  /** All records sorted by date descending, then by createdAt descending. */
  public all(): FinancialRecord[] {
    return [...this.map.values()].sort(byDateDesc);
  }

  /**
   * Returns the subset of records matching `filter`. Runs synchronously on
   * the main thread for small datasets; the filter.worker handles larger
   * off-thread filtering (US2).
   */
  public filter(state: FilterState): FinancialRecord[] {
    const candidates = this.all();
    return candidates.filter((r) => matchesFilter(r, state));
  }

  /** Upsert a single record into the index. */
  public upsert(record: FinancialRecord): void {
    this.map.set(record.id, record);
  }

  /** Remove a record from the index. */
  public remove(id: Id): void {
    this.map.delete(id);
  }
}

/* ---------- Sort comparators ---------- */

const byDateDesc = (a: FinancialRecord, b: FinancialRecord): number => {
  const dateDiff = b.date.localeCompare(a.date);
  if (dateDiff !== 0) return dateDiff;
  return b.createdAt.localeCompare(a.createdAt);
};

/* ---------- Filter predicate ---------- */

const matchesFilter = (r: FinancialRecord, f: FilterState): boolean => {
  if (f.types.length > 0 && !f.types.includes(r.type)) return false;
  if (f.categoryIds.length > 0 && !f.categoryIds.includes(r.categoryId)) return false;
  if (f.counterpartyIds.length > 0) {
    if (!r.counterpartyId || !f.counterpartyIds.includes(r.counterpartyId)) return false;
  }
  if (f.dateFrom !== null && r.date < (f.dateFrom as string as IsoDate)) return false;
  if (f.dateTo !== null && r.date > (f.dateTo as string as IsoDate)) return false;
  if (f.amountMin !== null && r.amount < (f.amountMin as number as MoneyMinor)) return false;
  if (f.amountMax !== null && r.amount > (f.amountMax as number as MoneyMinor)) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const inDescription = r.description.toLowerCase().includes(q);
    if (!inDescription) return false;
  }
  return true;
};
