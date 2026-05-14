# Phase 0 Research: AutoKeep MVP

**Branch**: `001-autokeep-mvp`
**Date**: 2026-05-12
**Spec**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)

This document records the technology choices for the AutoKeep MVP and, per
**Constitution Principle VII (Justificación Tecnológica Obligatoria)**, the
simpler alternative considered for each one.

---

## R1 — Language and module system

**Decision**: TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess:
true`, `exactOptionalPropertyTypes: true`. Compiled to ES2022 ESM.

**Rationale**: The constitution mandates consistent typing and explicit
error handling (Principle VI). TypeScript with strict flags catches the
classes of bugs (undefined access, optional/required mismatches, exhaustive
switch over discriminated unions) that bookkeeping data is most sensitive
to. ESM is the native browser module format and matches Vite's expected
output.

**Alternatives considered**: Plain JavaScript with JSDoc + `checkJs`. The
constitution explicitly allows that path, but the team gains no
prototyping speed (Vite supports both equally), loses union-narrowing
ergonomics, and has to maintain JSDoc syntax for every interface boundary.
Rejected.

---

## R2 — Build tool and dev server

**Decision**: Vite (latest stable major).

**Rationale**: Native ESM dev server (instant HMR), first-class TypeScript
support without a separate `tsc` watcher, native Web Worker bundling
(`new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`)
which we need for Principle V, and a small dependency footprint compared
to webpack-class bundlers.

**Alternatives considered**:
- **esbuild + tsc by hand**: smaller surface but we'd reimplement worker
  bundling, asset hashing, and HMR. Net higher long-term cost.
- **Parcel**: comparable to Vite but its worker story is less explicit and
  its plugin ecosystem is shallower. Rejected for ecosystem maturity.
- **No bundler** (raw ES modules): would force CDN imports or vendored
  copies of every dependency, and we lose tree-shaking. Rejected.

---

## R3 — Schema validation library (CSV/JSON)

**Decision**: Zod (latest 3.x).

**Rationale**: TypeScript-first — the schema *is* the type, no `.d.ts`
desync risk. Tree-shakable. Supports per-row error reporting (`SafeParse`
returns structured issues), which is the exact shape FR-013 requires for
the import validation report. Pure-TS, no runtime dependency, runs in
workers cleanly. Reasonable bundle cost.

**Alternatives considered**:
- **Hand-rolled validators**: zero dependency, but every new field is a
  hand-written guard and an inevitable type/runtime drift bug. Rejected on
  Principle VI (testability, explicit error handling) — Zod gives us
  uniform, structured error reporting for free.
- **AJV (JSON Schema)**: standardized format, but JSON Schema is verbose
  for our needs and the type↔schema mapping requires a generator step.
  Rejected.
- **Yup**: comparable API, weaker TypeScript inference. Rejected.

---

## R4 — CSV parsing

**Decision**: PapaParse (latest 5.x).

**Rationale**: The defining quality is correctness on real-world CSV
(quoted fields with embedded delimiters, BOM, mixed line endings), which is
the source of most "import succeeded but data is wrong" bugs. PapaParse
handles all of those, supports streaming (`step:` callback) so we can
report progress per FR-016, and runs inside a Web Worker via its own
`worker: true` mode — aligning with Principle V.

**Alternatives considered**:
- **Hand-rolled parser** (split by `,` and `\n`): the trap that catches
  every team. Quoted commas and embedded newlines are silent corruption.
  Rejected outright.
- **`csv-parse`**: comparable correctness, larger footprint, less browser-
  oriented streaming. Rejected.

---

## R5 — Charts for the dashboard

**Decision**: Chart.js (latest 4.x), Canvas renderer, with manual ARIA
labelling on the wrapping `<figure>` and a parallel `<table>` fallback for
screen readers.

**Rationale**: Chart.js is small, has no UI-framework dep, and supports
the chart types the dashboard needs (line for evolution, bar for top
categories/counterparties). Canvas keeps DOM size flat for dashboards with
many points, which matters at 10,000 records. The accessible parallel
table satisfies WCAG 2.1 AA (FR-037) without forcing an SVG renderer.

**Alternatives considered**:
- **Hand-drawn SVG**: tempting and small, but reimplements axis layout,
  tick formatting, and tooltip handling — not justifiable per Principle
  VII versus a tree-shakable lib.
- **D3**: powerful but oversized for our chart types and brings a steep
  internal API surface. Rejected on maintainability.
- **ECharts / Highcharts**: heavier; Highcharts is also commercial-license
  for commercial use. Rejected.

---

## R6 — At-rest encryption (FR-040)

**Decision**:
- **Cipher**: **AES-256-GCM** via Web Crypto API. Per-write random 12-byte
  IV. AAD = `workspaceId || schemaVersion` so a copied ciphertext can't be
  replayed across workspaces.
- **KDF**: **Argon2id (preferred)** via `argon2-browser` (WASM), parameters
  targeting ~600–800 ms on the reference profile (~64 MiB memory cost,
  3 iterations, parallelism 1). Runs in a dedicated worker
  (`src/core/crypto/kdf.worker.ts`) so the main thread never blocks
  (Principle V).
- **Fallback KDF**: **PBKDF2-SHA-256, ≥ 600,000 iterations** via Web
  Crypto, used if Argon2 WASM fails to load (very old browser, CSP block,
  etc.). Negotiated automatically and recorded in the workspace header so
  unlock uses the same KDF.
- **Persisted layout** (one localStorage key per workspace, e.g.
  `autokeep:ws:<id>`):
  ```
  {
    "schemaVersion": 1,
    "kdf": { "name": "argon2id", "salt": <base64>, "params": { ... } },
    "cipher": "AES-256-GCM",
    "iv": <base64>,
    "ciphertext": <base64>
  }
  ```
- **Brute-force throttle (SC-015)**: client-side counter persisted under a
  separate non-secret key; after 5 failed attempts within 60 s, exponential
  backoff (1 s → 2 s → 4 s → 8 s → cap 30 s). Not a security mechanism on
  its own (the attacker could clear the counter), but it satisfies
  SC-015's behavioural requirement and slows casual misuse.

**Rationale**: AES-GCM is FIPS-grade, authenticated (catches tampering),
and supported natively by Web Crypto (no JS crypto we have to audit
ourselves). Argon2id is the current recommendation for password-derived
keys (memory-hard, resists GPU); WASM is mature and runs in workers
without blocking the main thread. PBKDF2 fallback uses Web Crypto
primitives only and clears the same security bar at higher iteration cost
— the choice is recorded so unlock can reproduce it.

**Alternatives considered**:
- **`localStorage` plaintext + warning**: the option the operator
  explicitly rejected during clarification. Recorded for completeness.
- **scrypt KDF**: comparable to Argon2id; we picked Argon2id because it is
  the OWASP-recommended default and `argon2-browser` is well-maintained.
- **A WASM AES library (e.g., libsodium.js)**: larger payload, no benefit
  over Web Crypto's native AES-GCM. Rejected.
- **Encrypting only "sensitive" fields** (selective encryption): leaks
  metadata (counts, dates, structure) and complicates queries with no
  meaningful gain. Rejected — encrypt the whole workspace blob.

---

## R7 — Storage adapter & feasibility under the 10k cap

**Decision**: A single `StorageAdapter` interface (defined in
`contracts/storage-adapter.md`) with `LocalStorageAdapter` as the only MVP
implementation. The adapter operates on **opaque byte arrays** so that
every byte the adapter sees is already AES-GCM ciphertext (encryption sits
*above* the adapter, not inside it).

**Feasibility check (informs FR-041 + Principle III)**:
- Typical encoded record (UUID + ISO date + numeric amount + 2 short text
  fields + counterparty + timestamps + `version` + `schemaVersion`) ≈
  ~250 bytes JSON-serialized.
- 10,000 records × 250 B ≈ **2.5 MB** plaintext JSON.
- After GZip-like JSON compactness savings (we don't actually gzip; the
  estimate is the raw serialized size) and AES-GCM ciphertext overhead
  (≤ 32 bytes per blob, not per record), encrypted blob size ≈ **3.4 MB**
  base64-encoded (`× 4/3`).
- Per-origin localStorage budget on Chrome/Edge/Firefox/Safari: ~5 MB.
- **Headroom**: ~1.6 MB above the 10k record cap, leaves room for the
  workspace header, AI suggestion model state, and operator settings.
- The 8,000-record soft warning (FR-041) lands at ~2.7 MB encrypted,
  giving the operator ~2.3 MB of headroom to act on the warning.

**Conclusion**: localStorage + a single encrypted workspace blob is
feasible at the chosen cap. Chunked / segmented storage is **not** needed
for the MVP — confirms the rejection of Option C in the dataset-size
clarification (Q5).

**Alternatives considered**:
- **IndexedDB**: would lift the storage ceiling to hundreds of MB and
  enable per-record encryption. Explicitly forbidden by Principle III for
  the MVP. Recorded as the natural "next storage tier" in the roadmap.
- **One key per record**: more granular but multiplies header bytes (KDF
  salt, IV, base64) and breaks the simple "one workspace = one ciphertext"
  model. Rejected on maintainability.

---

## R8 — Off-main-thread execution (Principle V)

**Decision**: Three dedicated workers, each typed via a tiny request/
response message contract:
- `kdf.worker.ts` — Argon2id / PBKDF2 derivation (input: passphrase + salt
  + params; output: derived key bytes).
- `import.worker.ts` — CSV/JSON parsing + Zod validation (input: file +
  schema id; output: streamed per-row results, then a final summary).
- `filter.worker.ts` — combined-filter recompute over the in-memory record
  index (input: filter state + record snapshot version; output: matching
  ids + count). Triggered with a debounce and the latest call wins
  (cancel-on-newer-version pattern).

**Rationale**: All three workloads can plausibly exceed the per-frame
budget at 10k records or during a 5k-row import. Putting them in workers
is the only honest way to keep SC-002 / SC-003 testable — main-thread
optimization buys time but not correctness under load. Using `module`
workers keeps imports + types ergonomic and matches Vite's expected
configuration.

**Alternatives considered**:
- **Main-thread + `requestIdleCallback`**: works for filtering at small
  sizes but provides no guarantee under load and is not available in
  Safari. Rejected.
- **Single shared worker for everything**: conflates concerns and
  serializes the import behind the filter recompute. Rejected.
- **OffscreenCanvas for chart rendering**: deferred to post-MVP; current
  chart sizes don't justify it.

---

## R9 — State management

**Decision**: A small in-house typed store + the typed event bus already
listed in the source tree (`src/core/events/event-bus.ts`). The store
pattern: each module owns its slice as an immutable snapshot, exposes
selectors, and notifies subscribers on change.

**Rationale**: The constitution's Principle II requires UI to consume
business logic via interfaces only; that's exactly what a small store
gives us without a framework dependency. We need ~6 stores at most (one
per module). A general-purpose state library is unjustifiable per
Principle VII for this scope.

**Alternatives considered**:
- **Redux / Zustand / MobX**: each adds bundle size and conventions for
  problems we don't have at six modules. Rejected on Principle VII.

---

## R10 — Routing

**Decision**: A tiny hash-based router in `src/core/router/router.ts`
mapping `#/records`, `#/filters`, `#/dashboard`, `#/import`, `#/export`,
`#/ai/inconsistencies`, `#/settings` to module entry views.

