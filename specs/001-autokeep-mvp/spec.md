# Feature Specification: AutoKeep — Automated Bookkeeping SPA (MVP)

**Feature Branch**: `001-autokeep-mvp`

**Created**: 2026-05-12

**Status**: Draft

**Input**: User description: AutoKeep is a browser-based SPA for SMBs and mid-sized organizations that automates the recording, classification, and analysis of financial data. The MVP delivers CRUD over income/expense records, advanced search and filtering, CSV/JSON import and export with strict validation, an analytical dashboard of financial metrics, and AI-assisted category suggestions plus inconsistency detection. Persistence is local (browser only); no backend, no auth, no multi-user, no mobile, no banking integrations are in scope for the MVP.

## Clarifications

### Session 2026-05-12

- Q: Concurrent-tab conflict resolution — what happens if the operator edits the same record in two open tabs? → A: Optimistic concurrency: each record carries a version; the second save detects the mismatch, blocks the write, and surfaces a "this record changed in another tab — review and retry" dialog.
- Q: Filter responsiveness budget — what is the testable latency target for combined-filter recomputation? → A: At a 5,000-record dataset on a mid-tier laptop, p95 filter recomputation ≤ 100 ms and p95 keystroke-to-echo latency on the search input ≤ 50 ms; the input field MUST never block.
- Q: Accessibility & localization target — what is the MVP commitment for accessibility and language/locale? → A: WCAG 2.1 Level AA conformance, Spanish (es) UI strings only for the MVP, and locale-aware date and number formatting selectable per workspace.
- Q: At-rest protection of financial data in `localStorage` — what is the MVP security posture? → A: Operator-set passphrase derives a key via a strong KDF (Argon2id preferred; PBKDF2-SHA-256 with high iteration count acceptable), the workspace payload is encrypted with an authenticated cipher (AES-GCM) before being written to `localStorage`, and the operator is prompted for the passphrase on app open. The passphrase is **never** stored or transmitted; loss of passphrase means the workspace is unrecoverable. This refines FR-034 to permit a **local-only unlock passphrase** for at-rest encryption while still prohibiting remote accounts, server-side auth, account recovery flows, and multi-user.
- Q: Maximum supported dataset size per workspace for the MVP → A: Up to **10,000 records** per workspace; soft warning surfaced to the operator at **8,000 records**; **hard refusal** of new record creation and import-commit at **12,000 records** with an "export and start a new workspace" path. Read, edit, delete, filter, dashboard, and export operations remain available above the hard cap so the operator can recover.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage financial records (CRUD) (Priority: P1)

A finance operator at an SMB needs to capture day-to-day income and expense entries, correct mistakes, and remove invalid records. They open AutoKeep in a desktop browser, create entries with date / amount / type / category / description / counterparty, edit one when a typo is found, and delete duplicates. All changes persist locally so the next session starts where they left off.

**Why this priority**: Without record management, no other module has data to act on. This is the smallest viable slice and the foundation of every other feature.

**Independent Test**: Can be fully tested by opening a fresh AutoKeep session, creating several income and expense records, editing and deleting some, refreshing the browser, and verifying the records are intact and reflect the latest edits.

**Acceptance Scenarios**:

1. **Given** an empty AutoKeep workspace, **When** the operator submits a valid income record (date, amount > 0, category, description), **Then** the record appears in the records list and persists across browser refresh.
2. **Given** an existing record, **When** the operator edits its amount and saves, **Then** the list and any open totals/dashboard reflect the new value within the same session without a manual refresh.
3. **Given** an existing record, **When** the operator deletes it and confirms, **Then** the record is removed from the list and is gone after refresh.
4. **Given** an attempt to create a record with an invalid amount (zero, negative, non-numeric) or a missing required field, **When** the operator submits, **Then** the form rejects the submission, surfaces a clear field-level error, and no record is created.

---

### User Story 2 - Advanced search and combined real-time filters (Priority: P1)

The operator has hundreds to thousands of records and needs to narrow them down quickly to answer questions like "expenses to supplier X in Q1" or "all income above 5,000 in March, category Services". They combine a free-text search with filters on date range, type (income/expense), category, amount range, and counterparty, and see results update as they type/adjust filters, with a clear indicator of how many records match.

