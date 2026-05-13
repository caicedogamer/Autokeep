# Contract: CSV Import Schema (v1)

**Owner module**: `src/modules/import/domain/`
**Validator**: Zod schema (`csvRowSchema` + structural header check)
**Spec refs**: FR-011, FR-012, FR-013, FR-014, FR-015, FR-016
**Versioning**: this is **v1**. Future versions add a leading
`# autokeep-csv-version: <n>` comment line and bump the version pinned in
`schemaVersion`.

---

## File-level structure

- **Encoding**: UTF-8. A leading BOM is allowed and ignored.
- **Delimiter**: comma (`,`).
- **Quote character**: double quote (`"`); RFC 4180 escaping (`""` for a
  literal quote inside a quoted field).
- **Line endings**: `\r\n`, `\n`, or `\r` — all accepted.
- **First non-blank line**: header. Header MUST be exactly the columns
  below, in the documented stable order. Any deviation triggers a
  structural rejection (FR-015) with a single, clear reason.
- **Blank lines**: ignored.

---

## Columns (stable order)

| # | Column | Type | Required | Notes |
|---|---|---|---|---|
| 1 | `date` | `YYYY-MM-DD` | yes | Strict ISO date. Locale-specific formats (e.g., `DD/MM/YYYY`) are **rejected** — operators must convert before import (Spec edge case "Locale-specific numbers and dates"). |
| 2 | `type` | `income` \| `expense` | yes | Lower-case literal. |
| 3 | `amount` | decimal string | yes | Dot decimal separator (`123.45`). No thousand separators. Sign **forbidden** — sign is determined by `type`. Must be > 0 with at most `currencyMinorUnits` fractional digits. |
| 4 | `currency` | ISO 4217 (3 letters) | yes | MUST equal the workspace currency; rows with a different currency are rejected. |
| 5 | `category` | string | yes | Trimmed, 1–60 chars. Resolved against existing `Category.name` (case-insensitive); unknown names are auto-created at commit time and `Category.learnedFromAi = false`. |
| 6 | `description` | string | yes | Trimmed, 1–280 chars. |
| 7 | `counterparty` | string | no | Trimmed, ≤ 120 chars. Empty cell ⇒ no counterparty. Resolved/auto-created same as `category`. |

---

## Per-row validation rules (Zod, summarized)

```ts
const CsvRowSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate),
  type:        z.enum(['income', 'expense']),
  amount:      z.string()
                 .regex(/^\d+(\.\d{1,3})?$/)
                 .refine((s) => Number(s) > 0)
                 .refine((s) => fractionalDigits(s) <= ctx.currencyMinorUnits),
  currency:    z.string().length(3).refine((c) => c === ctx.currency),
  category:    z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(280),
  counterparty: z.string().trim().max(120).optional()
                 .transform((v) => (v === '' ? undefined : v)),
});
```

`ctx` carries the active workspace's `currency` and `currencyMinorUnits`
so the validator is aware of locale-specific cents.

---

## Per-row error reasons (FR-013)

These are the canonical reason codes the validator emits. The UI maps each
to a Spanish operator-readable message (FR-038):

| Code | Trigger |
|---|---|
| `INVALID_DATE` | Not `YYYY-MM-DD` or not a real date. |
| `INVALID_TYPE` | Not `income` or `expense`. |
| `INVALID_AMOUNT_FORMAT` | Not a positive decimal with ≤ `currencyMinorUnits` fractional digits. |
| `AMOUNT_NOT_POSITIVE` | Parses but `<= 0`. |
| `CURRENCY_MISMATCH` | Not equal to the workspace currency. |
| `CATEGORY_REQUIRED` | Empty after trim. |
| `CATEGORY_TOO_LONG` | > 60 chars after trim. |
| `DESCRIPTION_REQUIRED` | Empty after trim. |
| `DESCRIPTION_TOO_LONG` | > 280 chars after trim. |
| `COUNTERPARTY_TOO_LONG` | > 120 chars after trim. |
| `EXTRA_FIELDS` | Row has more fields than the header declares. |
| `MISSING_FIELDS` | Row has fewer fields than the header declares. |

A row failing **multiple** rules MUST surface **all** failing reasons in
one entry, not just the first.

---

## Structural rejections (FR-015)

These are emitted before any row is inspected. If any one trips, the
import is **rejected**, no records touched, and an `ImportBatch` is
recorded with `outcome: "rejected-structural"`.

| Code | Trigger |
|---|---|
| `EMPTY_FILE` | File has no non-blank lines. |
| `HEADER_MISSING` | First line is blank or not parseable as CSV. |
| `HEADER_MISMATCH` | Header columns differ from the stable order in name, count, or order. |
| `ENCODING_NOT_UTF8` | Decode failure. |
| `MALFORMED_CSV` | PapaParse reports an unrecoverable parse error. |

---

## Capacity interaction (FR-041)

After per-row validation completes:
- If `existing.records.length + validRows > 12000`, the importer surfaces
  the count that would land within the cap and the count that would be
  rejected; the operator chooses **partial commit** (truncate to the cap)
  or **cancel**. There is no silent truncation.

---

## Example (valid)

```
date,type,amount,currency,category,description,counterparty
2026-04-02,income,15000.00,ARS,Ventas,Factura A 0001-00012345,Acme S.A.
2026-04-03,expense,2350.50,ARS,Servicios,Pago internet abril,Telecom Argentina
```

## Example (mixed)

```
date,type,amount,currency,category,description,counterparty
2026-04-02,income,15000.00,ARS,Ventas,Factura A 0001-00012345,Acme S.A.
2026-04-03,expense,-100.00,ARS,Servicios,Pago duplicado,
not-a-date,expense,500,ARS,Otros,Línea con varios errores,XYZ
```

The second row fails `INVALID_AMOUNT_FORMAT` and `AMOUNT_NOT_POSITIVE`;
the third fails `INVALID_DATE` and `INVALID_AMOUNT_FORMAT` (no decimal but
acceptable; here the trigger would only be present if precision required
it — included to illustrate multi-failure aggregation).
