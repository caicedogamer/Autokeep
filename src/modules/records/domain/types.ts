/*
 * Domain primitives and entity types for the records module.
 * No DOM imports. No I/O. Pure TypeScript branded types.
 */

/* ---------- Branded primitives ---------- */

/** Nominal UUID v4 string. */
export type Id = string & { readonly __brand: 'Id' };

/** Integer minor units (e.g., centavos). MUST be > 0 at the domain boundary. */
export type MoneyMinor = number & { readonly __brand: 'MoneyMinor' };

/** `YYYY-MM-DD` calendar date string. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

/** ISO-8601 UTC date-time string ending in `Z`. */
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' };

/** ISO 4217 currency code. */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

/** BCP-47 locale tag. */
export type BCP47Tag = string & { readonly __brand: 'BCP47Tag' };

/* ---------- Constructor helpers ---------- */

export const toId = (raw: string): Id => raw as Id;
export const toMoneyMinor = (raw: number): MoneyMinor => raw as MoneyMinor;
export const toIsoDate = (raw: string): IsoDate => raw as IsoDate;
export const toIsoDateTime = (raw: string): IsoDateTime => raw as IsoDateTime;
export const toCurrencyCode = (raw: string): CurrencyCode => raw as CurrencyCode;
export const toBCP47Tag = (raw: string): BCP47Tag => raw as BCP47Tag;

/* ---------- FinancialRecord entity ---------- */

export interface FinancialRecord {
  readonly id: Id;
  readonly date: IsoDate;
  readonly type: 'income' | 'expense';
  readonly amount: MoneyMinor;
  readonly categoryId: Id;
  readonly description: string;
  readonly counterpartyId?: Id;
  readonly source: 'manual' | 'import';
  readonly importBatchId?: Id;
  /** Optimistic-concurrency token (FR-036). Starts at 1; incremented on update. */
  readonly version: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: 1;
}

/** Input for creating a new record (operator-supplied; source + version assigned internally). */
export interface NewRecordInput {
  readonly date: IsoDate;
  readonly type: 'income' | 'expense';
  readonly amount: MoneyMinor;
  readonly categoryId: Id;
  readonly description: string;
  readonly counterpartyId?: Id;
}

/** Input for updating an existing record. `version` must match stored version (FR-036). */
export interface UpdateRecordInput {
  readonly id: Id;
  readonly version: number;
  readonly date?: IsoDate;
  readonly type?: 'income' | 'expense';
  readonly amount?: MoneyMinor;
  readonly categoryId?: Id;
  readonly description?: string;
  readonly counterpartyId?: Id | null;
}

/* ---------- Category entity ---------- */

export interface Category {
  readonly id: Id;
  /** 1–60 chars after trim. Unique within workspace (case-insensitive, NFC). */
  readonly name: string;
  readonly parentId?: Id;
  readonly learnedFromAi: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: 1;
}

export interface NewCategoryInput {
  readonly name: string;
  readonly parentId?: Id;
  readonly learnedFromAi?: boolean;
}

/* ---------- Counterparty entity ---------- */

export interface Counterparty {
  readonly id: Id;
  /** 1–120 chars after trim. Unique within workspace (case-insensitive, NFC). */
  readonly name: string;
  /** 0–10 aliases; each 1–120 chars. */
  readonly aliases: readonly string[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: 1;
}

export interface NewCounterpartyInput {
  readonly name: string;
  readonly aliases?: readonly string[];
}

/* ---------- FilterState value object ---------- */

export interface FilterState {
  readonly query: string;
  readonly dateFrom: IsoDate | null;
  readonly dateTo: IsoDate | null;
  readonly types: ReadonlyArray<'income' | 'expense'>;
  readonly categoryIds: readonly Id[];
  readonly counterpartyIds: readonly Id[];
  readonly amountMin: MoneyMinor | null;
  readonly amountMax: MoneyMinor | null;
}

export const EMPTY_FILTER: FilterState = {
  query: '',
  dateFrom: null,
  dateTo: null,
  types: [],
  categoryIds: [],
  counterpartyIds: [],
  amountMin: null,
  amountMax: null,
};

/* ---------- Conflict type (FR-036) ---------- */

export interface ConflictInfo {
  readonly recordId: Id;
  readonly storedVersion: number;
  readonly attemptedVersion: number;
  readonly stored: FinancialRecord;
}
