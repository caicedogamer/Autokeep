/*
 * SC-012 — WCAG 2.1 AA sweep via axe-core.
 * Visits every primary route and asserts zero critical/serious violations.
 *
 * NOTE: Requires @axe-core/playwright installed as a dev dependency.
 * If the package is missing this test skips gracefully.
 */
import { test } from '@playwright/test';

// Route paths to sweep
const ROUTES = [
  '/', // setup / unlock screen
  '/#/records',
  '/#/filters',
  '/#/import',
  '/#/export',
  '/#/dashboard',
  '/#/ai/inconsistencies',
  '/#/settings',
];

test.describe('WCAG 2.1 AA sweep (SC-012)', () => {
  // Check that axe is available; if not, skip
  let axeAvailable = false;
  test.beforeAll(async () => {
    try {
      await import('@axe-core/playwright');
      axeAvailable = true;
    } catch {
      console.warn('[wcag-sweep] @axe-core/playwright not installed — skipping axe assertions');
    }
  });

  for (const route of ROUTES) {
    test(`no critical/serious violations on ${route}`, async ({ page }) => {
      await page.goto(route);
      // Give the SPA time to render
      await page.waitForTimeout(500);

      if (!axeAvailable) {
        test.skip();
        return;
      }

      const { AxeBuilder } = await import('@axe-core/playwright');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

      const criticalOrSerious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (criticalOrSerious.length > 0) {
        const summary = criticalOrSerious
          .map((v) => `[${v.impact ?? 'unknown'}] ${v.id}: ${v.description}`)
          .join('\n');
        throw new Error(`WCAG violations on ${route}:\n${summary}`);
      }
    });
  }
});
