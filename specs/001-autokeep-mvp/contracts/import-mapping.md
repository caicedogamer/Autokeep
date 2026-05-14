# Contract: Column Inference & Mapping (shared by CSV / JSON pipelines)

**Owner module**: `src/modules/import/domain/inference/`
**Consumers**: [import-csv.schema.md](import-csv.schema.md), [import-json.schema.md](import-json.schema.md), `src/modules/import/services/import-pipeline.ts`, `src/modules/import/ui/mapping-preview.ts`
**Spec refs**: FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049

This contract fixes the types and rules that the inference + mapping stage produces and consumes. It is shared by both file formats so the operator-facing preview UI and the audit trail on `ImportBatch` are identical regardless of source.

---

## 1. Semantic roles

```ts
type SemanticRole =
  | 'date'           // required
  | 'type'           // required
  | 'amount'         // required
  | 'category'       // required
  | 'description'    // required
  | 'counterparty'   // optional
  | 'currency'       // optional
  | 'metadata'       // unmapped — value preserved on FinancialRecord.extraMetadata
  | 'ignore';        // unmapped — value dropped permanently
```

- **Required roles (5)**: `date`, `type`, `amount`, `category`, `description`. The pipeline refuses to proceed to normalization if any required role is unmapped after operator confirmation (`MISSING_REQUIRED_ROLE`).
- **Optional roles (2)**: `counterparty`, `currency`. Absence is acceptable.
- **Non-canonical sinks**: `metadata` preserves the cell value under `FinancialRecord.extraMetadata[originalHeader]`; `ignore` drops it.

---

## 2. Column-level inference output

```ts
type ColumnInference = {
  columnIndex: number;              // 0-based index in RawTable.headers
  header: string;                   // original header, or synthesized "col_N" if absent
  inferredType: 'string' | 'number' | 'date' | 'enum' | 'boolean';
  inferredRole: SemanticRole;       // the role with the highest composite confidence
  confidence: number;                // [0, 1] — composite of headerScore (0.6) + valueScore (0.4)
  alternativeRoles: Array<{
    role: SemanticRole;
    confidence: number;
  }>;                                // top-2 alternatives, sorted desc by confidence
  sampleSize: number;                // rows considered (≤ 200)
  mismatchRate: number;              // share of sampled rows whose value did NOT match inferredType
};

type InferenceReport = {
  columns: ColumnInference[];
  globalWarnings: MappingWarning[];  // cross-column warnings, e.g. AMBIGUOUS_ROLE, MISSING_REQUIRED_ROLE
};
```

---

## 3. Mapping decision (operator output)

```ts
type ColumnMapping = Record<number, SemanticRole | 'ignore' | 'metadata'>;
// keyed by columnIndex; every column from RawTable MUST have an entry

type MappingSource = 'auto' | 'manual' | 'mixed';

type MappingDecision = {
  mapping: ColumnMapping;
  source: MappingSource;
  warnings: MappingWarning[];        // unresolved warnings the operator chose to override
  confirmedAt: IsoDateTime;
  amountConvention?: 'minor-units' | 'major-decimal';
                                     // applies when the inferred amount column needed disambiguation
                                     // (typical for JSON imports; not required for CSV with decimal strings)
  dateFormatPerColumn?: Record<number, 'iso' | 'dd-mm-yyyy' | 'mm-dd-yyyy'>;
                                     // applies when the inferrer flagged AMBIGUOUS_DATE_FORMAT
  decimalSeparatorPerColumn?: Record<number, '.' | ','>;
                                     // applies when the inferrer flagged AMBIGUOUS_DECIMAL_SEPARATOR
  typeCanonicalization?: Record<string, 'income' | 'expense'>;
                                     // when the type column uses a non-standard vocabulary (e.g., 'I'/'E', 'CR'/'DB')
                                     // operator confirms the mapping in the preview
};
```

