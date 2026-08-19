import { expect, test, type Page } from '@playwright/test';

const FOUNDER_EMAIL = process.env.DEV_FOUNDER_EMAIL ?? 'founder@ventureos.local';
const FOUNDER_PASSWORD = process.env.DEV_FOUNDER_PASSWORD ?? 'change-me-dev-only';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
  await page.getByTestId('login-password').fill(FOUNDER_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('Workspace shell UX', () => {
  test('desktop navigation exposes landmarks, skip navigation, and active route state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Command Centre' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.getByRole('link', { name: 'Opportunity Feed' }).click();
    await expect(page.getByRole('heading', { name: 'Opportunities' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Opportunity Feed' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to workspace content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('mobile drawer is labelled, dismissible, and the page does not overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.getByRole('button', { name: 'Close' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByLabel('Workspace sidebar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
