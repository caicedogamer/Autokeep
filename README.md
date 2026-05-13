# AutoKeep

AutoKeep is a browser-only bookkeeping SPA for SMBs. It runs entirely
in the browser — no backend, no cloud, no account required. Financial
records are encrypted at rest in `localStorage` using Argon2id + AES-GCM;
the passphrase never leaves the device.

> **Target audience**: small teams and sole proprietors who need a
> simple, private, offline-capable ledger.

---

## Prerequisites

- **Node.js** ≥ 20.x LTS
- A modern desktop browser (Chrome, Firefox, Edge, Safari — latest two
  stable versions)
- No backend tooling needed — no Docker, no database, no API server

---

## First-time setup

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
```

On first open, the app prompts you to create a workspace (name,
currency, locale) and set a passphrase. **There is no passphrase
recovery** — losing it makes the workspace permanently inaccessible.

To wipe the dev workspace: browser DevTools → Application → Local
Storage → delete keys under `autokeep:` → reload.

---

## 5-step verification checklist

After `npm install`, run:

```bash
npm run typecheck   # zero type errors
npm run lint        # zero lint errors
npm test -- --run   # all suites pass
npm run build       # dist/ produced, zero warnings
```

Then in the browser:

1. **Create** workspace `Demo`, currency `ARS`, locale `es`, passphrase
   `correcthorsebatterystaple`.
2. **Add** one income record and one expense record.
3. **Reload** the page; unlock with the passphrase → both records must
   be present.
4. **Conflict test**: open a second browser tab, edit the same record in
   both tabs, save the second tab last → the conflict dialog (FR-036)
   must appear.
5. **Settings → Privacy**: confirm the on-screen summary matches FR-040
   (encrypted at rest, no recovery, exports only as backup).

All five passing confirms storage, encryption, optimistic-concurrency,
and reload flows are wired end-to-end.

---

## Day-to-day commands

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Vite dev server with HMR                      |
| `npm run build`     | Typecheck + production bundle → `dist/`       |
| `npm run preview`   | Serve the production bundle locally           |
| `npm run lint`      | ESLint over `src/**` and `tests/**`           |
| `npm run format`    | Prettier write                                |
| `npm run typecheck` | `tsc --noEmit`                                |
| `npm test`          | Vitest watch mode                             |
| `npm run test:ci`   | Vitest single-run with coverage               |
| `npm run test:e2e`  | Playwright across Chromium / Firefox / WebKit |

**CI merge gates** (Constitution Principle VI): `lint`, `typecheck`,
`test:ci`, and `test:e2e` must all pass before merge.

---

## Module map

```
src/modules/
├── records/      US1 — CRUD + optimistic-concurrency conflict dialog
├── filters/      US2 — combined filters + free-text search
├── import/       US3 — CSV/JSON validation + commit
├── export/       US4 — filtered CSV/JSON export
├── dashboard/    US5 — analytical widgets
├── ai/           US6 — suggestions + inconsistency findings
└── workspace/    passphrase setup/unlock/change + capacity gate
```

Cross-cutting plumbing (storage adapter, encryption, workers, i18n,
router, event bus) lives in `src/core/`.

---

## Design documents

| Document                                                                     | Purpose                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| [specs/001-autokeep-mvp/spec.md](specs/001-autokeep-mvp/spec.md)             | What and why — user stories, FRs, SCs           |
| [specs/001-autokeep-mvp/plan.md](specs/001-autokeep-mvp/plan.md)             | How at architecture level                       |
| [specs/001-autokeep-mvp/research.md](specs/001-autokeep-mvp/research.md)     | Dependency rationale + rejected alternatives    |
| [specs/001-autokeep-mvp/data-model.md](specs/001-autokeep-mvp/data-model.md) | Entity shapes, invariants, state transitions    |
| [specs/001-autokeep-mvp/contracts/](specs/001-autokeep-mvp/contracts/)       | StorageAdapter + CSV/JSON import/export schemas |
| [.specify/memory/constitution.md](.specify/memory/constitution.md)           | Non-negotiable governance constraints           |

---

## Non-negotiable rules (Constitution Principle VII: justify every dependency)

Before adding any new package, answer in your PR description:

1. **What problem does it solve?** Name the specific FR or SC it
   addresses.
2. **What is the simpler alternative?** (e.g., native Intl API, plain
   CSS, a 20-line helper)
3. **Why is the simple alternative insufficient?** (performance measured,
   not assumed; missing browser API; correctness proof)

Adding a dependency without that justification fails PR review.

---

## Security properties

- Passphrase is NEVER stored or transmitted; loss = unrecoverable workspace.
- Financial data is NEVER in plaintext in `localStorage` (SC-014).
- AI assistance runs locally; no financial data leaves the device.
- No network requests from the app; no usage analytics include record contents.
