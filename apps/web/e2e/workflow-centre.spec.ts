import { expect, test, type Page } from '@playwright/test';
import { source as axeSource } from 'axe-core';

const FOUNDER_EMAIL = process.env.DEV_FOUNDER_EMAIL ?? 'founder@ventureos.local';
const FOUNDER_PASSWORD = process.env.DEV_FOUNDER_PASSWORD ?? 'change-me-dev-only';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
  await page.getByTestId('login-password').fill(FOUNDER_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function wcagViolations(page: Page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const runner = (
      window as Window & {
        axe: {
          run: (
            context: Document,
            options: { runOnly: { type: string; values: string[] } },
          ) => Promise<{ violations: Array<{ id: string; impact: string | null }> }>;
        };
      }
    ).axe;
    return (
      await runner.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      })
    ).violations;
  });
}

test.describe('Workflow Centre read-only UX', () => {
  test('renders on desktop and true 390px mobile without actions, WCAG violations, or overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.getByRole('link', { name: 'Workflow Centre' }).click();
    await expect(page).toHaveURL(/\/dashboard\/workflows$/);
    await expect(page.getByRole('heading', { name: 'Workflow Centre' })).toBeVisible();
    await expect(page.getByText(/Codex, Hermes and Pi: NOT_CONFIGURED/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Workflow Centre' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('[data-testid="workflow-centre"] button')).toHaveCount(0);
    await expect(page.locator('[data-testid="workflow-centre"] form')).toHaveCount(0);
    expect(await wcagViolations(page)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Workflow Centre' })).toBeVisible();
    await expect(page.locator('.vos-menu-button')).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
