/*
 * e2e — flexible import (T144).
 *
 * Drives the operator-facing US3v2 acceptance scenarios end-to-end:
 *   1. Auto-confirmed mapping (canonical headers)
 *   2. Manual mapping (heterogeneous headers)
 *   3. Ambiguity disambiguation
 *   4. Missing required role
 *   5. Parser-level rejection
 *   + Round-trip extraMetadata through export + re-import (SC-019)
 *   + WCAG sweep of the mapping-preview screen
 *
 * STATUS: scaffolded as `test.skip` until the MappingPreview component
 * (T139) is wired into `src/main.ts` at `#/import`. The pipeline
 * services and pure tests already lock in correctness (SC-004, SC-017,
 * SC-020); this spec covers the UI-level acceptance once mounted.
 *
 * To enable: replace `test.skip(...)` with `test(...)` and run:
 *   npm run build && npm run preview &
 *   npx playwright test tests/e2e/flexible-import.spec.ts
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Flexible import (US3v2) — e2e', () => {
  test.skip('AS1: auto-confirm canonical en file', async ({ page }) => {
    await page.goto('/#/import');
    // TODO: drop fixtures/heterogeneous/01-canonical-en.csv onto the picker.
    // Expect MappingPreview to render with all five required roles at
    // confidence ≥ 0.8 and the confirm button enabled on first paint.
    await expect(page.getByRole('button', { name: /confirmar e importar/i })).toBeEnabled();
  });

  test.skip('AS2: manual mapping for heterogeneous headers', async ({ page }) => {
    await page.goto('/#/import');
    // TODO: drop fixtures/heterogeneous/02-spanish-bank-semicolon.csv.
    // Expect confidence chips Alta/Media and confirm enabled after
    // operator interaction.
  });

  test.skip('AS3: ambiguity disambiguation', async ({ page }) => {
    await page.goto('/#/import');
    // TODO: drop a fixture with two plausible amount columns. Expect
    // AMBIGUOUS_ROLE warning chip and confirm disabled until the
    // operator picks via the role dropdown.
    await expect(page.getByText(/varias columnas candidatas/i)).toBeVisible();
  });

  test.skip('AS4: missing required role blocks confirm', async ({ page }) => {
    await page.goto('/#/import');
    // TODO: drop a fixture without `description` and verify confirm is
    // disabled until the operator maps a column.
  });

  test.skip('AS5: parser-level rejection touches zero records', async ({ page }) => {
    await page.goto('/#/import');
    // TODO: drop a binary / malformed file. Expect file-picker to
    // surface ENCODING_NOT_UTF8 or MALFORMED_CSV inline; no records added.
  });

  test.skip('Round-trip: extraMetadata survives export + re-import (SC-019)', async () => {
    // TODO:
    //  1. Import fixtures/heterogeneous/05-array-of-objects.json (has internalId).
    //  2. Confirm + commit.
    //  3. Export the current filter as JSON.
    //  4. Wipe the workspace, recreate, import the exported file.
    //  5. Assert each record carries the same `extraMetadata`.
  });

  test.skip('WCAG sweep on the mapping-preview screen', async ({ page }) => {
    await page.goto('/#/import');
    // TODO: trigger the MappingPreview render, then run axe.
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
});
