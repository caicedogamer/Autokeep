# Contract: CSV Import Pipeline (v2)

**Owner module**: `src/modules/import/domain/`
**Stages** (pure, independently testable):
1. `parsing/csv-parser.ts` — CSV → `RawTable`
2. `inference/heuristic-column-mapper.ts` — `RawTable` → `InferenceReport`
3. `ui/mapping-preview.ts` — collects operator confirmation → `MappingDecision`
4. `normalization/normalizer.ts` — `RawTable + MappingDecision` → candidate `FinancialRecord[]`
5. `validation/validator.ts` (Zod) — adaptive per-row validation → `ValidationReport`
6. `services/import-pipeline.ts` — orchestrator (commits via `RecordsService.create`)

**Spec refs**: FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049
**Versioning**: this is **v2**. Replaces the v1 fixed-header contract entirely; the old `HEADER_MISMATCH` / `HEADER_MISSING` rejection codes are removed.

> See [import-mapping.md](import-mapping.md) for the inference + mapping contract shared between CSV and JSON paths.

---

## Stage 1 — Parsing

**Goal**: decode the file into a `RawTable` without making any assumption about column meaning.

### File-level expectations

- **Encoding**: UTF-8 with optional leading BOM (ignored). UTF-16LE/BE with BOM is auto-detected and decoded. Any other encoding → `ENCODING_NOT_UTF8`.
- **Delimiter**: auto-detected by PapaParse (`delimiter: ""`). Comma `,`, semicolon `;`, tab `\t`, and pipe `|` are all supported transparently.
- **Quote character**: double quote `"`; RFC 4180 escaping (`""` for a literal quote inside a quoted field).
- **Line endings**: `\r\n`, `\n`, or `\r` — all accepted.
- **First non-blank line**: treated as the header **by default**. If every cell in the first line parses as a value of the inferred column type (heuristic: ≥ 60% of cells "look like data"), a synthetic header (`col_1`, `col_2`, …) is generated and the first line becomes the first data row. The decision is reported to the UI so the operator can override it.
- **Blank lines**: ignored.

### Output type

```ts
type RawTable = {
  headers: string[];        // original or synthesized
  rows: string[][];         // every cell as a string; type inference happens in stage 2
  meta: {
    delimiter: ',' | ';' | '\t' | '|';
    lineEnding: '\r\n' | '\n' | '\r';
    headerSynthesized: boolean;
    encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
  };
};
```

### Parser-level rejection codes (FR-015, SC-020)

These are the **only** reasons for file-level rejection. Anything else is handled at row level or in the mapping preview.

| Code | Trigger |
|---|---|
| `EMPTY_FILE` | File has no non-blank lines. |
| `ENCODING_NOT_UTF8` | Decode failure under UTF-8 and UTF-16 with BOM. |
| `MALFORMED_CSV` | PapaParse reports an unrecoverable parse error (unterminated quote, etc.). |

> **Removed in v2**: `HEADER_MISSING`, `HEADER_MISMATCH`. Header shape is no longer a reason for file rejection; absent header is synthesized, unfamiliar header is handled in stage 2.

---

## Stage 2 — Inference (`HeuristicColumnMapper`)

**Goal**: for every column in the `RawTable`, infer (a) the dominant data type by sampling values and (b) the semantic role by combining header-name regex with value-pattern matching. Produce a confidence score and an ordered list of alternative candidates.

### Sampling parameters

- **Sample size**: first **200 non-empty rows** per column (or all rows if fewer). Constant cost regardless of file length — SC-018 is achievable on 5,000 × 20 because inference is O(rows×cols) on a bounded sample.
- **Type detection order** (first match wins for each cell, dominant type is the majority across the sample):
  1. `date` — matches `^\d{4}-\d{2}-\d{2}$` (ISO), `^\d{2}/\d{2}/\d{4}$` (DD/MM or MM/DD), `^\d{2}-\d{2}-\d{4}$`. Format ambiguity (DD/MM vs MM/DD) is resolved by the value distribution: if any day component > 12 the format is DD/MM; otherwise the inferrer flags `AMBIGUOUS_DATE_FORMAT` for operator confirmation.
  2. `number` — matches `^-?\d+([.,]\d+)?$`. Decimal separator (`.` vs `,`) detected by majority within the column.
  3. `enum` — column has ≤ 10 distinct case-folded values across the sample and every value is short (≤ 30 chars). Useful for `type` (income/expense) and `currency`.
  4. `boolean` — matches `^(true|false|0|1|yes|no|sí|si)$/i`. Reserved for `metadata`-class columns; never inferred for canonical roles.
  5. `string` — fallback.

