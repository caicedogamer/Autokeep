# Phase 1 Data Model: AutoKeep MVP

**Branch**: `001-autokeep-mvp`
**Date**: 2026-05-12
**Spec**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)

This document fixes the **conceptual** data model for the MVP, derived from
the spec's `Key Entities` section and the FR/SC requirements. All types
are pure TypeScript with **no DOM imports** (Constitution Principle II).
Persistence rules are described in terms of the `StorageAdapter` contract;
the on-disk shape is the encrypted blob defined in
[contracts/storage-adapter.md](contracts/storage-adapter.md).

The current persisted-payload `schemaVersion` is **`2`**. Every persisted
record and every export carries this version (FR-005, FR-019). Migrations
between versions are an explicit concern of `core/storage/encrypted-store.ts`;
the v1 → v2 migration adds the optional `FinancialRecord.extraMetadata`
field (defaulted to `{}` when reading v1 payloads), extends `ImportBatch`
with `mappingDecision` and `inferenceReport` (defaulted to a synthetic
"legacy fixed-header" decision on v1 reads), and bumps every entity's
`schemaVersion` field on write.

---

## Conventions

- **IDs**: every entity that is referenced by another entity uses a UUID v4
  string (`Id`). UUIDs are generated client-side via `crypto.randomUUID()`.
- **Money**: amounts are stored as **integer minor units** (e.g., centavos
  for ARS, cents for USD) to avoid floating-point error in totals (SC-006:
  "match an independently computed expected value to the cent"). The
  workspace setting carries the active currency code (ISO 4217) and the
  number of minor-unit digits.
- **Timestamps**: `createdAt` / `updatedAt` are ISO-8601 UTC strings
  (e.g., `"2026-05-12T14:03:11.482Z"`).
- **Dates** (event date of a record): `YYYY-MM-DD` strings, no time.
- **Strings**: trimmed at the domain boundary; empty strings are normalized
  to `null` for optional fields.
- **Optionality**: `?` denotes "may be absent"; `null` is used for "known to
  be absent" only when round-tripping through JSON exports.

---

## Entity: `Workspace`

A single operator workspace. There is exactly one `Workspace` per
encrypted blob.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `Id` (UUID v4) | yes | Stable workspace identifier; reused as the storage-adapter key suffix. |
| `name` | `string` | yes | Operator-chosen label (e.g., "Tienda Centro"). 1–80 chars. |
| `currency` | `CurrencyCode` (ISO 4217, 3 letters) | yes | E.g., `"ARS"`, `"USD"`. Single per workspace per Assumption. |
| `currencyMinorUnits` | `0 \| 2 \| 3` | yes | Most currencies = 2; CLP/JPY = 0; some MENA = 3. Used for input parsing and display. |
| `locale` | `BCP47Tag` (`"es"` default) | yes | Selectable; default `"es"` per FR-039. |
| `kdf` | `KdfDescriptor` | yes | `{ name: "argon2id" \| "pbkdf2-sha256", salt: base64, params: ... }`. Recorded so `unlock` can reproduce the derivation. |
| `createdAt` | `IsoDateTime` | yes | |
| `updatedAt` | `IsoDateTime` | yes | |
| `schemaVersion` | `2` | yes | |

### Invariants

- `currency`, `currencyMinorUnits`, and `locale` are immutable for the life
  of the workspace once data exists. Changing them post-MVP requires an
  explicit migration flow (out of scope here).
- `kdf` is set at workspace creation. Re-encrypting under a new
  passphrase (FR-040) updates `kdf.salt` and re-derives the key; `kdf.name`
  may change if the operator's environment newly supports / no longer
  supports Argon2id.
- The plaintext passphrase is never present in this entity.

---

## Entity: `FinancialRecord`