**Why this priority**: Filtering is the primary way operators find and trust their data. It also gates the export and dashboard slices, since both rely on the active result set being correct.

**Independent Test**: Can be fully tested by importing or creating a representative dataset, applying each filter individually and in combinations, and verifying that the result count and the visible rows match the expected subset for each combination.

**Acceptance Scenarios**:

1. **Given** at least 100 records spanning multiple categories and dates, **When** the operator types a partial counterparty name in the search box, **Then** results refine within the latency budget defined in SC-002 and the result count updates accordingly.
2. **Given** an active free-text search, **When** the operator additionally selects a date range and a category, **Then** the displayed records satisfy ALL active filters simultaneously and an "active filters" summary is visible.
3. **Given** active filters with zero matches, **When** results are recomputed, **Then** an empty-state message explains why and offers a one-click way to clear filters.
4. **Given** a large dataset, **When** filters are adjusted rapidly, **Then** the UI remains responsive (no frozen input, no dropped keystrokes) throughout.

---

### User Story 3 - Import CSV/JSON files with strict validation (Priority: P1)

The operator needs to bring in historical or externally produced records. They select a CSV or JSON file, AutoKeep validates the structure and every row against the expected schema BEFORE saving anything, shows a per-row report of what is valid and what is rejected with reasons, and lets the operator confirm import of the valid rows (or cancel everything).

**Why this priority**: Import unblocks realistic dataset sizes and is the most error-prone flow in bookkeeping tools. Failing import quality destroys data trust on day one.

**Independent Test**: Can be fully tested by importing (a) a fully valid file, (b) a file with mixed valid/invalid rows, (c) a file with a wrong header/structure, and verifying the validation report, the partial/atomic import behavior, and that the records list reflects only the rows the operator confirmed.

**Acceptance Scenarios**:

1. **Given** a CSV or JSON file matching the documented import schema, **When** the operator selects it, **Then** a validation summary lists total rows, valid rows, and invalid rows with a downloadable/visible per-row error reason for each rejection.
2. **Given** a file with 0 valid rows, **When** validation completes, **Then** the operator is told nothing can be imported and offered the validation report; no records are written.
3. **Given** a file with N valid rows and M invalid rows, **When** the operator confirms "import valid rows only", **Then** exactly N records are created and the M invalid rows are NOT silently dropped — they remain in the report.
4. **Given** a large import file, **When** validation and import run, **Then** the UI remains responsive, shows progress, and the operator can cancel before the records are committed.
5. **Given** an unsupported file (wrong type, malformed JSON, CSV with mismatched headers), **When** the operator selects it, **Then** the file is rejected at the boundary with an explanation and zero records are touched.

---

### User Story 4 - Filtered export to CSV/JSON (Priority: P2)

The operator has narrowed records via filters (US2) and wants to share the result with an accountant or back it up. They click export, choose CSV or JSON, and receive a file containing exactly the currently filtered records, in a stable, documented field order.

**Why this priority**: Export depends on US2 being trustworthy and is the primary handoff channel given there is no backend or sharing surface. P2 because it is unblocking only after records and filters exist.

**Independent Test**: Can be fully tested by applying a known filter, exporting to both formats, and verifying the file contents exactly match the visible filtered set in count, fields, and values, with a consistent field/column order.

**Acceptance Scenarios**:

1. **Given** an active filter producing N records, **When** the operator exports as CSV, **Then** the resulting CSV has N data rows plus a header row, with columns in a documented stable order.
2. **Given** an active filter producing N records, **When** the operator exports as JSON, **Then** the resulting JSON is an array of N record objects with a documented schema (and a top-level `schemaVersion`).
3. **Given** zero records match the active filter, **When** the operator attempts to export, **Then** they are warned and no empty file is silently produced (or an empty-but-valid file is produced only after explicit confirmation).
4. **Given** an export of a re-imported file, **When** the same file is round-tripped (export → re-import), **Then** the resulting records are equivalent to the originals (no data loss in the supported field set).

---

### User Story 5 - Analytical financial dashboard (Priority: P2)

