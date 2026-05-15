// Public surface of the `import` module.
//
// Two coexisting import paths:
//   - Legacy v1: `ImportService` + fixed-header `validateCsvRows` /
//     `validateJsonPayload`. Used by the existing UI until US3v2 rolls in.
//   - Flexible v2: `ImportPipeline` + per-stage modules (parsing,
//     inference, normalization, validation). Replaces v1 once the
//     `MappingPreview` UI is wired (T139/T140).

export type {
  // v1 / shared
  ValidationReport,
  ImportBatch,
  ParsedRow,
  ImportCtx,
  ImportBatchOutcome,
  // v2 (flexible import)
  RawTable,
  RawTableMeta,
  ColumnInference,
  SemanticRole,
  ColumnMapping,
  MappingSource,
  MappingDecision,
  MappingWarning,
  MappingWarningCode,
  InferenceReport,
  InferenceContext,
  NormalizedRow,
  FlexibleValidationReport,
  FlexibleParsedRow,
  FlexibleRowError,
  FlexibleRowErrorCode,
  ParserRejection,
  ParserRejectionCode,
  AmountConvention,
  DateFormatId,
  DecimalSeparator,
} from './domain/types.js';
export { REQUIRED_ROLES } from './domain/types.js';

// Legacy v1 validators
export { validateCsvRows } from './domain/csv-schema.js';
export type { ParsedCsvInput } from './domain/csv-schema.js';
export { validateJsonPayload } from './domain/json-schema.js';

// v2 pipeline stages
export { parseCsv } from './domain/parsing/csv-parser.js';
export type { CsvParseResult } from './domain/parsing/csv-parser.js';
export { parseJson } from './domain/parsing/json-parser.js';
export type { JsonParseResult } from './domain/parsing/json-parser.js';
export type { ColumnMapper } from './domain/inference/column-mapper.js';
export { HeuristicColumnMapper } from './domain/inference/heuristic-column-mapper.js';
export { inferColumn, detectCellType, dominantType } from './domain/inference/heuristics.js';
export { normalize } from './domain/normalization/normalizer.js';
export { validate } from './domain/validation/validator.js';

// Services
export type { ImportServiceDeps } from './services/import-service.js';
export { ImportService } from './services/import-service.js';
export { ImportPipeline } from './services/import-pipeline.js';
export type { ImportPipelineDeps, ParseResult } from './services/import-pipeline.js';

// UI
export type { FilePickerOpts } from './ui/file-picker.js';
export { FilePicker } from './ui/file-picker.js';
export { ValidationReportView } from './ui/validation-report.js';
export type { ValidationReportOpts } from './ui/validation-report.js';
export { ImportProgress } from './ui/import-progress.js';
