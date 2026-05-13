# Quickstart: AutoKeep MVP

This document is the contributor's first-day guide for the AutoKeep
codebase as designed in this branch. It is intentionally short and
operational; the *why* lives in [plan.md](plan.md), [research.md](research.md),
and [spec.md](spec.md). The non-negotiable rules live in
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md).

---

## Prerequisites

- **Node.js** ≥ 20.x LTS (for Vite + Vitest).
- **A modern desktop browser** (Chrome / Firefox / Edge / Safari, latest
  two stable versions).
- **No backend tooling** — there is no API, no database, no Docker.

---

## First-time setup

```bash
# from repo root
npm install
npm run dev          # starts the Vite dev server (default: http://localhost:5173)
```

On first open of the dev server in a fresh browser profile:
1. The app prompts you to **create a workspace** (name, currency, locale).
2. You set a **workspace passphrase** (FR-040). The setup screen makes
   the no-recovery rule explicit and offers to start with a one-click
   demo dataset.
3. The workspace is created, encrypted, and persisted. The next page
   reload requires the passphrase.

To wipe the dev workspace and start over: open the browser devtools →
Application → Local Storage → delete the keys under the `autokeep:`
namespace, then reload.

---

## Day-to-day commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Type-check + production bundle to `dist/`. |
| `npm run preview` | Serve the production bundle locally to verify a build. |
| `npm run lint` | ESLint over `src/**` and `tests/**`. |
| `npm run format` | Prettier write. |
| `npm run typecheck` | `tsc --noEmit` (also runs as part of `build`). |
| `npm test` | Vitest in watch mode. |
| `npm run test:ci` | Vitest single-run, with coverage. |
| `npm run test:e2e` | Playwright across Chromium/Firefox/WebKit (golden paths + WCAG sweep). |

Lint, typecheck, unit tests, and the WCAG sweep MUST pass in CI before
merge (Constitution Principle VI).

---

## Module map (one-to-one with product modules)

```
src/modules/
├── records/        US1 — CRUD + optimistic-concurrency conflict dialog
├── filters/        US2 — combined filters + free-text search
├── import/         US3 — CSV/JSON validation + commit
├── export/         US4 — filtered CSV/JSON export
├── dashboard/      US5 — analytical widgets
├── ai/             US6 — suggestions + inconsistency findings
└── workspace/      passphrase setup/unlock/change + capacity gate (FR-041)
```

Each module is laid out as:

```
<module>/
├── domain/        Pure types + invariants. **No DOM imports.**
├── services/      Orchestration. Talks to other modules' `index.ts` only.
├── ui/            DOM + module-scoped CSS (BEM). **No business logic.**
├── __tests__/     Vitest specs co-located with the code under test.
└── index.ts       Public surface — the only file other modules import.
```

Cross-cutting plumbing (storage adapter, encryption, workers, i18n,
router, event bus, `Result<T, E>`) lives in `src/core/`.

---

## The non-negotiable rules in one screen

1. **Storage** goes through `src/core/storage/encrypted-store.ts`, which
   sits on top of `StorageAdapter` (see
   [contracts/storage-adapter.md](contracts/storage-adapter.md)). **Never
   call `localStorage` directly from a module.**
2. **No DOM imports** in any `domain/` or `services/` file. Add a lint
   rule to enforce this.
3. **Every CSV/JSON ingress** is validated by a Zod schema before a
   single byte is persisted (FR-012, FR-015).
4. **Heavy work runs in a worker** — KDF, CSV parse + validate, filter
   recompute. The main thread stays interactive.
5. **No CSS framework.** Plain CSS files co-located in each module's
   `ui/`. Global styles live in `src/styles/{tokens,reset}.css` only.
6. **Adding a dependency** requires a written justification in the PR
   description against perf / maintainability / scalability and against
   the simpler alternative (Constitution Principle VII).

If you're about to violate one of these, stop and either propose a
constitution amendment in a separate PR or rethink the design.

---

## Verifying you're set up correctly

Run this checklist after `npm install`:

```bash
npm run typecheck   # must pass with zero errors
npm run lint        # must pass with zero errors
npm test -- --run   # must pass; no skipped suites
npm run build       # must produce dist/ with no warnings
```

Then, in the browser:

1. Create a workspace `Demo` with currency `ARS`, locale `es`,
   passphrase `correcthorsebatterystaple`.
2. Add one income record and one expense record.
3. Refresh the page; you should be prompted for the passphrase, and
   after entering it, both records should be present.
4. Open the dev server in a second tab, edit the same record in both
   tabs, save the second tab last → the conflict dialog from FR-036
   should appear.
5. Open the **Settings → Privacy** screen and verify the on-screen
   summary matches FR-040 (encrypted at rest, no recovery, exports as
   backup).

Hitting all five confirms the storage, encryption, optimistic-concurrency,
and reload flows are wired correctly end-to-end.

---

## What the spec / plan / contracts each give you

- **[spec.md](spec.md)** — *what and why.* User stories, requirements
  (FR-…), success criteria (SC-…), assumptions. The source of truth for
  acceptance.
- **[plan.md](plan.md)** — *how, at architecture level.* Tech context,
  module layout, Constitution Check.
- **[research.md](research.md)** — *why this dependency, not that one.*
  One section per choice with the rejected alternative.
- **[data-model.md](data-model.md)** — *the entity shapes.* Field-level
  contracts, invariants, state transitions.
- **[contracts/](contracts/)** — *the seams.* StorageAdapter interface +
  CSV/JSON import & export schemas. These are the files reviewers read
  first when judging a PR that touches persistence or I/O.

Open issues / open questions deferred from earlier phases are tracked at
the bottom of `research.md` (`OQ-1`..`OQ-4`); none block implementation.