The operator wants an at-a-glance view of the business's financial state: total income, total expenses, net result, evolution over time, top categories, and top counterparties — for a chosen period and respecting any active filters. They open the dashboard, change the period (e.g., this month, last quarter, custom range), and read the metrics and charts.

**Why this priority**: Dashboard is the analytical payoff that justifies clean records and filters. P2 because it depends on US1–US3 producing trustworthy data.

**Independent Test**: Can be fully tested by loading a known dataset, choosing a period, and verifying that each displayed metric (totals, net, top categories, evolution) matches an independently computed expected value for that period.

**Acceptance Scenarios**:

1. **Given** records exist within a chosen period, **When** the operator opens the dashboard for that period, **Then** total income, total expenses, and net result are displayed and equal the sum of the records in scope.
2. **Given** the operator changes the period selector, **When** the new period is applied, **Then** all dashboard widgets recompute consistently and reflect only the records in the new period.
3. **Given** active filters from US2, **When** the operator opens the dashboard, **Then** the dashboard reflects the same filtered scope (the operator can clearly see which filters are applied).
4. **Given** an empty period, **When** the dashboard renders, **Then** each widget shows an empty-state instead of a misleading zero/NaN.

---

### User Story 6 - AI-assisted category suggestions and inconsistency detection (Priority: P3)

When creating or editing a record, the operator gets a suggested category based on the description/counterparty and prior records. Periodically, AutoKeep highlights records that look inconsistent (e.g., same counterparty usually categorized as "Utilities" but once as "Travel"; an amount that is an outlier for that category) so the operator can confirm or correct them. The operator is always in control — suggestions never auto-apply without confirmation.

**Why this priority**: Real productivity gain on top of a working system. P3 because it amplifies value but does not unlock it; the product must work without it.

**Independent Test**: Can be fully tested by populating a dataset with a learnable pattern (e.g., 20 records to "Acme Corp" categorized as "Utilities"), creating a new record for "Acme Corp" with no category, and verifying that "Utilities" is suggested; and by introducing one inconsistent record and verifying the inconsistency report flags it.

**Acceptance Scenarios**:

1. **Given** a history with a clear category pattern for a counterparty/description, **When** the operator creates a new record matching that pattern with category empty, **Then** a category is suggested with a visible confidence indicator and is NOT applied until the operator accepts it.
2. **Given** the operator rejects a suggestion or chooses a different category, **When** they save, **Then** the chosen category is the one stored and the rejection informs future suggestions for similar inputs.
3. **Given** an existing dataset, **When** the operator opens the inconsistencies report, **Then** records that deviate from learned patterns (category mismatch, amount outliers, duplicate-looking entries) are listed with the reason, and the operator can confirm the record as correct or open it to edit.
4. **Given** the suggestion/inconsistency feature is unavailable for any reason, **When** the operator uses any other feature, **Then** the rest of the application continues to work normally.

---

### Edge Cases

- **localStorage quota exceeded**: when the browser's local storage is full, what does the operator see and how is data integrity preserved? (Expected: the failing write is rolled back, the operator is warned, and an export is offered.)
- **Concurrent tabs**: the operator opens AutoKeep in two browser tabs and edits the same record in both. Per FR-036, optimistic concurrency applies: the second save is blocked when the in-storage `version` no longer matches the version the editing tab loaded, and the operator is shown a "this record changed in another tab — review and retry" dialog with the option to reload the latest record into the form.
- **Browser data cleared**: the operator (or a "clear browsing data" action) wipes localStorage. The app must surface an empty-state and not crash; documentation must make clear that exports are the backup mechanism.
- **Very large datasets**: per FR-041 the MVP caps a workspace at 10,000 records, warns at 8,000, and hard-refuses writes at 12,000. Within that envelope, filtering, dashboard, import, and export MUST remain responsive (no main-thread freezes) per SC-002 / SC-003. Beyond the cap, read-side operations remain available and the operator is guided toward export + new-workspace.
- **Locale-specific numbers and dates** in imported files (commas vs. dots as decimal separators, DD/MM/YYYY vs. MM/DD/YYYY). The import schema must be explicit about the expected format and reject ambiguous values.
- **Currency**: the MVP assumes a single reporting currency (see Assumptions); imports with mixed currencies must be rejected at validation.
- **Duplicate detection on import**: how are records that look identical to existing ones handled? (Expected: flagged in the validation report, operator decides per-batch.)
- **AI suggestion with sparse history**: when there is not enough data to suggest reliably, no suggestion is shown rather than a low-confidence guess.
- **Forgotten passphrase**: under FR-040 the workspace cannot be recovered without the passphrase. The setup flow MUST make this explicit, MUST encourage the operator to keep an unencrypted export as an offline backup, and MUST offer a clearly-labelled "start a new empty workspace" path that does not pretend to recover the encrypted one.
- **Passphrase entry on an untrusted device**: outside the threat model — the spec assumes the operator's own device (see Assumptions). Documentation MUST advise against using AutoKeep on shared/public machines.
- **AI feature degradation**: if AI categorization/inconsistency detection is unavailable, the rest of the app must remain fully functional (US6 acceptance scenario 4).

