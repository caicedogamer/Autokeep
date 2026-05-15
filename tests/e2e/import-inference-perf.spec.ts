/*
 * e2e — flexible-import performance benchmark (T138 / SC-018).
 *
 * Target: p95 of `parse + infer + preview-rendered` ≤ 1.5 s on a
 * 5,000-row × 20-column CSV on the reference profile (Chromium).
 *
 * STATUS: scaffolded as `test.skip` until MappingPreview (T139) is
 * mounted at `#/import` and emits a `data-mapping-preview-ready`
 * attribute the test can wait on. The pipeline pure-tests already lock
 * in correctness; this spec measures the UI-rendered budget.
 *
 * To enable: replace `test.skip(...)` with `test(...)` and run:
 *   npm run build && npm run preview &
 *   npx playwright test tests/e2e/import-inference-perf.spec.ts \
 *     --project=chromium
 */

import { test, expect } from '@playwright/test';

function synthesizeCsv(rows: number, cols: number): string {
  const header = ['date', 'type', 'amount', 'category', 'description'];
  for (let c = 5; c < cols; c++) header.push(`extra_${String(c)}`);
  const lines: string[] = [header.join(',')];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [
      `2026-04-${String((r % 28) + 1).padStart(2, '0')}`,
      r % 2 === 0 ? 'income' : 'expense',
      `${String(100 + r)}.00`,
      r % 3 === 0 ? 'Sales' : 'Services',
      `Description for row ${String(r + 1)}`,
    ];
    while (row.length < cols) row.push(`extra-value-${String(row.length)}`);
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

test.describe('SC-018 — inference + preview perf', () => {
  test.skip('p95 of parse + infer + preview-rendered ≤ 1.5 s on 5000×20', async ({ page }) => {
    await page.goto('/#/import');
    const csv = synthesizeCsv(5_000, 20);
    const buffer = new TextEncoder().encode(csv);

    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'perf.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(buffer),
      });
      // Wait for MappingPreview to flag itself as rendered.
      await page.waitForSelector('[data-mapping-preview-ready="true"]', { timeout: 5_000 });
      const elapsed = Date.now() - t0;
      samples.push(elapsed);
      await page.locator('button:has-text("Cancelar")').click();
    }
    samples.sort((a, b) => a - b);
    const p95Index = Math.floor(samples.length * 0.95) - 1;
    const p95 = samples[Math.max(0, p95Index)];
    expect(p95, `Samples (ms): ${samples.join(', ')}`).toBeLessThanOrEqual(1500);
  });
});