### Semantic role heuristics (bilingual es/en)

For each column the inferrer computes a `headerScore` (regex on the column header) and a `valueScore` (regex/distribution on the sampled values), then a composite `confidence = clamp(0.6 * headerScore + 0.4 * valueScore, 0, 1)`. The role with the highest composite confidence becomes `inferredRole`; the next two are recorded in `alternativeRoles[]`.

| Role | Header regex (i-flag) | Value-pattern hint |
|---|---|---|
| `date` | `^(date\|fecha\|d[íi]a\|day\|fechaop\|fecha[_-]?op|trans.*date\|posting[_-]?date)$` | type === `date` |
| `amount` | `(amount\|monto\|importe\|total\|valor\|debit\|credit\|d[ée]bito\|cr[ée]dito\|haber\|debe)` | type === `number` |
| `type` | `(type\|tipo\|sign\|mov\|movimiento\|operaci[oó]n)` | enum with values in `{income,expense,ingreso,egreso,gasto,credit,debit,cr,db,+,-}` after case-fold |
| `category` | `(categor[ií]a\|category\|clase\|class\|rubro\|concepto[_-]?cat)` | type === `string` AND distinct values ≤ 60 across the file |
| `description` | `(desc\|detalle\|concepto\|memo\|notes?\|observ)` | type === `string` AND mean length ≥ 8 chars (fallback: the longest-string column with no stronger role match) |
| `counterparty` | `(party\|client(e)?\|cliente\|supplier\|proveedor\|provider\|tercero\|beneficiari[oa]\|empresa)` | type === `string` |
| `currency` | `(curr(ency)?\|moneda\|coin\|divisa)` | type === `enum`, every value matches `^[A-Z]{3}$` (ISO 4217) |
| `metadata` | (default — no canonical role) | any type |

### Output

```ts
type InferenceReport = {
  columns: ColumnInference[];      // one per column in RawTable
  globalWarnings: MappingWarning[]; // e.g. AMBIGUOUS_ROLE across columns
};

type ColumnInference = {
  columnIndex: number;
  header: string;
  inferredType: 'string' | 'number' | 'date' | 'enum' | 'boolean';
  inferredRole: SemanticRole;            // see import-mapping.md
  confidence: number;                     // [0, 1]
  alternativeRoles: Array<{
    role: SemanticRole;
    confidence: number;
  }>;
  sampleSize: number;
  mismatchRate: number;                   // share of sampled rows that did NOT match the dominant type
};
```

See [import-mapping.md](import-mapping.md) for `SemanticRole`, `MappingWarning`, ambiguity rules, and required-vs-optional roles.

---

## Stage 3 — Mapping confirmation

The UI (`mapping-preview.ts`) renders the first ~20 rows of the `RawTable` next to the per-column `inferredRole` and `confidence`. The operator may:

- Accept the proposed mapping wholesale (single click → `source: "auto"`).
- Override one or more columns via a dropdown (any column may be reassigned to any `SemanticRole`, `"ignore"`, or `"metadata"` → `source: "manual"` or `"mixed"`).
- Cancel the import entirely.

The pipeline does **not** proceed to normalization until the operator confirms. A timestamped `MappingDecision` is produced and persisted on the resulting `ImportBatch` for audit (FR-043).

**Ambiguity gate**: if any required role has `AMBIGUOUS_ROLE` or `MISSING_REQUIRED_ROLE` warning, the confirm button is disabled until the operator resolves it (FR-045, FR-046).

---

## Stage 4 — Normalization

Pure function `normalize(table: RawTable, decision: MappingDecision, workspace: WorkspaceContext): NormalizedRow[]` produces one `NormalizedRow` per CSV data row:

```ts
type NormalizedRow = {
  rowNumber: number;            // 1-based; matches the original file row
  date: string | null;          // raw value pulled from the date-column cell
  type: string | null;          // raw value pulled from the type-column cell
  amount: string | null;        // raw value pulled from the amount-column cell (still a string)
  currency: string | null;      // optional; null if column not mapped
  category: string | null;
  description: string | null;
  counterparty: string | null;  // optional
  extraMetadata: Record<string, string>; // keys = original header (or synthesized) for every column whose role is "metadata"
};
```

The normalizer **does not** coerce types — that's the validator's job. It only routes cells from their `columnIndex` into their semantic-role slot, preserving raw values for accurate error reporting.

---

## Stage 5 — Adaptive validation (Zod)

The validator turns each `NormalizedRow` into a candidate `FinancialRecord` and emits per-row errors. Shape (Zod, simplified):

