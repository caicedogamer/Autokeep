# Contract: JSON Export Schema (v2)

**Owner module**: `src/modules/export/domain/`
**Spec refs**: FR-017, FR-018, FR-019, FR-020, FR-044, US4 acceptance scenarios, SC-005, SC-019
**Versioning**: `schemaVersion: 2`. Round-trip with the **flexible** JSON
importer (`schemaVersion: 2`) is a hard requirement (US4 acceptance
scenario 4 + SC-005). Records carrying `extraMetadata` MUST round-trip
through export + re-import without loss per **SC-019**. The exported
shape is a **wrapped array** (one of the three accepted JSON shapes in
[import-json.schema.md](import-json.schema.md)), so it is auto-detected
by the flexible importer's stage 1 parser.

---

## File-level structure

```json
{
  "schemaVersion": 2,
  "exportedAt": "2026-05-12T14:03:11.482Z",
  "workspace": { "id": "...", "name": "...", "currency": "ARS", "currencyMinorUnits": 2 },
  "filter": { /* serialized FilterState that produced this export */ },
  "records": [ /* RecordItem ... */ ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | `2` | yes | Matches the flexible import contract. |
| `exportedAt` | `IsoDateTime` | yes | When the file was produced. |
| `workspace` | `{ id, name, currency, currencyMinorUnits }` | yes | Identifies the source workspace; round-trip into the same workspace requires the same currency. The flexible importer surfaces `CURRENCY_DIFFERS_FROM_WORKSPACE` if the target workspace differs (FR-049). |
| `filter` | serialized `FilterState` | yes | Operator-readable record of the filter that produced the export (audit/transparency). The importer reports this in `meta.wrapperFields` but does not propagate it to records. |
| `records` | `RecordItem[]` | yes | Each item is a flat object. The flexible importer treats the union of object keys as headers; canonical keys map to their canonical roles with high confidence; the `meta.*` keys (see below) map to `metadata` automatically. May be empty (with FR-020 confirmation). |

### `RecordItem`

```ts
type RecordItem = {
  date: string;          // YYYY-MM-DD
  type: 'income' | 'expense';
  amount: number;        // integer minor units, > 0
  category: string;      // resolved name
  description: string;
  counterparty?: string; // omitted if absent
  // Plus one key per extraMetadata entry, prefixed "meta:" so the
  // flexible importer's HeuristicColumnMapper auto-routes them to the
  // metadata role on re-import. Example: "meta:internalId": "INV-12345"
} & Record<`meta:${string}`, string>;
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
  "schemaVersion": 2,
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
