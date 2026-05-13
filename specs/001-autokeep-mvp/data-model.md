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

The current persisted-payload `schemaVersion` is **`1`**. Every persisted
record and every export carries this version (FR-005, FR-019). Migrations
between versions are an explicit concern of `core/storage/encrypted-store.ts`.

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
| `schemaVersion` | `1` | yes | |

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
| `createdAt` | `IsoDateTime` | yes | |
| `updatedAt` | `IsoDateTime` | yes | Equals `createdAt` on creation. |
| `schemaVersion` | `1` | yes | |

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
| `schemaVersion` | `1` | yes | |

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
| `schemaVersion` | `1` | yes | |

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
| `outcome` | `"imported-valid" \| "cancelled" \| "rejected-structural"` | yes | `rejected-structural` for files that failed structural validation per FR-015 (no rows touched). |
| `errorReportRef` | `string` | no | Identifier (or inline payload up to a small cap) for the per-row report; report payload itself is not persisted long-term beyond the operator's session unless they explicitly save it. |
| `schemaVersion` | `1` | yes | |

### Invariants

- `validRows + invalidRows === totalRows`.
- If `outcome === "rejected-structural"`, then `validRows === 0` and no
  `FinancialRecord` carries this `importBatchId`.
- If `outcome === "imported-valid"`, then exactly `validRows` records exist
  with this `importBatchId`.
- `outcome === "cancelled"` ⇒ no records exist with this `importBatchId`.

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
| `schemaVersion` | `1` | |

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
type WorkspacePayloadV1 = {
  schemaVersion: 1;
  workspace: Workspace;
  records: FinancialRecord[];
  categories: Category[];
  counterparties: Counterparty[];
  importBatches: ImportBatch[];
  inconsistencies: InconsistencyFinding[];
  settings: {
    aiEnabled: boolean;            // operator can disable AI subsystem (FR-029)
    suggestionMinSupport: number;  // default 5
    suggestionMinConfidence: number; // default 0.6
  };
};
```

A separate non-secret key holds the brute-force throttle counter (per
research R6) and the workspace's KDF descriptor mirror so we can render the
unlock UI without first decrypting:

```
autokeep:ws:<id>           → encrypted blob (per R6)
autokeep:ws:<id>:meta      → { kdf: KdfDescriptor, schemaVersion: 1 }
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
