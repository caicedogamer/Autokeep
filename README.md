# AutoKeep

A browser-only bookkeeping app for small businesses. No accounts, no cloud — your financial data stays on your device, encrypted, and under your control.

---

## What it does

AutoKeep gives a small business operator a full ledger in a browser tab:

- **Record management** — create, edit, and delete income and expense entries with date, amount, category, description, and counterparty. All changes persist across browser restarts.
- **Real-time filters** — combine free-text search with filters for date range, type, category, amount range, and counterparty. Results update as you type, even across thousands of records.
- **CSV/JSON import** — drag in a bank statement, ERP export, or spreadsheet. AutoKeep infers what each column means, shows you a confidence-scored preview, lets you correct the mapping, validates every row before writing anything, and preserves unmapped columns as metadata so nothing is silently discarded.
- **CSV/JSON export** — export the currently filtered set in a stable, documented format. Round-trips cleanly back into import.
- **Analytical dashboard** — totals, net result, income vs. expense evolution over time, and top categories/counterparties for any chosen period and filter scope.
- **AI suggestions** — category suggestions based on description and prior records, plus an inconsistency report that flags category mismatches, amount outliers, and likely duplicates. Suggestions never apply without your confirmation.

---

## Security model

Financial data is encrypted before it ever touches `localStorage`. The encryption key is derived from your passphrase using **Argon2id** (memory-hard KDF, runs in a Web Worker so the UI stays responsive), and each write is protected with **AES-256-GCM** and a random nonce.

**The passphrase is never stored or transmitted.** If you lose it, the workspace is unrecoverable — there is no reset path, no recovery email, no server holding a backup key. The app tells you this during setup and encourages you to keep an unencrypted export as an offline backup.

If you open the browser storage on a locked workspace, you will find only encrypted bytes. No record fields, no descriptions, no amounts in plaintext.

---

## Getting started

**Requirements:** Node.js ≥ 20.x, a modern desktop browser.

```bash
npm install
npm run dev        # → http://localhost:5173
```

On first open, you'll be prompted to name your workspace, choose a currency and locale, and set a passphrase.

To reset a dev workspace: DevTools → Application → Local Storage → delete keys starting with `autokeep:` → reload.

---

## Commands

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Vite dev server with HMR                      |
| `npm run build`     | Typecheck + production bundle → `dist/`       |
| `npm run preview`   | Serve the production bundle locally           |
| `npm run typecheck` | TypeScript only, no emit                      |
| `npm run lint`      | ESLint over `src/**` and `tests/**`           |
| `npm run format`    | Prettier write                                |
| `npm run test`      | Vitest watch mode                             |
| `npm run test:ci`   | Vitest single-run with coverage               |
| `npm run test:e2e`  | Playwright across Chromium / Firefox / WebKit |

---

## Verification checklist

After `npm install`, run:

```bash
npm run typecheck   # zero type errors
npm run lint        # zero lint errors
npm run test:ci     # all 287 tests pass
npm run build       # dist/ produced
```

Then in the browser:

1. Create workspace `Demo`, currency `ARS`, locale `es`, passphrase `correcthorsebatterystaple`.
2. Add one income record and one expense record.
3. Reload the page, unlock with the passphrase — both records must be there.
4. Open a second tab, edit the same record in both, save the second tab last — a conflict dialog must appear.
5. Settings → Privacy — the summary must match what the app promised at setup.

---

## Architecture

AutoKeep is a TypeScript SPA. Every persistence call goes through a `StorageAdapter` interface — only `LocalStorageAdapter` implements it, so a future REST migration is a one-file swap.

**Boot sequence:**

1. An inline script in `index.html` reads `autokeep:theme` and sets `<html data-theme>` before first paint, preventing flash.
2. `createThemeService()` takes over: watches `prefers-color-scheme`, exposes the toggle.
3. If a workspace exists in storage → unlock screen. If not → setup screen.
4. On unlock, the passphrase is handed to the crypto worker, the key is derived, the workspace payload is decrypted.
5. The app shell (sidebar + topbar + content) mounts and the hash router takes over.

**Layer rules** (enforced by ESLint, will fail CI if violated):

- `domain/` — pure functions only. No DOM, no `localStorage`, no network.
- `services/` — orchestration. No DOM.
- `ui/` — DOM manipulation only. Calls services, never touches `localStorage` directly.
- `src/core/storage/` — the only place allowed to read/write `localStorage` for financial data.
- `src/core/theme/` — the one documented exception: reads/writes only `autokeep:theme` (a non-secret visual preference that must exist before the encrypted workspace is unlocked).

**Heavy work runs off the main thread:**

- `filter.worker.ts` — filter recomputation across large datasets.
- `import.worker.ts` — CSV/JSON parsing, column inference, normalization, and validation.
- `kdf.worker.ts` — Argon2id passphrase derivation (WASM, self-contained binary to avoid Vite ESM issues).

---

## Module map