## Requirements *(mandatory)*

### Functional Requirements

**Records management (US1)**

- **FR-001**: System MUST allow operators to create, read, update, and delete financial records of two kinds: **income** and **expense**.
- **FR-002**: System MUST require the following fields on every record: date, amount, type (income | expense), category, description; and SHOULD support an optional counterparty field.
- **FR-003**: System MUST validate amounts as positive numbers using a consistent decimal convention; MUST reject zero, negative, and non-numeric values at the form boundary with a field-level error.
- **FR-004**: System MUST persist all records locally in the operator's browser so that data survives page refresh and browser restart on the same device and profile.
- **FR-005**: System MUST keep stored data versioned (a `schemaVersion` marker on the persisted payload) so future migrations are possible without data loss.

**Search and filtering (US2)**

- **FR-006**: System MUST provide a free-text search across description and counterparty.
- **FR-007**: System MUST provide combinable filters for: date range, type, category (multi-select), amount range, and counterparty.
- **FR-008**: System MUST recompute results in real time as filters and search input change, and display the count of matching records.
- **FR-009**: System MUST surface the active filter set explicitly and allow clearing all filters in a single action.
- **FR-010**: System MUST keep the UI responsive while filtering large datasets — filtering work that would block the UI MUST be offloaded so input stays interactive.

**Import (US3)**

- **FR-011**: System MUST support importing records from CSV and JSON files.
- **FR-012**: System MUST validate the file structure and every row against a documented import schema BEFORE writing any record to storage.
- **FR-013**: System MUST present a per-row validation report distinguishing valid rows from invalid rows, and MUST state the rejection reason for each invalid row.
- **FR-014**: System MUST give the operator an explicit choice: import only the valid rows, or cancel the entire import; the system MUST NOT silently import partial data without that confirmation.
- **FR-015**: System MUST reject files that fail structural validation (wrong type, malformed, header/key mismatch) without writing any records.
- **FR-016**: System MUST run import validation and ingestion without freezing the UI; progress MUST be visible and a cancel action MUST be available before commit.

**Export (US4)**

- **FR-017**: System MUST support exporting the current filtered result set as CSV and as JSON.
- **FR-018**: System MUST use a documented, stable field/column order across exports of the same kind so files are diff-friendly and re-importable.
- **FR-019**: System MUST include a `schemaVersion` marker in JSON exports so consumers (and future re-imports) can interpret the file safely.
- **FR-020**: System MUST warn before producing an export of zero records, and MUST NOT silently produce an empty file without confirmation.

**Analytical dashboard (US5)**

- **FR-021**: System MUST display total income, total expenses, and net result for a chosen period.
- **FR-022**: System MUST display evolution of income, expenses, and net over time at a granularity appropriate to the chosen period (day / week / month).
- **FR-023**: System MUST display top categories and top counterparties by amount for the chosen scope.
- **FR-024**: System MUST honor active filters from US2 when computing dashboard metrics, and MUST clearly indicate which filters/period are in effect.
- **FR-025**: System MUST render an explicit empty-state for any widget whose scope produces no data, instead of a misleading numeric zero.

**AI assistance (US6)**

