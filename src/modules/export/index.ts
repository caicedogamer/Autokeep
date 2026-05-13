// Public surface of the `export` module (US4).
export { serializeToCsv } from './domain/csv-serializer.js';
export type { CsvExportInput } from './domain/csv-serializer.js';
export { serializeToJson } from './domain/json-serializer.js';
export type {
  JsonExportInput,
  JsonExportPayload,
  JsonExportRecord,
} from './domain/json-serializer.js';
export type { ExportFormat, ExportOpts } from './services/export-service.js';
export { ExportService } from './services/export-service.js';
export { EncryptedExport } from './services/encrypted-export.js';
export type { EncryptedExportPayload } from './services/encrypted-export.js';
export type { ExportDialogOpts } from './ui/export-dialog.js';
export { ExportDialog } from './ui/export-dialog.js';
