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
 * Status: executed and passing against a real local stack on 2026-07-13
 * (Postgres, API, web, seeded founder account, Chromium via Playwright).
 */

const FOUNDER_EMAIL = process.env.DEV_FOUNDER_EMAIL ?? 'founder@ventureos.local';
const FOUNDER_PASSWORD = process.env.DEV_FOUNDER_PASSWORD ?? 'change-me-dev-only';

async function submitLogin(page: import('@playwright/test').Page, expectedStatus: number) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' && candidate.url().endsWith('/api/auth/login'),
    ),
    page.getByTestId('login-submit').click(),
  ]);
  expect(response.status()).toBe(expectedStatus);
}

test.describe('Login and dashboard', () => {
  test('redirects unauthenticated visitors to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('founder can log in and see the Command Centre', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
    await page.getByTestId('login-password').fill(FOUNDER_PASSWORD);
    await submitLogin(page, 200);

    await expect(page).toHaveURL(/\/dashboard/);
    // Both the sidebar nav link and the page <h1> say "Command Centre", so
    // getByText resolves two elements and trips Playwright's strict-mode
    // ambiguity check. Scope to the heading specifically.
    await expect(page.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
    await expect(page.getByText('Integration status')).toBeVisible();
  });

  test('rejects an incorrect password with a visible error', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
    await page.getByTestId('login-password').fill('definitely-wrong');
    await submitLogin(page, 401);

    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('founder can navigate to audit and security pages', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
    await page.getByTestId('login-password').fill(FOUNDER_PASSWORD);
    await submitLogin(page, 200);
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('link', { name: 'Audit Centre' }).click();
    await expect(page.getByRole('heading', { name: 'Audit Centre' })).toBeVisible();

    await page.getByRole('link', { name: 'Security Events' }).click();
    await expect(page.getByRole('heading', { name: 'Security Events' })).toBeVisible();
  });
});
