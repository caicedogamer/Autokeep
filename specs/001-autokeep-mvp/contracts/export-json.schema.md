# Contract: JSON Export Schema (v1)

**Owner module**: `src/modules/export/domain/`
**Spec refs**: FR-017, FR-018, FR-019, FR-020, US4 acceptance scenarios
**Versioning**: `schemaVersion: 1`. Round-trip with the v1 JSON importer
is a hard requirement (US4 acceptance scenario 4 + SC-005).

---

## File-level structure

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-05-12T14:03:11.482Z",
  "workspace": { "id": "...", "name": "...", "currency": "ARS", "currencyMinorUnits": 2 },
  "filter": { /* serialized FilterState that produced this export */ },
  "records": [ /* RecordItem ... */ ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | `1` | yes | Matches the import contract. |
| `exportedAt` | `IsoDateTime` | yes | When the file was produced. |
| `workspace` | `{ id, name, currency, currencyMinorUnits }` | yes | Identifies the source workspace; the importer enforces `currency` + `currencyMinorUnits` match. |
| `filter` | serialized `FilterState` | yes | Operator-readable record of the filter that produced the export (audit/transparency). The importer ignores this field. |
| `records` | `RecordItem[]` | yes | Same shape as the import contract (integer minor units for `amount`). May be empty (with FR-020 confirmation). |

### `RecordItem`

Identical to the JSON import schema:

```ts
type RecordItem = {
  date: string;          // YYYY-MM-DD
  type: 'income' | 'expense';
  amount: number;        // integer minor units, > 0
  category: string;      // resolved name
  description: string;
  counterparty?: string; // omitted if absent
};
```

---

## Row ordering

Default: ascending by `date`, then ascending by `createdAt` — stable across
exports of the same dataset.

---

## Encrypted-export option (FR-040)

If the operator opts into an encrypted export at export time:

```json
{
  "schemaVersion": 1,
  "encrypted": true,
  "kdf": { "name": "argon2id", "salt": "<base64>", "params": { ... } },
  "cipher": "AES-256-GCM",
  "iv": "<base64>",
  "ciphertext": "<base64>"
}
```

The plaintext (before encryption) is the unencrypted export object above.
The importer detects `encrypted: true`, prompts for the export passphrase
(separate from the workspace passphrase), derives a key with the recorded
KDF, decrypts, and proceeds with the standard import flow. Failed
decryption MUST be reported as a structural error, never as a silent
empty import.

---

## Empty exports (FR-020)

Same behaviour as CSV: confirmation prompt before producing the file; the
produced file is structurally valid (`records: []`).