```
src/modules/
├── records/      CRUD, field validation, optimistic-concurrency conflict dialog
├── filters/      FilterState, combined predicates, real-time recompute via worker
├── import/       6-stage pipeline: parse → infer → confirm → normalize → validate → persist
├── export/       CSV/JSON serialization, optional encrypted export
├── dashboard/    Period selector, aggregation functions, Chart.js widgets
├── ai/           Category suggestion scoring, inconsistency detection, graceful degradation
└── workspace/    Passphrase setup/unlock/change, capacity gate (warn at 8k, block at 12k)

src/core/
├── crypto/       CryptoService, kdf.worker (Argon2id + AES-256-GCM)
├── storage/      StorageAdapter interface, LocalStorageAdapter, EncryptedStore
├── workers/      filter.worker, import.worker, message types
├── events/       Typed event bus
├── i18n/         Spanish copy bundle (es.ts), locale-aware formatters
├── router/       Hash-based SPA router
├── theme/        Theme service (light / dark / system)
└── result.ts     Result<T, E> — explicit success/failure, no silent catches
```

---

## Specifications

The full design lives in `specs/001-autokeep-mvp/`:

| Document                                                                                  | What it covers                                                                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [spec.md](specs/001-autokeep-mvp/spec.md)                                                 | User stories, functional requirements (FR-001–FR-049), success criteria (SC-001–SC-020), edge cases |
| [plan.md](specs/001-autokeep-mvp/plan.md)                                                 | Architecture decisions, dependency rationale, module structure, constitution compliance             |
| [research.md](specs/001-autokeep-mvp/research.md)                                         | Dependency justifications and rejected alternatives                                                 |
| [data-model.md](specs/001-autokeep-mvp/data-model.md)                                     | Entity shapes, invariants, state transitions                                                        |
| [contracts/storage-adapter.md](specs/001-autokeep-mvp/contracts/storage-adapter.md)       | StorageAdapter interface contract                                                                   |
| [contracts/import-csv.schema.md](specs/001-autokeep-mvp/contracts/import-csv.schema.md)   | CSV import schema                                                                                   |
| [contracts/import-json.schema.md](specs/001-autokeep-mvp/contracts/import-json.schema.md) | JSON import schema                                                                                  |
| [contracts/export-csv.schema.md](specs/001-autokeep-mvp/contracts/export-csv.schema.md)   | CSV export schema                                                                                   |
| [contracts/export-json.schema.md](specs/001-autokeep-mvp/contracts/export-json.schema.md) | JSON export schema                                                                                  |
| [.specify/memory/constitution.md](.specify/memory/constitution.md)                        | Non-negotiable governance constraints                                                               |

### Key requirements summary

**Performance** (all measured at 5,000 records on a mid-tier laptop):

- p95 filter recompute ≤ 100 ms
- p95 keystroke-to-echo on search ≤ 50 ms
- Import inference + preview p95 ≤ 1.5 s (5,000 rows × 20 columns)
- Argon2id key derivation ≤ 750 ms (worker, non-blocking)

**Dataset limits:**

- Soft warning at 8,000 records
- Hard write block at 12,000 records
- Read, edit, delete, filter, dashboard, and export always remain available above the cap

**Accessibility:** WCAG 2.1 Level AA across all primary flows. Full keyboard operability, visible focus indicators, axe-core clean.

**Locale:** UI in Spanish. Date and number formatting is workspace-level (default `es`, selectable).

### Import pipeline detail

The import flow has six stages, each independently testable:

1. **Parse** — PapaParse with auto-detect delimiter. Rejects only on truly unparseable files (corrupt bytes, malformed JSON). Does not assume column meaning.
2. **Infer** — `HeuristicColumnMapper` samples the first 200 rows, combines bilingual header-name regex (es/en) with value-pattern matching to produce a confidence score and role candidates per column. Exposed behind a `ColumnMapper` interface — a future AI-based strategy can replace it without touching any other stage.
3. **Confirm** — The operator reviews the mapping, corrects any column's role, marks columns as `metadata` or `ignore`. Ambiguous columns (confidence gap < 0.1 between top two candidates) are flagged and must be resolved before proceeding.
4. **Normalize** — Transforms the raw table using the confirmed mapping into `FinancialRecord` drafts. Unmapped columns land in `extraMetadata`.
5. **Validate** — Zod schemas check every normalized row. Required roles missing after mapping block the import with a named error. Currency mismatches surface a confirmation step.
6. **Persist** — Only after operator confirmation of the validation report. Partial imports (valid rows only) require explicit choice. Zero silent writes.

---

## Testing conventions

- `*.pure.spec.ts` — Node environment, no DOM. For pure domain functions.
- `*.spec.ts` — jsdom environment. For services that need a simulated DOM.
- `tests/e2e/*.spec.ts` — Playwright, Chromium + Firefox + WebKit.

Path aliases: `@core` → `src/core`, `@modules` → `src/modules`.

E2E tests need the production build on port 4173. Either run `npm run preview` first, or Playwright's `webServer` config starts it automatically.

---

## Non-negotiable rules

Before adding any package, answer three questions in your PR:

1. What specific problem does it solve? (Name the FR or SC.)
2. What is the simpler alternative?
3. Why is the simpler alternative not enough? (Measured, not assumed.)

Adding a dependency without that justification fails review.

---

## Out of scope (MVP)

- Mobile layout
- Multi-user / multi-device sync
- Banking integrations
- Server-side auth or account recovery
- Multi-currency reporting
- Any network requests from the app