A single income or expense event (spec: *Financial Record*).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `Id` | yes | UUID v4. |
| `date` | `IsoDate` (`YYYY-MM-DD`) | yes | Event date in the operator's locale. |
| `type` | `"income" \| "expense"` | yes | Discriminated union. |
| `amount` | `MoneyMinor` (`number` non-negative integer) | yes | Stored in minor units; **strictly positive** at the domain boundary (FR-003). Zero rejected. |
| `categoryId` | `Id` | yes | FK → `Category.id`. |
| `description` | `string` | yes | 1–280 chars after trim. |
| `counterpartyId` | `Id` | no | FK → `Counterparty.id`. Optional. |
| `source` | `"manual" \| "import"` | yes | Derived at creation; never edited. |
| `importBatchId` | `Id` | no | Set iff `source === "import"`; FK → `ImportBatch.id`. |
| `version` | `number` (positive integer) | yes | **Optimistic-concurrency token (FR-036)**. Incremented on every successful update. |
| `extraMetadata` | `Record<string, string>` | no | Preserved from unmapped columns during flexible import (FR-044). Defaults to `{}`. Per-record limits: ≤ 10 keys, each key ≤ 60 chars, each value ≤ 200 chars (enforced at validation; rows exceeding the limits are rejected with `METADATA_*` reason codes per [import-csv.schema.md](../contracts/import-csv.schema.md)). |
| `createdAt` | `IsoDateTime` | yes | |
| `updatedAt` | `IsoDateTime` | yes | Equals `createdAt` on creation. |
| `schemaVersion` | `2` | yes | Records persisted under v1 (without `extraMetadata`) are migrated on read to `extraMetadata: {}`. |

### Invariants & validation rules

- `amount > 0` (FR-003).
- `description` non-empty after trim (FR-002).
- `categoryId` MUST resolve to an existing `Category` in the workspace.
  Deleting a category is gated on no records referencing it (or the UI
  forces a re-categorization first).
- `counterpartyId`, when present, MUST resolve to an existing
  `Counterparty`.
- `date` MUST be a valid calendar date; future dates are allowed (an
  operator may pre-record a scheduled invoice).
- `extraMetadata` keys MUST be unique within a record and MUST NOT shadow
  any canonical field name (`date`, `type`, `amount`, `category`,
  `description`, `counterparty`, `currency`, `id`, `version`,
  `schemaVersion`, `createdAt`, `updatedAt`, `source`, `importBatchId`).
- `(date, amount, type, description, counterpartyId)` is **NOT** required
  to be unique — duplicates are detected by the AI subsystem (US6) and the
  import flow (US3 edge case "Duplicate detection on import"), not the
  domain.
- `version` MUST start at `1` on creation and increment by exactly `1` on
  each accepted update. A save attempt whose `version` does not match the
  in-storage value MUST be rejected per FR-036.

### State transitions

```
[absent] --create--> {version: 1, source: manual|import}
{version: n} --update(if storedVersion == n)--> {version: n+1}
{version: n} --update(if storedVersion != n)--> REJECTED (FR-036 conflict)
{version: n} --delete--> [absent]
```

There is **no soft-delete** in the MVP. Delete is final; the operator's
backup channel is the export feature.

---

## Entity: `Category`

A label used to classify records.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `Id` | yes | UUID v4. |
| `name` | `string` | yes | 1–60 chars after trim. **Unique within the workspace, case-insensitive** (deferred Q from `/speckit-clarify`; resolved here). |
| `parentId` | `Id` | no | Optional FK → `Category.id` for grouping; depth ≤ 2 in the MVP (no deep trees). |
| `learnedFromAi` | `boolean` | yes | `true` if the category was first introduced through an AI-suggested record. Default `false`. |
| `createdAt` | `IsoDateTime` | yes | |
| `updatedAt` | `IsoDateTime` | yes | |
| `schemaVersion` | `2` | yes | |

### Invariants

- Lower-cased, NFC-normalized `name` is unique within a workspace.
- `parentId !== id` (no self-parent); no cycles.
- A `Category` MUST NOT be deleted while any `FinancialRecord` references
  it; the UI offers a "merge into another category" path which rewrites
  references in a single batch and bumps the affected records' `version`.

