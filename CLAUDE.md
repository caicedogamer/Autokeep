# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- SPECKIT START -->

Active feature: **001-autokeep-mvp** — AutoKeep, a single-page browser
bookkeeping app for SMBs.

For technical context, project structure, shell commands, and the
non-negotiable constraints in force, read these files in order:

- Plan: [specs/001-autokeep-mvp/plan.md](specs/001-autokeep-mvp/plan.md)
- Spec: [specs/001-autokeep-mvp/spec.md](specs/001-autokeep-mvp/spec.md)
- Research / dependency rationale: [specs/001-autokeep-mvp/research.md](specs/001-autokeep-mvp/research.md)
- Data model: [specs/001-autokeep-mvp/data-model.md](specs/001-autokeep-mvp/data-model.md)
- Contracts: [specs/001-autokeep-mvp/contracts/](specs/001-autokeep-mvp/contracts/)
- Quickstart: [specs/001-autokeep-mvp/quickstart.md](specs/001-autokeep-mvp/quickstart.md)
- Constitution: [.specify/memory/constitution.md](.specify/memory/constitution.md)
<!-- SPECKIT END -->

---

## Commands

```bash
npm run dev          # Vite dev server at localhost:5173
npm run build        # tsc --noEmit + vite build (runs typecheck first)
npm run preview      # Serve the production build for manual inspection
npm run typecheck    # TypeScript only, no emit
npm run lint         # ESLint over src/**/*.{ts,tsx} and tests/**/*.ts
npm run format       # Prettier (write)
npm run test         # Vitest in watch mode
npm run test:ci      # Vitest run with coverage, exits after one pass
npm run test:e2e     # Playwright (requires `npm run build && npm run preview` first)
```

Run a single unit test file:

```bash
npx vitest run src/modules/records/__tests__/money.pure.spec.ts
```

Run a single Playwright spec:

```bash
npx playwright test tests/e2e/wcag-sweep.spec.ts --headed
```

E2E tests need the production build running on port 4173. Either run `npm run preview` first, or let Playwright's `webServer` config start it automatically.

---

## Architecture

AutoKeep is a browser-only SPA with no backend. All persistence is through `localStorage` via a typed `StorageAdapter` interface. Financial data is encrypted with AES-GCM; the key is derived from a user passphrase using Argon2id (run in a Web Worker).

**Boot sequence** (`src/main.ts`):

1. Anti-flash inline script in `index.html` reads `autokeep:theme` (if any) and sets `<html data-theme>` before paint.
2. `createThemeService()` (from `src/core/theme/`) takes over: subscribes to `prefers-color-scheme`, re-applies on changes, exposes a `ThemeToggle` UI for the topbar.
3. Check localStorage for existing workspaces.
4. None → `SetupScreen`; some → `UnlockScreen` (passphrase entry).
5. On unlock, create the `CryptoService` and decrypt the workspace payload.
6. Build the app shell (sidebar + topbar + content) defined in `src/styles/shell.css`, wire the hash router, and mount module-level UI into `#main-content`.

**Layer rules** (enforced by ESLint):

- `domain/` — pure functions only; no DOM, no `localStorage`, no network.
- `services/` — orchestration; no DOM access (banned by `no-restricted-globals`).
- `ui/` — DOM manipulation only; calls services, never touches `localStorage` directly.
- `src/core/storage/**` — the only code allowed to read/write `localStorage` **for financial data**.
- `src/core/theme/**` — sole documented exception to Principle III. May read/write **only** the `autokeep:theme` preference (non-secret visual state). See `specs/001-autokeep-mvp/research.md` R18.

**Module layout** (`src/modules/<module>/`):

```
domain/      # types, business rules, pure functions
services/    # orchestration, state management
ui/          # DOM components (each paired with a .css file)
__tests__/   # unit tests (*.pure.spec.ts → Node env, others → jsdom)
index.ts     # public surface of the module
```

**Modules**: `workspace`, `records`, `filters`, `import`, `export`, `dashboard`, `ai`.

**Core** (`src/core/`): `crypto/`, `storage/`, `router/`, `workers/`, `i18n/`, `events/`, `theme/`, `result.ts`.

**Shared utilities**:

- `Result<T,E>` — explicit success/failure (no silent catches). See `src/core/result.ts`.
- `t('key')` — typed i18n helper. All strings in `src/core/i18n/es.ts`.
- `StorageAdapter` interface — the only sanctioned localStorage path for financial data.
- `createThemeService()` — owns the `autokeep:theme` preference and applies `<html data-theme>`. Sole exception to Principle III; see `src/core/theme/`.
- Workers: `filter.worker.ts` and `import.worker.ts` keep heavy work off the main thread.

**CSS**: Design tokens in `src/styles/tokens.css` (palette, type scale, spacing, radius, shadows, motion, z-index). Shared utilities (`.btn`, `.input`, `.card`, `.badge`, `.kpi`, `.table`, `.alert`, etc.) in `src/styles/components.css`. App shell layout (sidebar + topbar + content) in `src/styles/shell.css`. Each UI component has its own `.css` file (imported at the top of the `.ts` file). Indigo accent (`--ak-color-brand-600: #4F46E5`); dark mode via `[data-theme="dark"]` on `<html>` (managed by `theme-service`). No CSS frameworks.

---

## Non-negotiable rules

These are enforced by ESLint and will fail CI if violated:

1. **No direct `localStorage` / `sessionStorage` access outside `src/core/storage/` or `src/core/theme/`** — use `StorageAdapter` for financial data; `theme/` is the documented exception, scoped to the single key `autokeep:theme` (research.md R18).
2. **No DOM globals (`document`, `window`) in `domain/` or `services/`** — DOM work belongs in `ui/`.
3. **No floating promises** — every `Promise` must be `await`ed or explicitly `void`-cast.
4. **No thrown non-Error values** — use typed subclasses of `AutoKeepError`.
5. **Every new dependency requires written justification** (add a note in `specs/001-autokeep-mvp/research.md`).
6. **Financial data must never appear in plaintext in `localStorage`** — always encrypt through `EncryptedStore`.
7. **No network requests, no backend, no cloud** in the MVP. The passphrase is never stored.

---

## Testing conventions

- `*.pure.spec.ts` — runs in Node (no DOM). For pure domain functions.
- `*.spec.ts` (non-pure) — runs in jsdom. For services that need a simulated DOM.
- `tests/e2e/*.spec.ts` — Playwright, Chromium + Firefox + WebKit.
- Test aliases: `@core` → `src/core`, `@modules` → `src/modules`.
- Accessibility: `@axe-core/playwright` uses the `AxeBuilder` class API (not `checkA11y`).

---

## Argon2 / WASM

The KDF runs in `src/core/crypto/kdf.worker.ts`. Import is from `argon2-browser/dist/argon2-bundled.min.js` (self-contained base64-embedded WASM — avoids Vite ESM WASM issues). Type declarations for this path are in `src/declarations.d.ts`. `vite-plugin-wasm` is configured for both the main bundle and the worker bundle in `vite.config.ts`.