- **FR-026**: System MUST suggest a category for a record based on the description, counterparty, and prior records; suggestions MUST display a confidence indicator and MUST NOT be auto-applied.
- **FR-027**: System MUST learn from operator confirmations and rejections so that future suggestions for similar inputs reflect the operator's actual choices.
- **FR-028**: System MUST provide an inconsistencies report listing records that deviate from learned patterns (category mismatch, amount outliers, likely duplicates), each with a stated reason.
- **FR-029**: System MUST remain fully functional in all other modules if the AI assistance subsystem is unavailable or disabled.

**Cross-cutting**

- **FR-030**: System MUST be a Single Page Application running entirely in the operator's browser; no server-side component is in scope for the MVP.
- **FR-031**: System MUST be responsive on desktop viewports as the primary target, and MUST remain usable (no broken layouts, no inaccessible controls) on smaller laptop and tablet-landscape viewports.
- **FR-032**: System MUST surface clear, actionable error messages for every failure path (validation, storage, import/export); errors MUST NOT be silent.
- **FR-033**: System MUST warn the operator when local storage is near or at capacity and offer an export path before further writes are attempted. The dataset-size limits in FR-041 are independent of and additional to this storage-quota warning; both warnings can apply.
- **FR-034**: System MUST NOT require remote user accounts, server-side authentication, account-recovery flows, or multi-user access in the MVP. A **local-only unlock passphrase** used exclusively as the key-derivation source for at-rest encryption (FR-040) is permitted and is NOT considered server-side authentication; it never leaves the operator's device.
- **FR-035**: System MUST NOT integrate with banks, accounting providers, or any external financial service in the MVP.
- **FR-036**: System MUST apply optimistic concurrency control on every record update: each Financial Record carries a monotonically increasing `version`; on save, the system MUST compare the in-storage `version` against the version the editing surface loaded, MUST reject the save if they differ, and MUST present a conflict dialog that lets the operator inspect the current stored record and re-apply (or discard) their pending changes. The system MUST NOT silently overwrite a record whose version has advanced.
- **FR-037**: System MUST conform to **WCAG 2.1 Level AA** across all primary flows (records CRUD, filters, import, export, dashboard, AI suggestions/inconsistencies). This includes full keyboard operability, visible focus indicators, accessible names and roles for interactive elements, color-contrast minimums, error identification and instructions, and screen-reader-friendly labelling for dashboard widgets and the import validation report.
- **FR-038**: System MUST present its UI in **Spanish (es)** for the MVP. The copy layer MUST be structured so that adding additional languages later is a localized change (no copy hardcoded inside business-logic modules).
- **FR-039**: System MUST format dates and numbers using a workspace-level locale setting (default: `es`) so that displayed values match the operator's regional convention. Locale-aware formatting MUST apply uniformly across records, filters, dashboard, and exports for human-facing output. The import schema (FR-012) and JSON export (FR-019) remain in their own documented machine-readable formats independent of the display locale.
- **FR-040**: System MUST encrypt the workspace payload at rest before writing to local storage. Requirements:
  - On first run, the operator sets a workspace **passphrase**; on every subsequent app open, the operator MUST enter the passphrase to unlock the workspace.
  - A workspace **encryption key** MUST be derived from the passphrase via a strong KDF (Argon2id preferred; PBKDF2-SHA-256 with at least 600,000 iterations acceptable) using a per-workspace random salt persisted alongside the encrypted payload.
  - Records and any other operator data persisted to local storage MUST be encrypted with an **authenticated** cipher (AES-256-GCM) using a per-write random IV/nonce. Plaintext financial data MUST NOT be persisted at any point.
  - The passphrase MUST NOT be stored anywhere — neither in storage, nor in memory beyond the unlock window — and MUST NEVER be transmitted off the device.
  - There is **no recovery channel**: loss of the passphrase means the encrypted workspace is unrecoverable. The operator MUST be informed of this clearly during passphrase setup.
  - The operator MUST be able to **change** the passphrase from within the app; changing the passphrase re-derives the key and re-encrypts the workspace.
  - Exports (FR-017) MUST be unencrypted by default (so they remain re-importable and human-readable). The operator MAY choose at export time to produce an encrypted export protected by a passphrase of their choice; the same KDF + authenticated-cipher requirements apply.