---

## Entity: `Counterparty`

The other side of a transaction (supplier or client).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `Id` | yes | UUID v4. |
| `name` | `string` | yes | 1–120 chars after trim. **Unique within the workspace, case-insensitive**. |
| `aliases` | `string[]` | yes | 0–10 aliases; each 1–120 chars. Used for free-text search and AI suggestion matching. |
| `createdAt` | `IsoDateTime` | yes | |
| `updatedAt` | `IsoDateTime` | yes | |
| `schemaVersion` | `2` | yes | |

### Invariants

- Lower-cased, NFC-normalized `name` is unique within a workspace; aliases
  MAY repeat across counterparties but the UI surfaces a warning when an
  alias collides.
- A `Counterparty` MUST NOT be deleted while any `FinancialRecord`
  references it; merge-into is the supported path.

---

## Entity: `ImportBatch`

Persistent record of one import operation (spec: *Import Batch*).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `Id` | yes | UUID v4. |
| `filename` | `string` | yes | As reported by the file picker. |
| `format` | `"csv" \| "json"` | yes | |
| `importedAt` | `IsoDateTime` | yes | When the operator confirmed the import. |
| `totalRows` | `number` (≥ 0) | yes | |
| `validRows` | `number` (≥ 0) | yes | |
| `invalidRows` | `number` (≥ 0) | yes | |
| `outcome` | `"imported-valid" \| "cancelled" \| "rejected-structural"` | yes | `rejected-structural` for files that failed **parser-level** validation per FR-015 (no rows touched). Header / mapping mismatches are NOT structural rejections in v2. |
| `errorReportRef` | `string` | no | Identifier (or inline payload up to a small cap) for the per-row report; report payload itself is not persisted long-term beyond the operator's session unless they explicitly save it. |
| `inferenceReport` | `InferenceReport` | yes | Per-column type/role/confidence/alternatives produced by the `ColumnMapper` (FR-042). Persisted for audit (FR-043). See [contracts/import-mapping.md](../contracts/import-mapping.md). |
| `mappingDecision` | `MappingDecision` | yes | The operator-confirmed column → role mapping with `source: 'auto' \| 'manual' \| 'mixed'`, warnings raised during inference, and the confirmation timestamp. Persisted for audit (FR-043). |
| `schemaVersion` | `2` | yes | Batches persisted under v1 are migrated on read to a synthetic decision representing the v1 fixed-header schema (`source: 'auto'`, mapping derived from the canonical column order). |

### Invariants

- `validRows + invalidRows === totalRows`.
- If `outcome === "rejected-structural"`, then `validRows === 0` and no
  `FinancialRecord` carries this `importBatchId`; `mappingDecision` MAY
  be absent because the file never reached stage 3.
- If `outcome === "imported-valid"`, then exactly `validRows` records exist
  with this `importBatchId`, and `mappingDecision.confirmedAt` MUST be
  set.
- `outcome === "cancelled"` ⇒ no records exist with this `importBatchId`.
  `mappingDecision` is set iff the operator at least reached the
  confirmation step before cancelling.
- Every column referenced in `mappingDecision.mapping` MUST appear in
  `inferenceReport.columns` (same `columnIndex` values).

---

## Value object: `RawTable` (import stage 1 output)

Produced by `src/modules/import/domain/parsing/` for both CSV and JSON
imports. Decoupled from semantic meaning — the same shape is consumed by
the inferrer, the normalizer, and the validator regardless of source
format.

| Field | Type | Notes |
|---|---|---|
| `headers` | `string[]` | Original column names; synthesized as `col_1`, `col_2`, … when absent (CSV with no header row, or unwrapped JSON with heterogeneous keys). |
| `rows` | `string[][]` | Every cell stringified (numbers / booleans coerced to their canonical decimal/boolean string at parse time). Length of every inner array equals `headers.length`; short rows are padded with empty strings. |
| `meta` | `RawTableMeta` | Parser-derived metadata for the UI (delimiter, line endings, JSON shape, etc.). See contract files. |

