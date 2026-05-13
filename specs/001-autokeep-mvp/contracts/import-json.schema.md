# Contract: JSON Import Schema (v1)

**Owner module**: `src/modules/import/domain/`
**Validator**: Zod schema (`jsonImportSchema`)
**Spec refs**: FR-011, FR-012, FR-013, FR-014, FR-015, FR-016
**Versioning**: `schemaVersion: 1`. Future versions bump this number; the
importer dispatches by version and refuses unknown versions with a clear
structural error.

---

## File-level structure

A JSON import file is a single top-level object:

```json
{
  "schemaVersion": 1,
  "currency": "ARS",
  "currencyMinorUnits": 2,
  "records": [ /* RecordItem ... */ ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | `1` | yes | Exact match required. |
| `currency` | ISO 4217 (3 letters) | yes | MUST equal the workspace currency or the file is structurally rejected. |
| `currencyMinorUnits` | `0 \| 2 \| 3` | yes | MUST equal the workspace `currencyMinorUnits`. |
| `records` | `RecordItem[]` | yes | May be empty (yields a 0-row report and an opportunity to cancel). |

### `RecordItem`

```ts
type RecordItem = {
  date: string;          // YYYY-MM-DD
  type: 'income' | 'expense';
  amount: number;        // integer minor units, > 0
  category: string;      // 1..60 chars after trim
  description: string;   // 1..280 chars after trim
  counterparty?: string; // ≤ 120 chars after trim; absent or empty ⇒ no counterparty
};
```

Note that JSON imports use **integer minor units** for `amount` (e.g.
`15000` for ARS $150.00). This matches the in-memory `MoneyMinor`
representation and removes any decimal-parsing ambiguity. CSV imports use
decimal strings (see [import-csv.schema.md](import-csv.schema.md)) because
that's the format real-world CSVs ship in.

---

## Per-row error reasons (FR-013)

| Code | Trigger |
|---|---|
| `INVALID_DATE` | Not `YYYY-MM-DD` or not a real date. |
| `INVALID_TYPE` | Not `income` or `expense`. |
| `AMOUNT_NOT_INTEGER` | Not an integer. |
| `AMOUNT_NOT_POSITIVE` | `<= 0`. |
| `CATEGORY_REQUIRED` | Missing or empty after trim. |
| `CATEGORY_TOO_LONG` | > 60 chars after trim. |
| `DESCRIPTION_REQUIRED` | Missing or empty after trim. |
| `DESCRIPTION_TOO_LONG` | > 280 chars after trim. |
| `COUNTERPARTY_TOO_LONG` | > 120 chars after trim. |
| `UNKNOWN_FIELD` | An unexpected top-level field on `RecordItem`. |

A row failing multiple rules MUST surface all failing reasons in one entry.

---

## Structural rejections (FR-015)

| Code | Trigger |
|---|---|
| `MALFORMED_JSON` | The file is not valid JSON. |
| `WRONG_TOP_LEVEL_TYPE` | Top-level is not an object. |
| `MISSING_OR_WRONG_SCHEMA_VERSION` | `schemaVersion` missing or not `1`. |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` is a known number but unsupported by this build. |
| `CURRENCY_MISMATCH` | `currency` differs from the workspace. |
| `MINOR_UNITS_MISMATCH` | `currencyMinorUnits` differs from the workspace. |
| `RECORDS_NOT_ARRAY` | `records` is not an array. |

---

## Capacity interaction (FR-041)

Identical to the CSV importer: if `existing.records.length + validRows >
12000`, the importer offers partial commit (truncated to the cap) or
cancel. No silent truncation.

---

## Example (valid)

```json
{
  "schemaVersion": 1,
  "currency": "ARS",
  "currencyMinorUnits": 2,
  "records": [
    {
      "date": "2026-04-02",
      "type": "income",
      "amount": 1500000,
      "category": "Ventas",
      "description": "Factura A 0001-00012345",
      "counterparty": "Acme S.A."
    },
    {
      "date": "2026-04-03",
      "type": "expense",
      "amount": 235050,
      "category": "Servicios",
      "description": "Pago internet abril",
      "counterparty": "Telecom Argentina"
    }
  ]
}
```