`source: 'mixed'` is set when the operator accepts most of the auto-inferred mapping but overrides at least one column. Both `'auto'` and `'manual'` are precise: `'auto'` means **zero** manual edits, `'manual'` means **every** column was set by hand (used when the inferrer's confidence was below threshold globally).

---

## 4. Warnings

```ts
type MappingWarning =
  | { code: 'AMBIGUOUS_ROLE'; role: SemanticRole; candidateColumns: number[] }
  | { code: 'LOW_CONFIDENCE'; columnIndex: number; bestConfidence: number }
  | { code: 'MIXED_TYPE_COLUMN'; columnIndex: number; dominantType: string; mismatchRate: number }
  | { code: 'MISSING_REQUIRED_ROLE'; role: SemanticRole }
  | { code: 'CURRENCY_DIFFERS_FROM_WORKSPACE'; columnIndex: number; sampleValues: string[] }
  | { code: 'AMBIGUOUS_DATE_FORMAT'; columnIndex: number; candidates: Array<'dd-mm-yyyy' | 'mm-dd-yyyy' | 'iso'> }
  | { code: 'AMBIGUOUS_DECIMAL_SEPARATOR'; columnIndex: number; candidates: Array<'.' | ','> }
  | { code: 'AMBIGUOUS_AMOUNT_CONVENTION'; columnIndex: number; candidates: Array<'minor-units' | 'major-decimal'> };
```

### Warning rules

| Code | Trigger | Resolvable without manual override? |
|---|---|---|
| `AMBIGUOUS_ROLE` | Two or more columns have `confidence` for the same required role with `Δ < 0.1` | **No** — operator MUST pick |
| `LOW_CONFIDENCE` | Best candidate for a required role has `confidence < 0.5` | **No** — operator MUST confirm or reassign |
| `MIXED_TYPE_COLUMN` | `mismatchRate > 0.1` in the sample | Yes (but flagged in preview) |
| `MISSING_REQUIRED_ROLE` | No column has `inferredRole === role` or operator unset it | **No** — blocks confirm |
| `CURRENCY_DIFFERS_FROM_WORKSPACE` | Sample contains values ≠ workspace currency | **No** — operator must accept (and import will reject rows) or remap |
| `AMBIGUOUS_DATE_FORMAT` | Sample is ambiguous between DD/MM and MM/DD | **No** — operator picks |
| `AMBIGUOUS_DECIMAL_SEPARATOR` | Sample uses both `.` and `,` in plausibly-numeric values | **No** — operator picks |
| `AMBIGUOUS_AMOUNT_CONVENTION` | Numeric values plausibly fit both minor-units and major-decimal interpretations (e.g., all integers) | **No** — operator picks |

The confirm button in the preview UI is disabled while any **non-resolvable** warning is unresolved.

---

## 5. Auto-confirm thresholds

The pipeline auto-confirms (no operator interaction beyond a single "Confirmar" click) **only** when ALL of the following hold:

1. Every required role has `inferredRole === role` for exactly one column, with `confidence ≥ 0.8`.
2. No `AMBIGUOUS_ROLE`, `AMBIGUOUS_DATE_FORMAT`, `AMBIGUOUS_DECIMAL_SEPARATOR`, or `AMBIGUOUS_AMOUNT_CONVENTION` warnings are present.
3. If a currency column is detected, every sampled value equals the workspace currency.
4. No `MIXED_TYPE_COLUMN` warning is present on a column mapped to a required role.

When auto-confirmable, the mapping preview still renders so the operator can review and override, but a single click proceeds. `MappingDecision.source === 'auto'`.

---

## 6. ColumnMapper interface

```ts
// src/modules/import/domain/inference/column-mapper.ts
export interface ColumnMapper {
  infer(table: RawTable, ctx: InferenceContext): InferenceReport;
}

export type InferenceContext = {
  workspaceCurrency: CurrencyCode;
  workspaceCurrencyMinorUnits: 0 | 2 | 3;
  workspaceLocale: BCP47Tag;        // affects date heuristics (es-AR favors DD/MM)
  sampleSizeLimit: number;          // default 200
};
```

**Implementations**:

- `HeuristicColumnMapper` — the only MVP implementation. Uses the regex + sampling rules documented in [import-csv.schema.md §Stage 2](import-csv.schema.md). Pure function (no I/O, no DOM), trivially unit-testable.
- *Reserved for post-MVP*: `AiColumnMapper` — drop-in replacement that calls a local model. Must satisfy the same interface; no other module needs to change (FR-048).

Selection is wired in `import-pipeline.ts` and exposed via a single env-flag toggle so the AI variant can be swapped in for evaluation without code edits to consumers.

---

## 7. Determinism & testability

- `HeuristicColumnMapper.infer()` MUST be deterministic for a given `(RawTable, InferenceContext)`.
- The output `confidence` and `alternativeRoles` ordering MUST be stable across runs (any internal tie-breaker is on `columnIndex` asc).
- The 20-file reference set used to validate SC-017 lives under `tests/fixtures/heterogeneous/` and includes synthetic bank-statement exports (es and en), ERP exports (wrapped JSON), manual spreadsheets (CSV with semicolon), and NDJSON exports. Each fixture has a paired `expected-mapping.json` that the test suite compares against the inferrer's output.

---

## 8. Reserved header prefix for round-trip from AutoKeep exports

The flexible importer recognizes headers prefixed `meta:` and **always**
maps them to the `metadata` role with `confidence: 1.0` (no operator
confirmation needed for these specific columns). This is how AutoKeep's
own CSV/JSON exports (see [export-csv.schema.md](export-csv.schema.md)
and [export-json.schema.md](export-json.schema.md)) survive an
export → re-import round-trip with `extraMetadata` intact — required by
**SC-019** and **FR-044**.

On normalization the `meta:` prefix is stripped from the header before
the key is stored in `FinancialRecord.extraMetadata`:

```
header "meta:internalId" with value "INV-12345"
  → extraMetadata["internalId"] = "INV-12345"
```

The prefix is purely a transport convention for export round-trip; it
does not appear in the in-memory data model.

---

## 9. Audit trail

Every successful import persists the `MappingDecision` and the `InferenceReport` on `ImportBatch`. This is the only artifact retained long-term from the import session (the per-row `ValidationReport` is offered as a download but not persisted) and serves three purposes:

1. **Traceability**: if a record looks wrong months later, the audit trail explains which column it came from and how the operator interpreted the file.
2. **Reproducibility**: a future "re-import this file" feature could replay the mapping decision without re-prompting the operator (post-MVP).
3. **Heuristic improvement**: the auto-vs-manual override rate informs whether the heuristic needs tuning or whether the AI variant should be developed.
