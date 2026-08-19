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

    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    const workspaceResponse = await page.request.get('/api/workspaces/current');
    expect(workspaceResponse.ok()).toBe(true);
    const workspaceSummary = (await workspaceResponse.json()) as { workspace: { name: string } };
    await expect(page.getByTestId('mobile-workspace-name')).toHaveText(
      workspaceSummary.workspace.name,
    );
    await expect(page.getByTestId('mobile-workspace-name')).toBeVisible();
    await expect(menu).toBeVisible();
    await expect(page.getByLabel('Workspace sidebar')).toHaveAttribute('aria-hidden', 'true');
    await menu.click();
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByLabel('Workspace sidebar')).not.toHaveAttribute('aria-hidden', 'true');
    const sidebar = page.getByLabel('Workspace sidebar');
    await expect(sidebar).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.closest('#workspace-navigation') !== null),
      )
      .toBe(true);

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableCount = await sidebar.locator(focusableSelector).count();
    expect(focusableCount).toBeGreaterThan(1);
    await sidebar.locator(focusableSelector).last().focus();
    await page.keyboard.press('Tab');
    await expect(sidebar.locator(focusableSelector).first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(sidebar.locator(focusableSelector).last()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
    await expect(page.getByLabel('Workspace sidebar')).toHaveAttribute('aria-hidden', 'true');
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('#workspace-navigation') === null),
    ).toBe(true);

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
