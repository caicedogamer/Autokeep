# Contract: `StorageAdapter`

**Owner module**: `src/core/storage/`
**Consumers**: `core/storage/encrypted-store.ts` (only direct consumer);
all module-level persistence flows talk to `EncryptedStore`, never to a
raw adapter.
**Constitution principles enforced**:
- **III** (Persistencia Local Primero) — only `LocalStorageAdapter`
  implements this interface in the MVP.
- **II** (Separación Lógica/Presentación) — this is the seam that lets a
  future REST client replace the implementation without touching call
  sites.

The adapter operates on **opaque keys and opaque byte arrays**. Encryption
sits *above* the adapter (in `EncryptedStore`); the adapter never sees
plaintext financial data.

---

## Interface

```ts
export interface StorageAdapter {
  /** Returns the byte array stored under `key`, or `null` if absent. */
  get(key: string): Promise<Uint8Array | null>;

  /** Writes `value` under `key`. Atomic per call. */
  set(key: string, value: Uint8Array): Promise<void>;

  /** Removes `key`. No-op if absent. */
  delete(key: string): Promise<void>;

  /** Lists all keys whose name starts with `prefix`. */
  listKeys(prefix: string): Promise<string[]>;

  /**
   * Reports the implementation's available-capacity estimate, in bytes,
   * if it can. `null` if the implementation cannot estimate.
   * Used by FR-033 ("warn near capacity").
   */
  estimateRemainingBytes(): Promise<number | null>;

  /**
   * Subscribes to cross-context change events for `key`. In the
   * localStorage implementation this wraps the `storage` window event,
   * which is how FR-036 (optimistic concurrency across tabs) detects
   * version drift.
   */
  subscribe(
    key: string,
    handler: (event: { key: string; type: 'changed' | 'cleared' }) => void
  ): () => void;
}
```

---

## Errors

The adapter throws **only** the following typed errors. All adapter
implementations MUST convert lower-level browser errors into one of these
so consumers can pattern-match.

```ts
export class StorageQuotaError extends Error { /* maps to QuotaExceededError */ }
export class StorageUnavailableError extends Error { /* localStorage disabled or null */ }
export class StorageCorruptError extends Error { /* base64/length checks failed on read */ }
```

The constitution requires explicit error handling at module boundaries
(Principle VI). Consumers MUST handle these via the `Result<T, E>`
helper in `src/core/result.ts` rather than `try/catch` at every call site.

---

## Key conventions

All MVP keys are namespaced under `autokeep:`:

| Key | Owner | Encrypted? | Notes |
|---|---|---|---|
| `autokeep:ws:<workspaceId>` | `EncryptedStore` | yes (AES-256-GCM blob) | The encrypted workspace payload (data-model.md). |
| `autokeep:ws:<workspaceId>:meta` | workspace module | no | `{ kdf, schemaVersion }`. Needed before unlock to render the unlock UI. Contains no financial data. |
| `autokeep:ws:<workspaceId>:throttle` | workspace module | no | Brute-force counter (R6). Contains no financial data. |
| `autokeep:workspaces` | workspace module | no | Index of workspace ids + display names + lastOpenedAt. Contains no financial data. |

Adapter MUST treat any key outside this namespace as foreign and leave it
untouched on a `clear`-style operation. (We do not expose `clear()` in the
MVP — deletes go through `delete(key)` per known key.)

---

## Concurrency contract (FR-036)

- Every `set(key, value)` triggers `subscribe` handlers in **other**
  browsing contexts (tabs) that share the same origin and have subscribed
  to that key. Same-tab writes do not echo back through `subscribe`.
- The encrypted-store layer is responsible for re-reading on a `changed`
  event, decrypting, and surfacing a "stale snapshot" signal up to the
  records module so the conflict dialog can be shown if the operator was
  mid-edit.
- The adapter itself has no notion of `version`; that lives in the
  domain model (data-model.md).

---

## Acceptance tests for an adapter implementation

Any `StorageAdapter` implementation MUST pass the following behavioural
tests (these live in `src/core/storage/__tests__/storage-adapter.spec.ts`
and run against every implementation):

1. `get` returns `null` for a key that was never written.
2. `set` then `get` round-trips bytes exactly (including the `0x00` byte
   in the middle of a payload).
3. `set` then `delete` then `get` returns `null`.
4. `listKeys(prefix)` returns only keys with that prefix and never throws
   on an empty store.
5. Writing a payload larger than the implementation's capacity throws
   `StorageQuotaError` (NOT a generic `Error`).
6. `subscribe` invokes the handler in a second instance after a `set` from
   a first instance, with `type: 'changed'`.
7. `estimateRemainingBytes` returns either a non-negative integer or
   `null` — never throws.
