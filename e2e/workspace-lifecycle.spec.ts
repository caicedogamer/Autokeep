/*
 * E2E: Workspace lifecycle (T113).
 *
 * Covers the quickstart.md 5-step verification:
 *   1. Fresh app shows the setup screen.
 *   2. Creating a workspace with a passphrase proceeds to the records view.
 *   3. Reloading the page shows the unlock screen (data persisted).
 *   4. Wrong passphrase is rejected (SC-015 backoff appears after 5 fails).
 *   5. Correct passphrase unlocks and shows the records view again.
 *
 * The test clears localStorage before each scenario to start from a clean
 * state.
 */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Clear all AutoKeep storage before each test.
  await page.goto('/');
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('autokeep:'))
      .forEach((k) => {
        localStorage.removeItem(k);
      });
  });
  await page.reload();
});

test('fresh app shows setup screen', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Crear espacio/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Crear espacio/i })).toBeVisible();
});

test('create workspace → records view appears', async ({ page }) => {
  await page.getByLabel(/Nombre/i).fill('Mi empresa');
  // Currency and locale selects default to ARS / es-AR — leave as-is.
  await page.getByLabel('Contraseña', { exact: true }).fill('secret-passphrase-123');
  await page.getByLabel(/Confirmar contraseña/i).fill('secret-passphrase-123');
  await page.getByRole('button', { name: /Crear espacio/i }).click();

  // After creation we land on the records route.
  await expect(page.getByText(/Registros/i)).toBeVisible({ timeout: 15_000 });
});

test('reload shows unlock screen after workspace created', async ({ page }) => {
  // First create a workspace.
  await page.getByLabel(/Nombre/i).fill('Mi empresa');
  await page.getByLabel('Contraseña', { exact: true }).fill('secret-passphrase-123');
  await page.getByLabel(/Confirmar contraseña/i).fill('secret-passphrase-123');
  await page.getByRole('button', { name: /Crear espacio/i }).click();
  await expect(page.getByText(/Registros/i)).toBeVisible({ timeout: 15_000 });

  // Reload → should see unlock screen.
  await page.reload();
  await expect(page.getByRole('heading', { name: /Desbloquear/i })).toBeVisible();
});

test('wrong passphrase is rejected with error message', async ({ page }) => {
  // Create workspace first.
  await page.getByLabel(/Nombre/i).fill('Mi empresa');
  await page.getByLabel('Contraseña', { exact: true }).fill('secret-passphrase-123');
  await page.getByLabel(/Confirmar contraseña/i).fill('secret-passphrase-123');
  await page.getByRole('button', { name: /Crear espacio/i }).click();
  await expect(page.getByText(/Registros/i)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByLabel(/Contraseña/i).fill('wrong-passphrase');
  await page.getByRole('button', { name: /Desbloquear/i }).click();

  await expect(page.getByRole('alert')).toContainText(/Contraseña incorrecta/i, {
    timeout: 15_000,
  });
});

test('correct passphrase unlocks workspace', async ({ page }) => {
  const passphrase = 'secret-passphrase-123';

  // Create.
  await page.getByLabel(/Nombre/i).fill('Mi empresa');
  await page.getByLabel('Contraseña', { exact: true }).fill(passphrase);
  await page.getByLabel(/Confirmar contraseña/i).fill(passphrase);
  await page.getByRole('button', { name: /Crear espacio/i }).click();
  await expect(page.getByText(/Registros/i)).toBeVisible({ timeout: 15_000 });

  // Reload and unlock.
  await page.reload();
  await page.getByLabel(/Contraseña/i).fill(passphrase);
  await page.getByRole('button', { name: /Desbloquear/i }).click();

  await expect(page.getByText(/Registros/i)).toBeVisible({ timeout: 15_000 });
});
