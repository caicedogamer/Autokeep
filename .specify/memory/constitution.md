<!--
SYNC IMPACT REPORT
==================
Version change: TEMPLATE (unfilled) → 1.0.0
Bump rationale: Initial ratification of the AutoKeep constitution from the
unfilled template. MAJOR version is appropriate for the first concrete adoption.

Modified principles:
  - [PRINCIPLE_1_NAME] → I. Arquitectura SPA Modular y Desacoplada
  - [PRINCIPLE_2_NAME] → II. Separación Estricta entre Lógica y Presentación
  - [PRINCIPLE_3_NAME] → III. Persistencia Local Primero (NON-NEGOTIABLE)
  - [PRINCIPLE_4_NAME] → IV. CSS Puro y Estilos Modulares (NON-NEGOTIABLE)
  - [PRINCIPLE_5_NAME] → V. Validación de Datos y Procesamiento No-Bloqueante (NON-NEGOTIABLE)

Added principles (beyond original 5-slot template):
  - VI. Calidad de Código, Tipado y Preparación para Pruebas
  - VII. Justificación Tecnológica Obligatoria

Added sections:
  - Restricciones Técnicas y Stack (replaces [SECTION_2_NAME])
  - Flujo de Desarrollo y Revisión (replaces [SECTION_3_NAME])

Removed sections: none

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check section is
    populated with the seven principle gates below; Technical Context fields
    align with the stack constraints in this constitution.
  - ✅ .specify/templates/spec-template.md — No structural changes required;
    spec authors must continue to keep specs technology-agnostic per Principle II.
  - ✅ .specify/templates/tasks-template.md — Task categorization (Setup,
    Foundational, User Stories, Polish) supports Principles I, II, V, VI;
    no edits needed at this version.
  - ✅ .specify/templates/checklist-template.md — Generic checklist format is
    compatible; no edits needed.
  - ✅ CLAUDE.md — Project guidance points contributors at the active plan,
    which itself references this constitution; no edits needed at v1.0.0.

Follow-up TODOs: none. All placeholders resolved.
-->

# AutoKeep Constitution

## Core Principles

### I. Arquitectura SPA Modular y Desacoplada

AutoKeep MUST be built as a Single Page Application (SPA) using
JavaScript/TypeScript, organized into independent, reusable modules with
explicit data contracts at every module boundary. Each module MUST be
independently loadable, independently testable, and free of hidden coupling
to other modules; cross-module communication MUST happen through documented
interfaces (typed function signatures, event payloads, or DTOs), never
through shared mutable globals. Maintainability and scalability take
precedence over prototyping speed: a slower, well-bounded module is
preferred over a fast monolithic one.

**Rationale:** AutoKeep is expected to grow beyond the MVP and migrate
parts of its logic to a backend. Hard module boundaries from day one keep
the cost of that growth bounded.

### II. Separación Estricta entre Lógica y Presentación

Business logic (data parsing, validation, transformation, domain rules,
persistence calls) MUST live in modules that contain zero direct DOM
manipulation, zero framework-specific view code, and zero coupling to a
specific storage backend. The visual layer MUST consume business logic
through typed interfaces only. Any function that today calls `localStorage`
MUST go through a storage adapter so that a future REST API client can
replace the adapter without changing call sites.

**Rationale:** The roadmap explicitly calls for migrating storage to a REST
API later. Reaching that point without rewriting the UI requires the
separation to be enforced now, not retrofitted.

### III. Persistencia Local Primero — localStorage Only for MVP (NON-NEGOTIABLE)

For the MVP, persistence MUST use `localStorage` exclusively. The codebase
MUST NOT introduce backend services, remote databases, IndexedDB wrappers,
service workers for sync, authentication providers, or any other
infrastructure dependency. All storage access MUST go through a single
storage adapter module so that swapping the adapter for a REST client later
is a localized change. Data shapes written to `localStorage` MUST be
versioned (e.g., a `schemaVersion` field on stored payloads) so future
migrations are possible.

**Rationale:** Premature backend dependencies inflate scope, slow down
iteration, and lock decisions before they are informed by real usage.
Constraining the MVP to `localStorage` keeps the team focused on product
value while leaving the migration path open via the adapter from
Principle II.

### IV. CSS Puro y Estilos Modulares (NON-NEGOTIABLE)

