import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('registration creates an isolated TRIAL workspace', async ({ page }) => {
  const suffix = randomUUID();
  const workspaceName = `Stage 5 Registration ${suffix.slice(0, 8)}`;
  const email = `stage5-${suffix}@ventureos.invalid`;
  const password = `Qa-${suffix}-A9!`;

  await page.goto('/register');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Your name').fill('Stage 5 QA User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Start free trial' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(workspaceName, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Trial', { exact: true })).toBeVisible();
  await expect(page.getByText('0 / 1', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Opportunity Feed' }).click();
  await expect(page.getByText('Social Media Content Planning Kit')).toHaveCount(0);
});