```ts
const NormalizedRowSchema = z.object({
  date:        z.string().refine(parseDateForConfirmedFormat),
  type:        z.string().transform(canonicalizeTypeFromLocale),
  amount:      z.string().refine(parseAmountForConfirmedFormat),
  currency:    z.string().length(3).optional()
                 .refine((c) => c === undefined || c === ctx.currency, 'CURRENCY_DIFFERS_FROM_WORKSPACE'),
  category:    z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(280),
  counterparty: z.string().trim().max(120).optional()
                 .transform((v) => (v === '' ? undefined : v)),
  extraMetadata: z.record(z.string().max(200)).default({}),
});
```

`ctx` carries the workspace `currency`, `currencyMinorUnits`, and the operator-confirmed date/decimal formats per column.

### Per-row error reasons (FR-013)

These reasons drive the validation report. The UI maps them to Spanish operator-readable messages (FR-038):

| Code | Trigger |
|---|---|
| `INVALID_DATE` | Not parseable under the column's confirmed date format. |
| `INVALID_TYPE` | Not in the accepted income/expense vocabulary after canonicalization. |
| `INVALID_AMOUNT_FORMAT` | Not parseable under the column's confirmed decimal format, OR has more fractional digits than `currencyMinorUnits`. |
| `AMOUNT_NOT_POSITIVE` | Parses but `<= 0`. |
| `CURRENCY_DIFFERS_FROM_WORKSPACE` | Row's currency cell is not the workspace currency (FR-049). |
| `CATEGORY_REQUIRED` | Empty after trim. |
| `CATEGORY_TOO_LONG` | > 60 chars after trim. |
| `DESCRIPTION_REQUIRED` | Empty after trim. |
| `DESCRIPTION_TOO_LONG` | > 280 chars after trim. |
| `COUNTERPARTY_TOO_LONG` | > 120 chars after trim. |
| `MISSING_REQUIRED_ROLE_AFTER_MAPPING` | A required role's column is unmapped or its cell is empty after mapping (FR-045). |
| `METADATA_KEY_TOO_LONG` | An `extraMetadata` key (column header) exceeds 60 chars. |
| `METADATA_VALUE_TOO_LONG` | An `extraMetadata` value exceeds 200 chars. |
| `METADATA_TOO_MANY_FIELDS` | More than 10 metadata fields on a single row. |

A row failing multiple rules MUST surface **all** failing reasons in one entry (not just the first).

> **Removed in v2**: `EXTRA_FIELDS`, `MISSING_FIELDS`. Row width mismatches are tolerated: missing trailing cells become `null`, extra cells fall into `extraMetadata` under their synthesized header.

---

## Stage 6 — Capacity interaction (FR-041)

Unchanged from v1. After per-row validation completes:

- If `existing.records.length + validRows > 12_000`, the importer surfaces the count that would land within the cap and the count that would be rejected; the operator chooses **partial commit** (truncate to the cap) or **cancel**. There is no silent truncation.
- The capacity gate is checked again at the moment of write, so a concurrent edit in another tab cannot bypass it.

---

## Example: heterogeneous file → flexible import

Input (a real-world bank statement export with Spanish headers and semicolon delimiter):

```
Fecha Operacion;Concepto;Importe;Cliente/Proveedor;Saldo
02/04/2026;Factura A 0001-00012345;15.000,00;Acme S.A.;15.000,00
03/04/2026;Pago internet abril;-2.350,50;Telecom Argentina;12.649,50
```

Stage 2 output (abbreviated):

| Column | Header | Type | Inferred role | Confidence | Alternatives |
|---|---|---|---|---|---|
| 0 | `Fecha Operacion` | date | `date` | 0.95 | — |
| 1 | `Concepto` | string | `description` | 0.85 | `category` (0.20) |
| 2 | `Importe` | number | `amount` | 0.90 | — |
| 3 | `Cliente/Proveedor` | string | `counterparty` | 0.92 | `description` (0.30) |
| 4 | `Saldo` | number | `metadata` | 0.10 | `amount` (0.45) — **AMBIGUOUS_ROLE** |

The mapping preview flags `Saldo` and `Importe` as `AMBIGUOUS_ROLE` for `amount`. The operator confirms `Importe` is the transaction amount and `Saldo` is the running balance (drops to `metadata` or `ignore`). After confirmation, the date format is set to DD/MM/YYYY (day component 02..03 is unambiguous for first two rows; full-sample distribution may push for confirmation) and the decimal separator is `,`. Normalization + validation proceed; the `type` role is missing — it must be derived from the sign of `Importe` via an operator-confirmed convention (negative → expense, positive → income), captured as part of the `MappingDecision` (the validator emits `MISSING_REQUIRED_ROLE_AFTER_MAPPING` if the operator skips this).