Styling MUST use plain CSS organized into per-module files, with a
consistent and documented naming convention (e.g., BEM or an equivalent
chosen and recorded in the plan). Heavyweight visual frameworks
(Bootstrap, Material UI, Tailwind's full preset, etc.) are PROHIBITED for
the MVP. Lightweight utilities are permitted ONLY if they (a) are
tree-shakable, (b) add no runtime cost beyond the classes actually used,
and (c) are justified per Principle VII. Global styles MUST be limited to
resets, design tokens (colors, spacing, typography), and base typography;
component-scoped styles MUST NOT leak.

**Rationale:** Heavy CSS frameworks introduce conventions, build steps, and
cognitive load that the MVP does not need and that obscure ownership of
visual decisions. Plain modular CSS keeps the surface area small and the
intent explicit.

### V. Validación de Datos y Procesamiento No-Bloqueante (NON-NEGOTIABLE)

Every CSV or JSON input MUST be validated against an explicit schema
BEFORE any downstream processing or persistence; invalid input MUST be
rejected with an actionable error and MUST NOT reach storage. Any
operation that is potentially intensive — full-file parses, bulk
transformations, large sorts/filters, schema validation over big payloads —
MUST run off the main thread (Web Worker, chunked iteration with
`requestIdleCallback`, or async generators yielding control). The UI MUST
remain responsive during such operations and MUST surface progress or a
loading state.

**Rationale:** The product manipulates user-supplied files; bad data and
frozen tabs are the two failure modes most likely to destroy trust.
Both are preventable by enforcing validation and threading discipline at
the contract level rather than relying on author vigilance.

### VI. Calidad de Código, Tipado y Preparación para Pruebas

Code MUST be readable, consistently typed (TypeScript types or, where JS
is used, JSDoc with `checkJs` enabled), and MUST handle errors explicitly —
no silent `catch` blocks, no thrown values that are not `Error` instances,
no implicit `any` at module boundaries. Modules MUST be structured so they
are unit-testable without a DOM (pure functions, dependency-injected
adapters); even when no tests are written for the MVP, the structure MUST
permit them to be added without refactoring. Linting and type-checking
MUST be enforced by tooling, not by reviewer memory.

**Rationale:** "We'll add tests later" only works if the code is shaped
to receive them. Enforcing testable structure now keeps that door open at
zero ongoing cost.

### VII. Justificación Tecnológica Obligatoria

Every new dependency, framework, build tool, or technological choice MUST
be justified IN WRITING (in the relevant plan or PR description) by its
direct impact on at least one of: performance, maintainability, or
scalability. "It's popular," "it's modern," or "it's faster to prototype
with" are NOT acceptable justifications. The justification MUST identify
the simpler alternative considered and explain why it was rejected.
Additions that fail this gate MUST be removed.

**Rationale:** Tech sprawl is the single largest source of long-term
maintenance cost. A written justification is cheap insurance and forces
the comparison with the simpler alternative that is otherwise easy to
skip.

## Restricciones Técnicas y Stack

- **Lenguajes:** JavaScript and/or TypeScript only for application code.
  TypeScript is preferred; pure JS modules MUST use JSDoc types and be
  type-checked.
- **Arquitectura:** SPA. No multi-page server-rendered fallback in the MVP.
- **Estilos:** Plain CSS in per-module files; no heavy CSS framework.
- **Persistencia:** `localStorage` only, accessed exclusively through a
  storage adapter module.
- **Backend:** None during the MVP. No HTTP server, no database, no auth
  provider.
- **Concurrencia:** Web Workers or chunked async patterns for any
  potentially long-running operation. The main thread MUST stay
  interactive.
- **Validación:** Explicit schema validation for every CSV/JSON ingress
  point. Invalid data is rejected at the boundary, never partially
  imported.
- **Dependencias externas:** Each one passes Principle VII before being
  added. Heavyweight UI frameworks are disallowed for the MVP.
- **Datos almacenados:** Versioned payloads (`schemaVersion`) to keep
  future migrations feasible.

## Flujo de Desarrollo y Revisión

- **Plan-first:** Non-trivial features go through `/speckit-specify` →
  `/speckit-plan` → `/speckit-tasks` before implementation. Plans MUST
  include a Constitution Check that explicitly addresses every principle
  above.
- **Constitution Check gate:** A plan that violates a NON-NEGOTIABLE
  principle (III, IV, V) MUST NOT proceed to implementation. Violations
  of other principles MUST be recorded in the plan's Complexity Tracking
  table with a written justification.
- **Code review:** Every change MUST be reviewed against the principles.
  Reviewers MUST reject changes that introduce backend dependencies,
  heavy CSS frameworks, unvalidated data ingress, main-thread blocking,
  or untyped/unhandled-error code paths.
- **Testing posture:** Tests are not mandated for every MVP task, but the
  code MUST remain test-ready (Principle VI). When tests are written,
  they MUST be able to run without a real DOM for business-logic modules.
- **Tooling enforcement:** Linting, type-checking, and (when present)
  tests MUST run in CI or in a documented pre-commit step. Skipping
  these checks on a per-PR basis is not allowed.
- **Amendments:** Any change to this constitution follows the Governance
  rules below.

## Governance

This constitution supersedes ad-hoc conventions and informal preferences.
When a tutorial, template, or third-party recommendation conflicts with
the principles above, the constitution wins.

- **Amendment procedure:** Proposed changes MUST be submitted as a PR that
  edits this file, includes the Sync Impact Report comment block, and
  updates any dependent templates flagged in that report. The PR MUST
  state the version bump and its rationale.
- **Versioning policy:** Semantic versioning applies to the constitution
  itself.
  - **MAJOR** — a principle is removed, redefined incompatibly, or its
    NON-NEGOTIABLE status changes.
  - **MINOR** — a new principle or section is added, or an existing one
    is materially expanded.
  - **PATCH** — wording, clarifications, typo fixes, or non-semantic
    refinements.
- **Compliance review:** Every plan MUST pass the Constitution Check
  gate. Every PR review MUST verify compliance with the principles
  relevant to the change. Violations that ship MUST be tracked and
  remediated.
- **Runtime guidance:** Day-to-day implementation guidance lives in the
  active feature plan under `/specs/<feature>/plan.md` and in the project's
  `CLAUDE.md`. Those files MUST defer to this constitution when in
  conflict.

**Version**: 1.0.0 | **Ratified**: 2026-05-12 | **Last Amended**: 2026-05-12
