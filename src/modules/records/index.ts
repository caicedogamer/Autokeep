/*
 * Public surface of the records module.
 * Barrel re-exports only — no side effects on import.
 */

// Domain
export type {
  FinancialRecord,
  Category,
  Counterparty,
  FilterState,
  ConflictInfo,
  NewRecordInput,
  UpdateRecordInput,
  Id,
  MoneyMinor,
  IsoDate,
  IsoDateTime,
  CurrencyCode,
  BCP47Tag,
} from './domain/types.js';
export {
  EMPTY_FILTER,
  toId,
  toMoneyMinor,
  toIsoDate,
  toIsoDateTime,
  toCurrencyCode,
  toBCP47Tag,
} from './domain/types.js';

export {
  FinancialRecordSchema,
  CategorySchema,
  CounterpartySchema,
  FilterStateSchema,
  NewRecordInputSchema,
  UpdateRecordInputSchema,
} from './domain/schemas.js';

export {
  add as moneyAdd,
  subtract as moneySubtract,
  sum as moneySum,
  fromDecimalString,
  toDecimalString,
  formatCurrency,
  isValidMinorAmount,
} from './domain/money.js';

// Services
export {
  RecordsService,
  RecordNotFoundError,
  RecordConflictError,
} from './services/records-service.js';
export { RecordIndex } from './services/record-index.js';
export { CrossTabWatcher } from './services/cross-tab-watcher.js';

// UI
export { RecordsList } from './ui/records-list.js';
export { RecordForm } from './ui/record-form.js';
export { ConflictDialog } from './ui/conflict-dialog.js';
export { DeleteConfirm } from './ui/delete-confirm.js';