---

## Value object: `ColumnInference` (import stage 2 output)

One per column in `RawTable`. Produced by any `ColumnMapper`
implementation; see [contracts/import-mapping.md](../contracts/import-mapping.md).

| Field | Type | Notes |
|---|---|---|
| `columnIndex` | `number` | 0-based; matches `RawTable.headers`. |
| `header` | `string` | Original or synthesized. |
| `inferredType` | `'string' \| 'number' \| 'date' \| 'enum' \| 'boolean'` | Dominant type across the sampled rows. |
| `inferredRole` | `SemanticRole` | Highest-composite-confidence role. |
| `confidence` | `number` (`[0, 1]`) | `0.6 * headerScore + 0.4 * valueScore`. |
| `alternativeRoles` | `Array<{role: SemanticRole; confidence: number}>` | Top-2 next candidates, sorted desc. |
| `sampleSize` | `number` | Rows considered; ≤ 200. |
| `mismatchRate` | `number` (`[0, 1]`) | Share of sampled rows whose value did not match `inferredType`. |

---

## Type: `SemanticRole`

```ts
type SemanticRole =
  | 'date' | 'type' | 'amount' | 'category' | 'description'  // required
  | 'counterparty' | 'currency'                                // optional
  | 'metadata' | 'ignore';                                     // sinks
```

The five required roles MUST each be present in any `MappingDecision`
that the operator confirms (FR-045).

---

## Value object: `ColumnMapping`

```ts
type ColumnMapping = Record<number, SemanticRole>;
```

Keyed by `columnIndex`. **Every** column from `RawTable.headers` MUST
have an entry. Operators select `'ignore'` or `'metadata'` for columns
without a canonical role.

---

## Value object: `MappingDecision` (import stage 3 output)