- **FR-041**: System MUST enforce a workspace-level dataset cap:
  - The MVP supports up to **10,000 records** per workspace.
  - At **8,000 records** the system MUST display a non-blocking soft warning informing the operator that the workspace is approaching its capacity and recommending an export.
  - At **12,000 records** the system MUST refuse all new record creation and any import commit that would push the total above 12,000, with a clear blocking message that explains the limit and offers an "export current data and start a new workspace" path.
  - Above the hard cap, **read, edit, delete, filter, dashboard, and export operations MUST remain available** so the operator can recover; only writes that increase the record count are blocked.
  - Imports that would partially fit MUST be presented with the count that would land within the cap and the count that would be rejected; the operator MUST explicitly confirm partial import or cancel.

### Key Entities *(include if feature involves data)*

- **Financial Record**: a single income or expense event. Attributes (conceptual): unique identifier, date, type (income | expense), amount, category, description, optional counterparty, created-at and updated-at timestamps, source (manual | import), a monotonically increasing `version` used for optimistic concurrency control across browser tabs (FR-036), and a record-level `schemaVersion`. A record always belongs to exactly one category.
- **Category**: a label used to classify records (e.g., "Utilities", "Sales", "Travel"). Attributes: name, optional parent (for grouping), optional learned-from-AI flag. A category may be referenced by many records.
- **Counterparty**: the other side of a transaction (e.g., a supplier or client). Attributes: name, optional aliases. A counterparty may be referenced by many records and informs both filtering and AI suggestions.
- **Import Batch**: a logical record of one import operation. Attributes: source filename, format (CSV | JSON), timestamp, total/valid/invalid row counts, per-row error report, operator confirmation outcome (imported valid | cancelled). Used for traceability of imported data.
- **Validation Report**: produced for every import. Attributes: per-row status, rejection reasons, structural-error summary. Not persisted as a long-lived entity in the MVP but MUST be visible to the operator before commit.
- **Filter State**: the currently active free-text query plus selected filters (date range, type, categories, amount range, counterparty). Drives the records view, exports, and the dashboard scope.
- **Dashboard Period**: the time window selected for analytical widgets (preset like "this month" / "last quarter" or custom range). Combined with Filter State to define the analytical scope.
- **Suggestion**: a category proposed by the AI subsystem for a record being created/edited. Attributes: proposed category, confidence indicator, basis (which prior records / pattern). Never auto-applied.
- **Inconsistency Finding**: a flag raised by the AI subsystem on an existing record. Attributes: target record, kind (category mismatch | amount outlier | likely duplicate), reason, status (open | dismissed | resolved-by-edit).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can create their first valid financial record within **2 minutes** of opening the application for the first time, with no documentation.
- **SC-002**: For a dataset of **5,000 records** on a mid-tier laptop (reference profile: 4-core CPU at ~2.4 GHz, 8 GB RAM, current evergreen browser, no other heavy tabs), **p95 filter recomputation latency ≤ 100 ms** and **p95 keystroke-to-echo latency on the search input ≤ 50 ms** across any combination of free-text search and filters from FR-007. The search input MUST remain interactive at all times (no dropped keystrokes, no frozen caret).
- **SC-003**: Importing a **5,000-row** CSV or JSON file produces a complete validation report and either fully imports the valid rows or rejects the file, with the UI remaining responsive (operator can cancel) throughout the operation.
- **SC-004**: **100% of CSV/JSON files** that fail structural validation are rejected before any record is written; **0 records** end up persisted from a rejected import in any test scenario.
- **SC-005**: For an exported file (CSV or JSON) that is then re-imported into a clean workspace, **100% of records** round-trip with equivalent values across the supported field set.
- **SC-006**: Dashboard totals (income, expenses, net) for any chosen period and filter state match an independently computed expected value to the cent for **100% of test scenarios**.
- **SC-007**: After clearing the browser tab and reopening, the operator finds **100% of previously saved records** intact, in the same state as before close.
- **SC-008**: When AI category suggestion is presented and the underlying pattern is unambiguous in the dataset, the suggested category matches the operator's eventual choice in **at least 70%** of cases (measurable on a labeled evaluation set).
- **SC-009**: When the AI subsystem is disabled or unavailable, **all non-AI user stories (US1–US5)** remain fully usable with no degradation in correctness.
- **SC-010**: Operators report that AutoKeep reduces the time spent on routine bookkeeping data entry and lookups by **at least 40%** versus their prior workflow, measured via a structured post-pilot survey.
- **SC-011**: **Zero silent data loss** events across all MVP test scenarios — every failed write, rejected import, or quota event surfaces an actionable message to the operator.
- **SC-012**: All primary flows pass an automated WCAG 2.1 AA audit (axe-core or equivalent) with **zero critical or serious issues**, and a manual keyboard-only walkthrough completes every primary flow (records CRUD, filters, import, export, dashboard, AI suggestion accept/reject) **without using a pointing device**.
- **SC-013**: 100% of human-facing date and number values across records, filters, dashboard, and exports honor the active workspace locale; switching the workspace locale updates **100% of those displays** without requiring a reload.
- **SC-014**: Inspection of the underlying browser storage on a locked workspace reveals **zero plaintext financial data** — no record fields, no descriptions, no counterparties, no amounts — across **100% of test scenarios**. The KDF parameters and the authenticated cipher (AES-256-GCM with per-write IV) match FR-040 in all persisted payloads.
- **SC-015**: Entering an incorrect workspace passphrase fails the unlock with a clear error and does **not** decrypt or expose any record. After **5 consecutive incorrect attempts within 60 seconds**, the unlock UI imposes a progressive delay before the next attempt to slow brute-forcing.
- **SC-016**: At **8,000 records** the soft-cap warning is displayed in **100% of test scenarios**; at **12,000 records** every attempted new-record creation and every import commit that would exceed the cap is **blocked with an actionable message in 100% of test scenarios**, while read, edit, delete, filter, dashboard, and export operations continue to succeed.

