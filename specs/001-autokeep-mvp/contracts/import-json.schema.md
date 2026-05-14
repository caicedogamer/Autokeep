# Contract: JSON Import Pipeline (v2)

**Owner module**: `src/modules/import/domain/`
**Pipeline**: shares stages 2–6 with [import-csv.schema.md](import-csv.schema.md). Only stage 1 (parsing) differs.

**Spec refs**: FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049
**Versioning**: this is **v2**. Replaces the v1 fixed-envelope contract entirely. The wrapper `{schemaVersion, currency, currencyMinorUnits, records[]}` is **no longer required** — the importer accepts heterogeneous JSON shapes and treats the inner objects as rows.

> See [import-mapping.md](import-mapping.md) for the inference + mapping contract shared between CSV and JSON paths.

---

## Stage 1 — Parsing

**Goal**: decode the file into a `RawTable` (the same shape produced by the CSV parser) without making any assumption about column meaning.

### Accepted top-level shapes

The JSON parser recognizes **three** structures and converts each into a `RawTable`. The detection runs in order; the first match wins.

#### 1. Array of objects (preferred)

```json
[
  { "date": "2026-04-02", "amount": 15000.00, ... },
  { "date": "2026-04-03", "amount": 2350.50,  ... }
]
```

- Every object is a row. The **union of keys** across all objects becomes the header set (object iteration order is preserved per ES2017+, so headers come out in a stable order).
- Rows with missing keys produce `null` cells (treated as "empty" by the validator).
- Rows with extra keys produce extra columns (treated as `metadata` by default).

#### 2. Wrapped array under any plausible key

```json
{ "records": [ {...}, {...} ] }
{ "data":    [ {...}, {...} ], "exportedAt": "2026-04-30T..." }
{ "transactions": [...] }
```

The parser scans the top-level keys for the first one whose value is a non-empty array of objects. Candidate keys, in priority order:

```
records, data, transactions, items, movements,
rows, entries, list, payload, results
```

If multiple candidates exist, the one that appears **first in the object** wins; the rest of the top-level fields are reported in `meta.wrapperFields` so the operator can decide whether to preserve any of them as workspace-level metadata (not in MVP — currently reported for transparency only).

#### 3. NDJSON / JSON-Lines

One JSON object per line (with optional trailing newline). The parser falls back to this shape when the top-level is neither an array nor an object whose values include a candidate array.

### Output type

```ts
type RawTable = {
  headers: string[];        // union of object keys, stable order
  rows: string[][];          // every cell stringified (numbers → decimal string, booleans → "true"/"false")
  meta: {
    jsonShape: 'array' | 'wrapped' | 'ndjson';
    wrapperKey?: string;     // when jsonShape === 'wrapped'
    wrapperFields?: string[];// other top-level keys when wrapped
    encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
  };
};
```

The parser stringifies non-string scalars so the type-inference stage operates on the same input shape regardless of whether the source was CSV or JSON. Nested objects/arrays inside a row are JSON-serialized into a single string cell and the inferrer marks them as type `string` with role `metadata` (unless the operator chooses otherwise).

### Parser-level rejection codes (FR-015, SC-020)

| Code | Trigger |
|---|---|
| `EMPTY_FILE` | File is empty or whitespace-only. |
| `ENCODING_NOT_UTF8` | Decode failure under UTF-8 and UTF-16 with BOM. |
| `MALFORMED_JSON` | The bytes are not valid JSON (and not valid NDJSON either). |
| `WRONG_TOP_LEVEL_SHAPE` | Top-level is neither an array, an object containing a candidate array, nor parseable as NDJSON. |

> **Removed in v2**: `WRONG_TOP_LEVEL_TYPE`, `MISSING_OR_WRONG_SCHEMA_VERSION`, `UNSUPPORTED_SCHEMA_VERSION`, `CURRENCY_MISMATCH` (now a per-row warning per FR-049), `MINOR_UNITS_MISMATCH` (no longer applicable; amounts are inferred per file), `RECORDS_NOT_ARRAY` (replaced by `WRONG_TOP_LEVEL_SHAPE`).

---

## Stages 2–6 — same as CSV pipeline

After stage 1 produces a `RawTable`, the JSON path is identical to the CSV path:

- **Stage 2 (inference)** — `HeuristicColumnMapper` runs on the `RawTable.headers` + sampled `RawTable.rows`. The same bilingual header regex and value-pattern heuristics apply (see [import-csv.schema.md](import-csv.schema.md) §Stage 2 and [import-mapping.md](import-mapping.md)).
- **Stage 3 (mapping confirmation)** — same `mapping-preview` UI. JSON-specific cue: when `meta.jsonShape === 'wrapped'`, the preview shows the detected wrapper key so the operator knows where the records came from.
- **Stage 4 (normalization)** — same `normalize()` function.
- **Stage 5 (validation)** — same Zod schema; same per-row error codes (see CSV contract §Stage 5).
- **Stage 6 (capacity gate)** — same FR-041 partial-commit / cancel flow.

---

## JSON-specific notes for stage 2 inference

- **Native types preserved as hints**: when the source value was already a number (not a string), the inferrer records `type === 'number'` with high confidence (regardless of header). Same for booleans (`type === 'boolean'`).
- **Amounts as integer minor units vs decimal**: JSON files in the wild use both. The inferrer cannot distinguish them from the value alone (e.g., `15000` could be `$150.00` in cents or `$15,000.00` in major units). The operator confirms in the mapping preview which convention the file uses; the choice is recorded in `MappingDecision.amountConvention: 'minor-units' | 'major-decimal'` and applied at normalization.
- **Dates as ISO strings**: highest-confidence date inference happens when values match `^\d{4}-\d{2}-\d{2}` or are parseable as ISO datetimes (the time portion is truncated).
- **Currency as `currency` field on every row**: when present, the inferrer treats it as the `currency` role with high confidence; FR-049 governs whether import proceeds.

---

## Examples

### Example 1 — flat array (heterogeneous keys allowed)

```json
[
  {
    "date": "2026-04-02",
    "type": "income",
    "amount": 15000.00,
    "category": "Ventas",
    "description": "Factura A 0001-00012345",
    "counterparty": "Acme S.A.",
    "internalId": "INV-12345"
  },
  {
    "date": "2026-04-03",
    "type": "expense",
    "amount": 2350.50,
    "category": "Servicios",
    "description": "Pago internet abril",
    "counterparty": "Telecom Argentina"
  }
]
```

The inferrer maps the canonical fields to their roles with high confidence. `internalId` is left as `metadata` and preserved on the first record's `extraMetadata`. The second row has no `internalId`, so its `extraMetadata` for that key is simply absent.

### Example 2 — wrapped under a non-canonical key

```json
{
  "exportedFromSystem": "ERP-Pro",
  "exportedAt": "2026-04-30T10:00:00Z",
  "movements": [
    { "fecha": "2026-04-02", "monto": 150000, "tipo": "I", "rubro": "Ventas", "detalle": "Factura A", "moneda": "ARS" },
    { "fecha": "2026-04-03", "monto":  23505, "tipo": "E", "rubro": "Servicios", "detalle": "Internet abril", "moneda": "ARS" }
  ]
}
```

Stage 1 detects `jsonShape === 'wrapped'`, picks `movements` as the wrapper key, and produces a `RawTable` with the union of keys `[fecha, monto, tipo, rubro, detalle, moneda]`. Stage 2 maps:

- `fecha` → `date` (header regex, high confidence)
- `monto` → `amount` (header regex + numeric values)
- `tipo` → `type` (header regex + enum values `{I, E}`; the inferrer reports the enum and the operator picks the canonicalization mapping `I→income, E→expense` in the preview)
- `rubro` → `category`
- `detalle` → `description`
- `moneda` → `currency`

The operator confirms `amountConvention: 'minor-units'` because the values are integers without a decimal separator and equal the typical "cents" magnitude. The `exportedFromSystem` and `exportedAt` top-level fields are reported in `meta.wrapperFields` but not propagated to records (MVP).

### Example 3 — NDJSON (one object per line)

```
{"date":"2026-04-02","amount":15000.00,"category":"Ventas","description":"Factura A","type":"income"}
{"date":"2026-04-03","amount":2350.50,"category":"Servicios","description":"Internet","type":"expense"}
```

Stage 1 detects `jsonShape === 'ndjson'` and treats each line as a row. Stages 2–6 are identical to the flat-array case.