**Rationale**: Hash routing avoids any need for server URL rewrites
(consistent with no-backend), works on `file://` for local distribution,
and is ~30 lines of code.

**Alternatives considered**:
- **History API routing**: requires a server fallback, conflicts with the
  "ships as a static SPA" stance.
- **A routing library**: unjustified at six routes per Principle VII.

---

## R11 — i18n / locale-aware formatting (FR-038, FR-039)

**Decision**: A single Spanish copy bundle in `src/core/i18n/es.ts`
(typed; the export is a `Record<string, string>` keyed by canonical
identifiers) and `src/core/i18n/format.ts` wrapping `Intl.DateTimeFormat`
and `Intl.NumberFormat` keyed by the workspace locale setting.

**Rationale**: Spanish-only UI for the MVP doesn't need an i18n library;
a structured copy bundle is enough and keeps the door open for adding
languages later (FR-038's "structured so adding languages later is a
localized change"). `Intl.*` is built into modern browsers.

**Alternatives considered**:
- **i18next / Lingui / FormatJS**: powerful but unjustified at one
  language. Adopt if/when we ship a second language.

---

## R12 — Testing

**Decision**: Vitest + Testing Library + axe-core (component & a11y),
Playwright for end-to-end + the WCAG sweep.

**Rationale**: Vitest reuses Vite's pipeline, runs ESM/TypeScript natively,
and supports both jsdom (for component tests) and Node (for pure-logic
tests). axe-core catches the WCAG 2.1 AA issues we commit to in FR-037.
Playwright runs the same E2E across Chromium/Firefox/WebKit, which we need
because the encryption/Web Worker stack must be exercised on each engine
the spec targets.

**Alternatives considered**:
- **Jest**: works, but its ESM + TS story still requires Babel and is
  slower to start than Vitest in a Vite project. Rejected.
- **Cypress**: comparable to Playwright; Playwright wins on multi-engine
  coverage out of the box. Rejected.

---

## R13 — AI categorization & inconsistency detection (US6, FR-026..FR-029)

**Decision**: **In-browser, in-process** scoring using two complementary
heuristics over the operator's existing data:

1. **Category suggestion** — for an in-flight record, normalize
   `description + counterparty`, look up the most frequent category for
   exact-counterparty matches; if none, run a token-overlap (Jaccard or
   normalized inverted-index) score against historical descriptions and
   surface the highest-scoring category whose support meets a minimum
   threshold (e.g., ≥ 5 historical records). Confidence = score (clamped).
2. **Inconsistency detection** — periodic batch over the in-memory record
   set:
   - *Category mismatch*: a record whose `(counterparty, category)` pair is
     a minority outlier vs. the dominant pair for that counterparty,
     above a support threshold.
   - *Amount outlier*: amount more than `k × MAD` (median absolute
     deviation) outside the median for the record's `(category, type)`
     bucket, with a minimum bucket size.
   - *Likely duplicate*: same `(date, amount, type)` plus a high
     description/counterparty token-overlap, within a small date window.

   Findings carry the kind, the reason, and a basis (the records that
   triggered the rule) so the operator can verify per FR-028.

**Rationale**: Per the spec's assumption ("AI assistance runs locally or
via an in-browser model boundary") and Principle III, no remote model is
in scope. A heuristic approach is interpretable (the operator can see why
a suggestion was made), runs in milliseconds at 10k records, and degrades
gracefully (FR-029, SC-009) — when patterns are sparse we simply don't
suggest. SC-008 ("≥ 70% match on unambiguous patterns") is achievable by
construction with the exact-counterparty rule alone, since "unambiguous"
means the dominant category is, by definition, the right answer.

**Alternatives considered**:
- **Bundled WASM language model** (small classifier or ONNX model):
  multi-megabyte payload, opaque to the operator, unjustified per
  Principle VII for the SC-008 bar.
- **External LLM call**: forbidden by the Assumption that no financial
  data leaves the device by default.
- **`localStorage`-persisted learned model**: the heuristics already learn
  from the in-memory record set on each pass; persisting model state adds
  storage cost and migration burden for marginal benefit. The
  `Suggestion`/`InconsistencyFinding` data model is structured so a future
  persisted-model adapter can drop in without touching consumers.

---

## R14 — Linting and formatting

**Decision**: ESLint with `typescript-eslint` (recommended + `strict-type-
checked`), `eslint-plugin-import`, `eslint-plugin-promise`, `eslint-plugin-
unicorn` (selectively), plus Prettier for formatting. Wired through a
`pre-commit` hook (Husky + lint-staged) and re-run in CI.

**Rationale**: Principle VI requires tooling to enforce, not reviewer
memory. The chosen plugin set catches the categories the constitution
calls out (no implicit `any` at module boundaries, no silent `catch`,
no thrown non-`Error`). Prettier removes style debate.

**Alternatives considered**:
- **Biome** (rome successor): one tool for lint + format, very fast, but
  the typescript-eslint rule coverage is still broader. Worth revisiting
  in a future patch; not for the MVP.

---

## R15 — Heuristic column inference (in-browser, no dependencies)

**Decision**: Implement column inference as a pure-TypeScript module
(`src/modules/import/domain/inference/`) using two complementary signals
per column — a bilingual header-name regex score and a value-pattern
score over a bounded row sample (200 rows). The result is encapsulated
behind a `ColumnMapper` interface so a future AI strategy can replace it
without touching parsing, normalization, or validation (FR-048).

**Rationale**:
- **No new dependency** (Constitution Principle VII). The heuristics are
  ~300 LOC, deterministic, trivially unit-testable, and produce a stable
  `confidence ∈ [0, 1]` per column. No fuzzy-matching library is needed
  at the scope of ~10 canonical role names.
- **Interpretable**: the operator sees which header pattern matched and
  which value pattern matched. Confidence is grounded in observable
  rules rather than a model checkpoint, which matters in a bookkeeping
  product where the operator must trust the mapping before commit.
- **Deterministic + testable**: the SC-017 benchmark (20 heterogeneous
  fixture files, ≥ 80% auto-mapping accuracy) is reproducible run-to-run
  and bisectable when a regression lands.
- **Extensible**: the `ColumnMapper` interface (see
  [contracts/import-mapping.md](contracts/import-mapping.md) §6) lets a
  post-MVP AI-based mapper drop in. The pipeline already passes the
  `InferenceContext` (workspace currency, locale, sample-size limit) so
  the AI variant has the same signal surface.

**Alternatives considered**:
- **`Fuse.js` / `fast-fuzzy` for header matching**: a fuzzy-matching
  library would help with typos in non-canonical headers but adds a
  dependency (~7 kB gzipped) and the regex approach already handles
  bilingual variants explicitly. Rejected per Principle VII — revisit
  if SC-017 falls below 80% and the gap is concentrated on
  near-miss header names.
- **Bundled WASM language model (e.g., a small transformer or ONNX
  classifier)**: multi-megabyte payload, opaque to the operator, and
  the SC-017 bar of 80% on a constrained 5-role problem does not justify
  it. Recorded as the natural "AI variant" extension point; same
  rejection logic as R13 for AI categorization.
- **Asking an external LLM to classify columns**: forbidden by the
  Assumption that no financial data leaves the device by default.
  Rejected outright.

---

## R16 — CSV delimiter auto-detection

**Decision**: Configure PapaParse with `delimiter: ""` (empty string)
when parsing CSV files. This activates PapaParse's built-in
delimiter-detection heuristic which tries `,`, `;`, `\t`, and `|` and
picks the delimiter producing the most consistent column counts across
the first chunk of rows.

**Rationale**: Heterogeneous CSV files in the bookkeeping space use
comma (most US/UK sources), semicolon (most European and many Argentine
bank exports, because locale decimal separator is `,`), and tab (legacy
exports from spreadsheet software). Asking the operator to declare the
delimiter up-front is exactly the friction the flexible import flow
removes. PapaParse's auto-detect is well-tested and free.

**Alternatives considered**:
- **Asking the operator to pick the delimiter in the file picker
  step**: extra UI noise; operators often don't know the delimiter.
  Rejected.
- **Sniffing the delimiter ourselves**: re-implementing PapaParse's
  heuristic with no benefit. Rejected.

---

## R17 — JSON shape tolerance

**Decision**: Accept three JSON top-level shapes (array of objects;
object with a wrapper key whose value is an array of objects; NDJSON /
JSON-Lines). Detection is in order: array → wrapped → NDJSON. The
candidate wrapper keys (`records`, `data`, `transactions`, `items`,
`movements`, `rows`, `entries`, `list`, `payload`, `results`) are
checked in priority order. Other top-level fields under a wrapper are
reported to the UI as `meta.wrapperFields` but not propagated to records
in the MVP. See [contracts/import-json.schema.md](contracts/import-json.schema.md)
for the full contract.

**Rationale**: Real-world JSON exports vary in envelope shape (plain
array vs. wrapper with metadata vs. NDJSON). Forcing a canonical
`{schemaVersion, records[]}` envelope on every file — as the v1
contract did — meant every external tool's output required
pre-processing, which the flexible import flow exists to eliminate.
Accepting three shapes covers the overwhelming majority of real exports
without adding parsing complexity.

**Alternatives considered**:
- **Operator declares the JSON shape**: friction; operators usually
  don't know. Rejected.
- **Accept arbitrary nested structures and flatten them**: enables a
  combinatorial explosion of edge cases (nested arrays, nested
  objects). Rejected for MVP — flat object rows only, with
  nested-value cells stringified into `metadata`.
- **Require operator to provide a JSONPath expression to locate the
  records array**: too technical for the target operator. Rejected.

---

## R18 — Theme service & documented exception to Principle III

**Decision**: A small `src/core/theme/` module owns the operator's
preference for light / dark / system theme, persisting it under the
non-secret `localStorage` key `autokeep:theme`. The key is the **sole
documented exception** to Constitution Principle III (which routes all
`localStorage` access through `StorageAdapter`); ESLint's
`no-restricted-globals` rule allows-lists `src/core/theme/**` and
`src/core/storage/**` only.

**Rationale**:
- **Operates before unlock**: the theme must apply on the unlock screen
  (FR-040) — i.e., before any encrypted workspace blob is available.
  Routing the preference through `EncryptedStore` is a chicken-and-egg
  loop because `EncryptedStore` requires an unlocked workspace key,
  which requires the operator to type a passphrase, which requires the
  unlock screen to be rendered in the correct theme.
- **Non-secret, non-financial**: the preference is `'system' | 'light'
  | 'dark'`. It carries no record content, no identifier, no
  passphrase, no salt — nothing that SC-014 ("zero plaintext financial
  data at rest") covers.
- **Standard pattern**: every comparable SaaS (Stripe, Linear, GitHub,
  Vercel, Mercury) persists the same way, for the same reason.
- **Anti-flash guarantee**: a tiny inline script in `index.html` reads
  the key before paint and sets `<html data-theme>`, eliminating the
  flash-of-incorrect-theme on reload. The script is 4 lines, dependency-
  free, and isolated to the boot HTML.

**Alternatives considered**:
- **Cookie**: requires a backend (forbidden by Principle III) or
  document.cookie with all its security caveats; no benefit over
  `localStorage` for a non-secret value.
- **`sessionStorage`**: discards the choice when the tab closes — the
  operator must re-pick every session. Bad UX.
- **A second encrypted blob keyed off a separate passphrase**:
  proportionate complexity for a visual preference. Rejected.
- **In-memory only**: the operator's choice is lost on every reload.
  Rejected.

**Scope of the exception (locked)**: `src/core/theme/` may only read /
write the `autokeep:theme` key. Adding any other key is a Constitution
violation requiring a separate amendment. The ESLint allow-list is
narrow on purpose so future violations are caught by tooling, not
review.

---

## Open questions deferred to later phases

| ID | Topic | Why deferred |
|----|-------|---|
| OQ-1 | Concrete list of canonical categories (seed set) | Domain decision; can be added in `/speckit-tasks` Setup phase. |
| OQ-2 | Exact dashboard chart palette + icon set | Visual design decision; resolved during the UI task per module. |
| OQ-3 | Argon2 parameter calibration for the reference profile | Calibration task: timing measurement on the reference machine; placeholder values (`m=64MiB, t=3, p=1`) used until then. |
| OQ-4 | Jurisdictional financial-data compliance (flagged Outstanding-low in `/speckit-clarify`) | Out of scope until a target market is named. |

None of these block Phase 1 design.
