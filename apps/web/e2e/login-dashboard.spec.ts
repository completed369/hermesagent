import { test, expect } from '@playwright/test';

/**
 * Phase 1 end-to-end test (master spec section 37, item 23):
 * founder can log in and reach the dashboard; unauthenticated visitors are
 * redirected to /login; the dashboard renders real workspace data.
 *
 * Requires the full local stack running (web + api + postgres, seeded):
 *   pnpm db:migrate && pnpm db:seed
 *   pnpm dev
 *   pnpm --filter @ventureos/web test:e2e
 *
 * Status: written but NOT executed in this sandbox (no Docker/DB/browser
 * binaries available here). See docs/SANDBOX_LIMITATIONS.md.
 */

const FOUNDER_EMAIL = process.env.DEV_FOUNDER_EMAIL ?? 'founder@ventureos.local';
const FOUNDER_PASSWORD = process.env.DEV_FOUNDER_PASSWORD ?? 'change-me-dev-only';

test.describe('Login and dashboard', () => {
  test('redirects unauthenticated visitors to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('founder can log in and see the Command Centre', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
    await page.getByTestId('login-password').fill(FOUNDER_PASSWORD);
    await page.getByTestId('login-submit').click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('Command Centre')).toBeVisible();
    await expect(page.getByText('Integration status')).toBeVisible();
  });

  test('rejects an incorrect password with a visible error', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
    await page.getByTestId('login-password').fill('definitely-wrong');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('founder can navigate to audit and security pages', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
    await page.getByTestId('login-password').fill(FOUNDER_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('link', { name: 'Audit Centre' }).click();
    await expect(page.getByText('Audit Centre')).toBeVisible();

    await page.getByRole('link', { name: 'Security Events' }).click();
    await expect(page.getByText('Security Events')).toBeVisible();
  });
});