| Field | Type | Notes |
|---|---|---|
| `mapping` | `ColumnMapping` | The confirmed column → role assignments. |
| `source` | `'auto' \| 'manual' \| 'mixed'` | `'auto'` = zero manual edits; `'manual'` = every column set by hand; `'mixed'` = at least one operator override on top of auto-inferred mapping. |
| `warnings` | `MappingWarning[]` | Unresolved warnings the operator chose to override (or that don't block confirmation — e.g. `MIXED_TYPE_COLUMN`). |
| `confirmedAt` | `IsoDateTime` | Timestamp of the operator's confirm action. |
| `amountConvention` | `'minor-units' \| 'major-decimal'` | Required when the inferrer flagged `AMBIGUOUS_AMOUNT_CONVENTION` (typical for integer-only JSON values). |
| `dateFormatPerColumn` | `Record<number, 'iso' \| 'dd-mm-yyyy' \| 'mm-dd-yyyy'>` | Required when `AMBIGUOUS_DATE_FORMAT` was flagged. |
| `decimalSeparatorPerColumn` | `Record<number, '.' \| ','>` | Required when `AMBIGUOUS_DECIMAL_SEPARATOR` was flagged. |
| `typeCanonicalization` | `Record<string, 'income' \| 'expense'>` | Maps the source vocabulary (e.g. `{I: 'income', E: 'expense'}`) to the canonical type values. |

Persisted on `ImportBatch` for audit. The full schema and the warning
catalog live in
[contracts/import-mapping.md](../contracts/import-mapping.md).

---

## Value object: `MappingWarning`

Tagged union with one variant per warning code. Full catalog (with
trigger conditions and confirmability) lives in
[contracts/import-mapping.md §4](../contracts/import-mapping.md#4-warnings).
Codes referenced from the data model: `AMBIGUOUS_ROLE`, `LOW_CONFIDENCE`,
`MIXED_TYPE_COLUMN`, `MISSING_REQUIRED_ROLE`,
`CURRENCY_DIFFERS_FROM_WORKSPACE`, `AMBIGUOUS_DATE_FORMAT`,
`AMBIGUOUS_DECIMAL_SEPARATOR`, `AMBIGUOUS_AMOUNT_CONVENTION`.

---

## Value object: `InferenceReport`

The full output of stage 2. Persisted on `ImportBatch`.

| Field | Type | Notes |
|---|---|---|
| `columns` | `ColumnInference[]` | One per column in `RawTable`. |
| `globalWarnings` | `MappingWarning[]` | Cross-column warnings (`AMBIGUOUS_ROLE`, `MISSING_REQUIRED_ROLE`). |

---

## Value object: `ValidationReport`

Produced for every import; **not persisted long-term** (per spec). Used to
drive the import UI.

| Field | Type | Notes |
|---|---|---|
| `structural` | `{ ok: true } \| { ok: false; reason: string }` | Result of header/structure check (FR-015). |
| `rows` | `Array<{ rowNumber: number; status: "valid" \| "invalid"; reason?: string; raw: unknown }>` | One entry per parsed row. `reason` populated iff `invalid`. |
| `totals` | `{ total: number; valid: number; invalid: number }` | Convenience sums for the UI. |

---

## Value object: `FilterState`

Drives records view, exports, and dashboard scope.

| Field | Type | Notes |
|---|---|---|
| `query` | `string` | Trimmed free-text. Empty ⇒ no text filter. |
| `dateFrom` | `IsoDate \| null` | Inclusive lower bound. |
| `dateTo` | `IsoDate \| null` | Inclusive upper bound. |
| `types` | `Array<"income" \| "expense">` | Empty = both. |
| `categoryIds` | `Id[]` | Empty = all categories. |
| `counterpartyIds` | `Id[]` | Empty = all counterparties (and uncategorized). |
| `amountMin` | `MoneyMinor \| null` | Inclusive. |
| `amountMax` | `MoneyMinor \| null` | Inclusive. |

### Invariants

- If both `dateFrom` and `dateTo` are present, `dateFrom <= dateTo`.
- If both `amountMin` and `amountMax` are present, `amountMin <= amountMax`.
- All ids referenced exist in the workspace; stale ids (e.g., a deleted
  category) MUST be pruned from the active filter on load with a non-
  blocking notice.

---

## Value object: `DashboardPeriod`

| Field | Type | Notes |
|---|---|---|
| `kind` | `"thisMonth" \| "lastMonth" \| "thisQuarter" \| "lastQuarter" \| "thisYear" \| "custom"` | Presets + custom. |
| `from` | `IsoDate` | Inclusive (derived for presets, supplied for `custom`). |
| `to` | `IsoDate` | Inclusive. |

The dashboard scope = `FilterState ∧ DashboardPeriod` (intersection).

---

## Entity: `Suggestion` (US6)

Computed on demand; **not persisted as a long-lived entity**, but the type
is fixed so producers and consumers agree.

| Field | Type | Notes |
|---|---|---|
| `targetRecordDraft` | `Partial<FinancialRecord>` | The draft that triggered the suggestion. |
| `proposedCategoryId` | `Id` | |
| `confidence` | `number` (0..1) | Surface as a textual indicator; do not show raw decimals to the operator. |
| `basis` | `Array<{ recordId: Id; reason: "exact-counterparty" \| "token-overlap" }>` | Explainability hook (Principle VI / accessibility audit). |

### Rules

- A `Suggestion` MUST NOT be auto-applied (FR-026).
- A `Suggestion` MUST NOT be presented when `confidence < threshold` or
  when `basis.length < minSupport`. These thresholds are tunable in the AI
  service config.

---

## Entity: `InconsistencyFinding` (US6)

Periodically computed; **persisted while open**, removed when resolved or
dismissed.

| Field | Type | Notes |
|---|---|---|
| `id` | `Id` | UUID v4. |
| `targetRecordId` | `Id` | FK → `FinancialRecord.id`. |
| `kind` | `"category-mismatch" \| "amount-outlier" \| "likely-duplicate"` | |
| `reason` | `string` | Operator-readable, in Spanish (FR-038). |
| `basis` | `Id[]` | Records that informed the finding (e.g., the dominant counterparty/category set, or the candidate duplicates). |
| `status` | `"open" \| "dismissed" \| "resolved-by-edit"` | |
| `createdAt` | `IsoDateTime` | yes |
| `updatedAt` | `IsoDateTime` | yes |
| `schemaVersion` | `2` | |

### State transitions

```
[absent] --detect--> {status: open}
{status: open} --operator dismisses--> {status: dismissed}
{status: open} --target record edited so finding no longer applies--> {status: resolved-by-edit}
```

`dismissed` and `resolved-by-edit` findings are kept long enough to avoid
re-flagging the same record on the next pass within a tunable window
(default: 30 days), then garbage-collected.

---

## Workspace-level relationships

```
Workspace 1───* FinancialRecord *───1 Category
                       │
                       *───1 Counterparty (optional)
                       │
                       *───1 ImportBatch (optional, only if source = "import")

Workspace 1───* Category (parentId optional self-FK, depth ≤ 2)
Workspace 1───* Counterparty
Workspace 1───* InconsistencyFinding *───1 FinancialRecord
```

---

## Persistence layout (encrypted blob)

The plaintext payload that gets serialized → encrypted → written via
`StorageAdapter.set(key, ciphertext)`:

```ts
type WorkspacePayloadV2 = {
  schemaVersion: 2;
  workspace: Workspace;
  records: FinancialRecord[];      // each may carry an extraMetadata bag
  categories: Category[];
  counterparties: Counterparty[];
  importBatches: ImportBatch[];    // each carries mappingDecision + inferenceReport
  inconsistencies: InconsistencyFinding[];
  settings: {
    aiEnabled: boolean;            // operator can disable AI subsystem (FR-029)
    suggestionMinSupport: number;  // default 5
    suggestionMinConfidence: number; // default 0.6
  };
};
```

### v1 → v2 migration (read-side)

`core/storage/encrypted-store.ts` dispatches by `schemaVersion`:

- v1 payloads are read with the legacy schema, then transformed in
  memory:
  - Every `FinancialRecord` gets `extraMetadata: {}`.
  - Every `ImportBatch` whose `outcome === 'imported-valid'` gets a
    synthetic `inferenceReport` and `mappingDecision` representing the
    v1 fixed-header schema (`mapping.source: 'auto'`, `confirmedAt =
    importedAt`); v1 batches whose `outcome === 'rejected-structural'`
    keep `mappingDecision` absent.
  - `schemaVersion` on every entity and on the wrapper is bumped to `2`.
- The migrated payload is written back on the next successful workspace
  write (no eager re-encryption pass — migration is lazy, on first
  mutation).
- v2 payloads pass through unchanged.

A separate non-secret key holds the brute-force throttle counter (per
research R6) and the workspace's KDF descriptor mirror so we can render the
unlock UI without first decrypting:

```
autokeep:ws:<id>           → encrypted blob (per R6)
autokeep:ws:<id>:meta      → { kdf: KdfDescriptor, schemaVersion: 2 }
autokeep:ws:<id>:throttle  → { failedAttempts: number; lastAttemptAt: IsoDateTime }
```

`StorageAdapter` only ever sees opaque keys + opaque byte arrays; the
encryption boundary lives in `core/storage/encrypted-store.ts`.

---

## Capacity rules (FR-041)

- `records.length` is the count used to evaluate FR-041 thresholds.
- At `records.length >= 8000`, the records module emits a non-blocking
  capacity warning (the Workspace store carries a derived `capacityState`
  selector: `"ok" | "soft-warning" | "hard-cap"`).
- At `records.length >= 12000`, all create-record and import-commit code
  paths MUST hard-fail with a typed `CapacityExceededError`. Read paths
  (filter, dashboard, export, edit, delete) remain unaffected.
- The capacity gate lives in `src/modules/workspace/services/` so neither
  the records module nor the import module needs to duplicate the logic.
