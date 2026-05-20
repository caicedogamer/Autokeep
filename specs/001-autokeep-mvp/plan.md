# Implementation Plan: AutoKeep — Automated Bookkeeping SPA (MVP)

**Branch**: `001-autokeep-mvp` | **Date**: 2026-05-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-autokeep-mvp/spec.md`

## Summary

AutoKeep is a single-page browser application that lets a single SMB operator
record income/expense entries, search/filter them in real time, import and
export CSV/JSON with strict validation, view an analytical dashboard, and
receive
suggestions and inconsistency findings. All
data lives encrypted in the browser via a workspace passphrase (FR-040), is
capped at 10,000 records per workspace (FR-041), and the UI must conform to
WCAG 2.1 AA in Spanish (FR-037–FR-039) with measurable performance budgets
(SC-002).

The technical approach honors the constitution: TypeScript SPA with strict
module boundaries, every storage call routed through a single adapter so a
later REST migration is a localized change, plain modular CSS with BEM, all
intensive work (parse, validate, filter, KDF/encrypt) off the main thread
via Web Workers, and explicit schema validation at every CSV/JSON ingress.

## Technical Context

**Language/Version**: TypeScript 5.x compiled to ES2022, targeting evergreen
desktop browsers. JS interop only inside narrow Web Worker boundaries (e.g.,
the WASM Argon2 worker payload). `strict: true`, `noUncheckedIndexedAccess:
true`, `exactOptionalPropertyTypes: true`.

**Primary Dependencies**:
- **Build/runtime**: Vite (dev server, bundler, worker bundling).
- **Validation**: Zod (TypeScript-first schema validation; tree-shakable;
  no heavy runtime). Used for the **normalized-row** schema after
  operator-confirmed mapping (FR-012); not used to enforce a fixed file
  header shape.
- **CSV**: PapaParse (battle-tested CSV parser; supports streaming +
  workers; small footprint). Used in **delimiter auto-detect** mode
  (`delimiter: ""`) so heterogeneous separators (comma / semicolon / tab)
  are handled without configuration. Justification in `research.md` R16.
- **Column inference**: **TypeScript-only heuristics**, no added
  dependency. Header-name regex (bilingual es/en) + value-pattern
  sampling produce a `ColumnInference` per column. Encapsulated behind
  the `ColumnMapper` interface so a future AI strategy can replace it
  without touching parser, normalizer, or validator (FR-048). Justified
  in `research.md` R15 against fuzzy-matching libraries and bundled
  ML models.
- **Charts**: Chart.js with the Canvas renderer (no React dep, accessible
  with manual ARIA labelling on the wrapping figure).
- **Crypto**: Web Crypto API (AES-256-GCM, PBKDF2-SHA-256). Argon2id is
  preferred per FR-040 and is provided by `argon2-browser` (WASM, runs
  inside a dedicated worker so the main thread stays responsive); PBKDF2-
  SHA-256 (Web Crypto, ≥ 600,000 iterations) is the fallback path.
- **No** UI framework, **no** Bootstrap/Material/Tailwind, **no** state-
  management library beyond a small in-house event bus + typed store.
  Justified per Constitution Principle VII below.

**Storage**: Browser `localStorage` via a single `StorageAdapter` interface
implemented by `LocalStorageAdapter`. Encrypted blob layout per FR-040.
Future REST migration replaces the adapter; nothing else changes.

**Testing**:
- **Unit**: Vitest (Vite-native, fast, TypeScript-first, runs in Node with
  jsdom for DOM-touching tests; runs in worker context for pure-logic
  modules).
- **Component / a11y**: Vitest + Testing Library + axe-core (`@axe-core/
  playwright` for end-to-end a11y; `vitest-axe` for component-level).
- **End-to-end / smoke**: Playwright (Chromium, Firefox, WebKit) — kept
  small: golden path per user story + the WCAG sweep.

**Target Platform**: Latest two stable releases of Chrome, Firefox, Edge,
and Safari on desktop (Linux/macOS/Windows). Layout remains usable down to
1024×768 (laptop) and tablet-landscape; no dedicated mobile build (out of
scope per FR-031 and the brief).

**Project Type**: Single-project frontend SPA. No backend in scope.

**Performance Goals**:
- p95 filter recompute ≤ **100 ms** at 5,000 records (SC-002).
- p95 keystroke-to-echo on the search input ≤ **50 ms** (SC-002).
- Import + validation of a 5,000-row file: UI remains interactive
  throughout, with cancel available before commit (SC-003).
- Inference + mapping preview of a 5,000-row × up-to-20-column file:
  p95 ≤ **1.5 s** on the reference profile, operator can cancel at any
  point (SC-018). Inference samples the first 200 rows only and runs
  inside `import.worker.ts`.
- Argon2id passphrase derivation (workspace unlock) target ≤ **750 ms** on
  the reference profile; runs in a dedicated worker so the main thread is
  not blocked (Principle V).
- Dashboard render of all widgets after a period change ≤ **200 ms** at
  5,000 records.

**Constraints**:
- localStorage-only persistence; no backend, no IndexedDB wrapper, no
  service worker for sync (Principle III).
- No heavy CSS framework; plain modular CSS with BEM (Principle IV).
- All long-running work off the main thread (Principle V).
- WCAG 2.1 AA across all primary flows (FR-037).
- Every dependency justified per Principle VII (see Constitution Check
  below for the running tally).

**Scale/Scope**:
- Up to **10,000 records** per workspace (FR-041), soft warning at 8,000,
  hard refusal of new writes at 12,000.
- Six modules per the brief; ~8–12 primary screens; one dashboard with
  ~5 widgets.
- Single-user, single-device per workspace (Assumptions + FR-034).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution: `.specify/memory/constitution.md` v1.0.0.

| # | Principle | Pass? | Evidence / How the plan satisfies it |
|---|---|---|---|
| I  | SPA Modular y Desacoplada | ✅ | TS strict; per-module folders under `src/modules/<module>/`; each module exports a typed public surface (`index.ts`); cross-module communication via DTOs and a typed event bus only. |
| II | Separación Lógica / Presentación | ✅ | Business logic in `src/modules/<module>/{domain,services}` with **zero** DOM imports; UI in `src/modules/<module>/ui` consumes domain via interfaces; `StorageAdapter` interface mediates every persistence call so the future REST swap is localized. |
| III | Persistencia Local Primero (NON-NEGOTIABLE) | ✅ | Only `LocalStorageAdapter` implements `StorageAdapter` for financial data; payloads are versioned (`schemaVersion`); no backend, IndexedDB, or service worker introduced. **Sole documented exception**: `src/core/theme/` persists the non-secret visual-theme preference (`'system' \| 'light' \| 'dark'`) under `autokeep:theme` — required because the theme must apply on the unlock screen before any encrypted blob exists (`research.md` R18). The exception is enforced by an ESLint allow-list pinned to `src/core/theme/**` and `src/core/storage/**` only. |
| IV | CSS Puro y Estilos Modulares (NON-NEGOTIABLE) | ✅ | Plain CSS files co-located with each module under `ui/`; BEM naming; only `src/styles/tokens.css` and `src/styles/reset.css` are global. No CSS framework added. |
| V  | Validación de Datos y Procesamiento No-Bloqueante (NON-NEGOTIABLE) | ✅ | Every CSV/JSON ingress validated **adaptively against the normalized model after operator-confirmed mapping** before any write (FR-012, FR-015, FR-043, FR-045). Parsing, inference, mapping confirmation, normalization, and validation each run as a separate pipeline stage; the heavy stages (parse, inference, validate) run inside `import.worker.ts`. Filtering and Argon2 KDF run in their own dedicated `Worker` modules. UI remains interactive (SC-002, SC-003, SC-018). |
| VI | Calidad de Código, Tipado y Preparación para Pruebas | ✅ | TypeScript strict; ESLint (typescript-eslint, eslint-plugin-import, eslint-plugin-jsdoc); Prettier; pure-function business logic injected with adapters; Vitest scaffolded from day one. |
| VII | Justificación Tecnológica Obligatoria | ✅ | Each dependency justified inline in **Technical Context** above against perf/maintainability/scalability and against a simpler alternative. Running tally is preserved in `research.md` so reviewers can reproduce the rationale. |

**Result:** PASS. No violations. **Complexity Tracking** table is therefore
intentionally empty (per template guidance: fill *only* if there are
unjustified violations).

Re-evaluation after Phase 1 design (below): **PASS — no new violations
introduced; module boundaries, storage adapter, and worker boundaries
retained as designed.** See "Post-Design Constitution Re-Check" at the end
of this plan.

## Project Structure

### Documentation (this feature)

```text
specs/001-autokeep-mvp/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── storage-adapter.md
│   ├── import-csv.schema.md
│   ├── import-json.schema.md
│   ├── export-csv.schema.md
│   └── export-json.schema.md
└── tasks.md             # Phase 2 output (/speckit-tasks command — NOT created here)
```

### Source Code (repository root)

Single-project frontend SPA. The selected structure is a **module-first**
layout under `src/modules/`, with each module containing its own `domain/`
(pure types & rules), `services/` (orchestration), `ui/` (DOM + CSS), and
`__tests__/` folders. Cross-cutting plumbing lives in `src/core/`.

```text
autoKeep/
├── index.html                       # SPA entry; mounts #app and bootstraps
├── public/                          # Static assets (favicons, icons only)
├── src/
│   ├── main.ts                      # Composition root: wires adapters → modules → router
│   ├── core/
│   │   ├── storage/
│   │   │   ├── storage-adapter.ts        # StorageAdapter interface (the contract)
│   │   │   ├── local-storage-adapter.ts  # localStorage implementation
│   │   │   └── encrypted-store.ts        # AES-GCM wrapper around the adapter
│   │   ├── crypto/
│   │   │   ├── kdf.worker.ts             # Argon2id (WASM) / PBKDF2 fallback
│   │   │   └── crypto-service.ts         # main-thread service that talks to kdf.worker
│   │   ├── workers/
│   │   │   ├── filter.worker.ts          # off-thread filter recompute
│   │   │   └── import.worker.ts          # off-thread CSV/JSON parse + validate
│   │   ├── events/
│   │   │   └── event-bus.ts              # typed pub/sub
│   │   ├── i18n/
│   │   │   ├── es.ts                     # Spanish copy bundle (FR-038)
│   │   │   └── format.ts                 # locale-aware date/number formatters (FR-039)
│   │   ├── router/
│   │   │   └── router.ts                 # tiny hash-based SPA router
│   │   ├── theme/                        # Theme preference (light/dark/system)
│   │   │   ├── theme-service.ts          # Sole documented exception to Principle III (research.md R18)
│   │   │   └── index.ts                  # Public surface
│   │   └── result.ts                     # Result<T, E> for explicit error handling
│   ├── modules/
│   │   ├── records/                      # US1
│   │   │   ├── domain/                   # FinancialRecord, Category, Counterparty types + invariants
│   │   │   ├── services/                 # CRUD orchestration; optimistic-concurrency check (FR-036)
│   │   │   ├── ui/                       # forms, list view, conflict dialog
│   │   │   └── __tests__/
│   │   ├── filters/                      # US2
│   │   │   ├── domain/                   # FilterState, predicates
│   │   │   ├── services/                 # filter coordinator (delegates to filter.worker)
│   │   │   ├── ui/                       # filter bar, active-filters chip strip
│   │   │   └── __tests__/
│   │   ├── import/                       # US3 — flexible import pipeline
│   │   │   ├── domain/
│   │   │   │   ├── parsing/              # CSV (PapaParse, delimiter auto-detect) and JSON
│   │   │   │   │                         # parsers → RawTable; NO semantic assumptions
│   │   │   │   ├── inference/            # ColumnMapper interface + HeuristicColumnMapper
│   │   │   │   │                         # (bilingual header regex + value-pattern sampling)
│   │   │   │   ├── normalization/        # RawTable + MappingDecision → FinancialRecord[]
│   │   │   │   │                         # + extraMetadata for unmapped columns
│   │   │   │   ├── validation/           # Zod schemas applied AFTER normalization
│   │   │   │   └── types.ts              # RawTable, ColumnInference, ColumnMapping,
│   │   │   │                             # MappingDecision, MappingWarning, ImportBatch,
│   │   │   │                             # ValidationReport
│   │   │   ├── services/
│   │   │   │   └── import-pipeline.ts    # orchestrates the 6-stage pipeline via worker
│   │   │   ├── ui/
│   │   │   │   ├── file-picker.ts        # drag-drop + native picker
│   │   │   │   ├── mapping-preview.ts    # NEW: preview + per-column role dropdowns +
│   │   │   │   │                         # confidence indicators + warning badges
│   │   │   │   ├── validation-report.ts  # per-row results
│   │   │   │   └── import-progress.ts    # progress + cancel
│   │   │   └── __tests__/
│   │   ├── export/                       # US4
│   │   │   ├── domain/                   # export schemas (CSV columns, JSON shape, schemaVersion)
│   │   │   ├── services/                 # CSV/JSON serialization, optional encrypted export
│   │   │   ├── ui/                       # export dialog
│   │   │   └── __tests__/
│   │   ├── dashboard/                    # US5
│   │   │   ├── domain/                   # period selectors, aggregation functions (pure)
│   │   │   ├── services/                 # widget data providers (consume filter state)
│   │   │   ├── ui/                       # widgets, charts, empty-states
│   │   │   └── __tests__/
│   │   ├── ai/                           # US6
│   │   │   ├── domain/                   # Suggestion, InconsistencyFinding types; in-browser scoring
│   │   │   ├── services/                 # learn-from-confirmations; degrade-gracefully facade
│   │   │   ├── ui/                       # suggestion chip, inconsistency report view
│   │   │   └── __tests__/
│   │   └── workspace/                    # passphrase setup/unlock/change (FR-040), capacity gate (FR-041)
│   │       ├── domain/
│   │       ├── services/
│   │       ├── ui/
│   │       └── __tests__/
│   └── styles/
│       ├── tokens.css                    # design tokens: palette, type, spacing, radius, shadows, motion, z
│       ├── reset.css                     # minimal reset + scrollbar + selection
│       ├── components.css                # shared classes: btn, input, card, badge, kpi, table, alert, ...
│       └── shell.css                     # app-shell layout (sidebar + topbar + content)
├── tests/
│   ├── e2e/                              # Playwright golden-paths per user story + WCAG sweep
│   └── fixtures/                         # canonical CSV/JSON files (valid, mixed, malformed)
├── tsconfig.json
├── vite.config.ts
├── package.json
├── .eslintrc.cjs
├── .prettierrc
└── README.md
```

**Structure Decision**: Frontend-only SPA, module-first layout under
`src/modules/<module>/{domain,services,ui,__tests__}` with shared plumbing in
`src/core/` and module-scoped CSS co-located in each `ui/` folder. This
maps the six product modules to six source modules one-to-one, satisfies
Principle I (independent, reusable, contract-bounded modules), keeps
business logic free of DOM imports per Principle II (`domain/` and
`services/` never import from `ui/`), routes every persistence call through
`src/core/storage/storage-adapter.ts` per Principle III, and keeps every
worker (KDF, filter, import) under `src/core/workers/` per Principle V. No
backend or `frontend/`/`backend/` split is created — out of scope for the
MVP.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified.**

No violations to justify — the Constitution Check above is fully PASS and
the design introduces no exemptions. This table is intentionally left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | _(none)_   | _(none)_                             |

## Post-Design Constitution Re-Check

After Phase 1 design (data model, contracts, quickstart):

- **Principle I:** the module tree under `src/modules/` is one-to-one with
  the six product modules; each exports only its `index.ts` surface.
  **Pass.**
- **Principle II:** `data-model.md` keeps domain types as plain
  TypeScript with no DOM dependencies; `contracts/storage-adapter.md`
  fixes the storage seam so the future REST swap remains localized.
  **Pass.**
- **Principle III:** the only adapter implementation is
  `LocalStorageAdapter`. The encrypted-blob layout fits within the 5 MB
  per-origin budget under realistic record sizes (see `research.md`).
  **Pass.**
- **Principle IV:** no CSS framework introduced; `styles/` holds only
  tokens + reset; module CSS is BEM-scoped and co-located in `ui/`.
  **Pass.**
- **Principle V:** every CSV/JSON contract requires schema validation
  before commit. The new pipeline (parse → infer → confirm → normalize
  → validate → persist) preserves this — validation now runs against the
  normalized model after operator-confirmed mapping, not against a fixed
  header (FR-012, FR-043, FR-045). `import.worker.ts`, `filter.worker.ts`,
  and `kdf.worker.ts` keep heavy work off the main thread; inference and
  validation are co-located inside `import.worker.ts`. **Pass.**
- **Principle VI:** all chosen libraries are TS-first or ship types;
  `Result<T, E>` in `core/result.ts` enforces explicit error handling at
  module boundaries; Vitest is wired before any feature work.
  **Pass.**
- **Principle VII:** the dependency tally in `research.md` records each
  choice + rejected alternative; nothing was added "by default."
  **Pass.**

**Overall: PASS — proceed to `/speckit-tasks`.**
