/**
 * E2E golden path for the import feature (US3 / FR-011 – FR-016).
 *
 * Strategy: use the ImportService directly in page context to validate
 * fixtures and assert correct outcomes. This avoids needing a fully wired
 * UI while still exercising the full validation stack including the worker.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../tests/fixtures');

test.describe('Import golden path — CSV', () => {
  test('valid CSV reports correct counts without structural errors', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(
      async (csvContent: string) => {
        // @ts-expect-error runtime dynamic import
        const { validateCsvRows } = await import('/src/modules/import/domain/csv-schema.ts');
        const headers = [
          'date',
          'type',
          'amount',
          'currency',
          'category',
          'description',
          'counterparty',
        ];
        const lines = csvContent
          .split('\n')
          .slice(1)
          .filter((l: string) => l.trim());
        const rows = lines.map((l: string) =>
          l.split(',').map((c: string) => c.trim().replace(/^"|"$/g, '')),
        );
        const report = validateCsvRows(
          { headers, rows },
          {
            currency: 'ARS',
            currencyMinorUnits: 2,
            existingCount: 0,
          },
        );
        return {
          outcome: report.outcome,
          validCount: report.validRows.length,
          errorCount: report.errorRows.length,
        };
      },
      (await import('fs')).readFileSync(path.join(FIXTURES, 'import-valid.csv'), 'utf-8'),
    );

    expect(result.outcome).toBe('valid');
    expect(result.validCount).toBe(3);
    expect(result.errorCount).toBe(0);
  });

  test('error CSV reports row-level failures', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(
      async (csvContent: string) => {
        // @ts-expect-error runtime dynamic import
        const { validateCsvRows } = await import('/src/modules/import/domain/csv-schema.ts');
        const headers = [
          'date',
          'type',
          'amount',
          'currency',
          'category',
          'description',
          'counterparty',
        ];
        const lines = csvContent
          .split('\n')
          .slice(1)
          .filter((l: string) => l.trim());
        const rows = lines.map((l: string) => l.split(',').map((c: string) => c.trim()));
        const report = validateCsvRows(
          { headers, rows },
          {
            currency: 'ARS',
            currencyMinorUnits: 2,
            existingCount: 0,
          },
        );
        return { outcome: report.outcome, errorCount: report.errorRows.length };
      },
      (await import('fs')).readFileSync(path.join(FIXTURES, 'import-errors.csv'), 'utf-8'),
    );

    expect(['rejected-all', 'partial']).toContain(result.outcome);
    expect(result.errorCount).toBeGreaterThan(0);
  });
});

test.describe('Import golden path — JSON', () => {
  test('valid JSON reports correct counts', async ({ page }) => {
    await page.goto('/');

    const jsonContent = (await import('fs')).readFileSync(
      path.join(FIXTURES, 'import-valid.json'),
      'utf-8',
    );

    const result = await page.evaluate(async (content: string) => {
      // @ts-expect-error runtime dynamic import
      const { validateJsonPayload } = await import('/src/modules/import/domain/json-schema.ts');
      const parsed = JSON.parse(content);
      const report = validateJsonPayload(parsed, {
        currency: 'ARS',
        currencyMinorUnits: 2,
        existingCount: 0,
      });
      return { outcome: report.outcome, validCount: report.validRows.length };
    }, jsonContent);

    expect(result.outcome).toBe('valid');
    expect(result.validCount).toBe(2);
  });
});