## Assumptions

- **Single user, single device per workspace.** No remote accounts, no server-side authentication, no multi-user collaboration in the MVP; data lives in the operator's browser profile on the device they used. A local-only unlock passphrase (FR-040) protects the workspace at rest and is intentionally not a multi-user mechanism.
- **Single reporting currency per workspace.** Amounts are stored and displayed in one currency; mixed-currency imports are rejected at validation. Choice of currency is an operator setting; no FX conversion is performed.
- **Desktop-first responsive UI.** Primary target is desktop browsers; the layout must remain usable on smaller laptop and tablet-landscape sizes, but a dedicated mobile experience is out of scope.
- **Modern evergreen browsers.** The application targets current versions of mainstream desktop browsers; legacy browser support is out of scope.
- **Spanish-speaking primary audience.** UI copy is delivered in Spanish for the MVP (FR-038); additional languages are a post-MVP concern. Display locale for dates and numbers defaults to `es` and is selectable per workspace (FR-039).
- **Workspace sizing for PYMES.** A 10,000-record cap (FR-041) is sized for roughly one to two years of activity for a typical small business at ~30–60 transactions/day. Operators with higher volumes are expected to segment by year/period and use the export + new-workspace path; multi-workspace tooling is a post-MVP concern.
- **Backups are the operator's responsibility, supported by the export feature.** Because storage is local and there is no passphrase recovery path (FR-040), the export flow is the documented backup mechanism; AutoKeep MUST surface this both when storage pressure occurs and during initial passphrase setup.
- **AI assistance runs locally or via an in-browser model boundary** so that no financial data leaves the operator's device by default; if a remote model is ever introduced, that becomes a separate spec with explicit operator consent.
- **Import schema is explicit and documented.** Files must conform to a published shape; "best-effort" auto-inference of unknown shapes is out of scope for the MVP.
- **Date and decimal formats in imports are explicit.** The import schema fixes the expected formats; ambiguous values are rejected rather than guessed.
- **No banking integrations, no accountant workflows, no tax/legal advisory** in the MVP — these are explicitly out of scope per the product brief.
- **No telemetry of financial values.** Any usage analytics, if added later, MUST be limited to anonymous usage signals and MUST NOT include record contents.
