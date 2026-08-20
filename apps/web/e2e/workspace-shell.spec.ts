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

async function contrastRatio(page: Page, foreground: string, background: string) {
  return page.evaluate(
    ({ foregroundValue, backgroundValue }) => {
      const parse = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
      const luminance = (value: string) => {
        const [red, green, blue] = parse(value);
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };
      const foregroundLuminance = luminance(foregroundValue);
      const backgroundLuminance = luminance(backgroundValue);
      return (
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      );
    },
    { foregroundValue: foreground, backgroundValue: background },
  );
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

    const menu = page.locator('.vos-menu-button');
    const workspaceResponse = await page.request.get(
      `${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'}/api/workspaces/current`,
    );
    expect(workspaceResponse.ok()).toBe(true);
    const workspaceSummary = (await workspaceResponse.json()) as { workspace: { name: string } };
    await expect(page.getByTestId('mobile-workspace-name')).toHaveText(
      workspaceSummary.workspace.name,
    );
    await expect(page.getByTestId('mobile-workspace-name')).toBeVisible();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAccessibleName('Menu');
    await expect(page.getByLabel('Workspace sidebar')).toHaveAttribute('aria-hidden', 'true');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    const sidebar = page.getByRole('dialog', { name: 'Workspace sidebar' });
    await expect(sidebar).toHaveAttribute('aria-modal', 'true');
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();

    const header = page.locator('.vos-mobile-header');
    const main = page.locator('#dashboard-content');
    const skipLink = page.locator('.vos-skip-link');
    await expect(header).toHaveAttribute('inert', '');
    await expect(main).toHaveAttribute('inert', '');
    await expect(skipLink).toHaveAttribute('inert', '');
    expect(
      await main.evaluate((element) => {
        element.focus();
        return document.activeElement === element;
      }),
    ).toBe(false);
    await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();

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
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await expect(page.getByLabel('Workspace sidebar')).toHaveAttribute('aria-hidden', 'true');
    await expect(header).not.toHaveAttribute('inert', '');
    await expect(main).not.toHaveAttribute('inert', '');
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('#workspace-navigation') === null),
    ).toBe(true);

    await menu.click();
    await page.getByRole('link', { name: 'Opportunity Feed' }).click();
    await expect(page).toHaveURL(/\/dashboard\/opportunities$/);
    await expect(page.getByRole('heading', { name: 'Opportunities' })).toBeVisible();
    await expect(main).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('Workspace sidebar')).toHaveAttribute('aria-hidden', 'true');

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('semantic accent remains readable in light and dark themes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const colorScheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme });
      await login(page);

      const skipLink = page.locator('.vos-skip-link');
      await page.keyboard.press('Tab');
      await expect(skipLink).toBeFocused();
      const colours = await skipLink.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          foreground: style.color,
          focus: style.outlineColor,
          page: getComputedStyle(document.body).backgroundColor,
        };
      });

      expect(
        await contrastRatio(page, colours.foreground, colours.background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(await contrastRatio(page, colours.focus, colours.page)).toBeGreaterThanOrEqual(4.5);
      await page.goto('/login');
    }
  });

  test('long unbroken workspace and table content remains contained at 320 and 390 pixels', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => {
        const longValue = 'WorkspaceOrOpportunity'.repeat(20);
        const brand = document.querySelector<HTMLElement>('.vos-dashboard-brand strong');
        if (brand) brand.textContent = longValue;
        const mobileWorkspace = document.querySelector<HTMLElement>(
          '[data-testid="mobile-workspace-name"]',
        );
        if (mobileWorkspace) mobileWorkspace.textContent = longValue;

        const surface = document.querySelector<HTMLElement>('.vos-data-surface');
        if (!surface) throw new Error('Expected a dashboard data surface');
        const table = document.createElement('table');
        table.className = 'vos-data-table';
        table.dataset.testid = 'long-content-table';
        const body = table.createTBody();
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.dataset.label = 'Very long value';
        cell.textContent = longValue;
        surface.append(table);
      });

      await page.locator('.vos-menu-button').click();
      const sidebar = page.getByRole('dialog', { name: 'Workspace sidebar' });
      await expect(sidebar).toBeVisible();
      expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: 'Close navigation' }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator('[data-testid="long-content-table"]')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page
        .locator('[data-testid="long-content-table"]')
        .evaluate((element) => element.remove());
    }
  });
});
