# Contract: CSV Export Schema (v1)

**Owner module**: `src/modules/export/domain/`
**Spec refs**: FR-017, FR-018, FR-020, US4 acceptance scenarios
**Versioning**: matches the import schema. Round-trip with the v1 importer
is a hard requirement (US4 acceptance scenario 4 + SC-005).

---

## File-level structure

- **Encoding**: UTF-8 with no BOM.
- **Delimiter**: comma (`,`).
- **Quote character**: `"`. Fields are quoted iff they contain `,`, `"`,
  `\n`, or `\r`. Embedded quotes escape as `""`.
- **Line endings**: `\r\n` (RFC 4180).
- **First line**: header (always present, even when zero data rows are
  exported — but see FR-020 for the empty-export warning).

---

## Columns (stable order, identical to the CSV import)

| # | Column | Source | Notes |
|---|---|---|---|
| 1 | `date` | `FinancialRecord.date` | `YYYY-MM-DD`. |
| 2 | `type` | `FinancialRecord.type` | `income` or `expense`. |
| 3 | `amount` | `FinancialRecord.amount` | Decimal string with exactly `currencyMinorUnits` fractional digits, dot decimal separator (e.g., `15000.00`). |
| 4 | `currency` | `Workspace.currency` | ISO 4217 (3 letters). |
| 5 | `category` | `Category.name` (resolved by `categoryId`) | Trimmed name as stored. |
| 6 | `description` | `FinancialRecord.description` | As stored. |
| 7 | `counterparty` | `Counterparty.name` or empty | Empty string if `counterpartyId` is absent. |

The order MUST be exactly this. Tests round-trip CSV through the v1
importer and compare records.

---

## Row ordering

Default: ascending by `date`, then ascending by `createdAt`. Stable across
exports of the same dataset (deterministic for diffing).

---

## Empty exports (FR-020)

If the active filter produces zero records:
- The export action MUST surface a confirmation prompt before producing
  any file.
- If confirmed, the produced file contains the header line and zero data
  rows.
- The `ImportBatch` history is **not** affected (export does not create
  import history).

---

## Filename suggestion

`autokeep-export-<workspaceName>-<YYYYMMDD-HHmm>.csv`, sanitized for OS
filename rules. Operators may rename freely.
