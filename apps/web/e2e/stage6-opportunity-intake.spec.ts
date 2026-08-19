import { test, expect } from '@playwright/test';

const FOUNDER_EMAIL = process.env.DEV_FOUNDER_EMAIL ?? 'founder@ventureos.local';
const FOUNDER_PASSWORD = process.env.DEV_FOUNDER_PASSWORD ?? 'change-me-dev-only';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
  await page.getByTestId('login-password').fill(FOUNDER_PASSWORD);
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' && candidate.url().endsWith('/api/auth/login'),
    ),
    page.getByTestId('login-submit').click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard/);
}

async function fillAll(page: import('@playwright/test').Page, selector: string, value: string) {
  const inputs = page.locator(selector);
  const count = await inputs.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await inputs.nth(index).fill(value);
  }
}

test.describe('Stage 6 opportunity intake', () => {
  test('founder creates a fresh opportunity and records provenanced commercial evidence', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/dashboard/opportunities');
    await page.getByRole('link', { name: 'New opportunity' }).click();
    await expect(page.getByRole('heading', { name: 'New opportunity' })).toBeVisible();

    const unique = Date.now().toString();
    const title = `Stage 6 browser opportunity ${unique}`;
    const claim = `Founder evidence claim ${unique}`;
    const retrievedAt = new Date(Date.now() - 60_000).toISOString().slice(0, 16);

    await page.getByTestId('opportunity-title').fill(title);
    await page
      .getByTestId('opportunity-description')
      .fill('A fresh browser-created opportunity used to prove the supported Stage 6 intake path.');
    await page.getByLabel('Suggested product type').fill('Digital Template Bundle');
    await page
      .getByTestId('opportunity-persona')
      .fill('Independent founders validating a repeatable operational planning workflow.');
    await page.getByTestId('opportunity-pain-points').fill('Manual planning takes too long');

    await page.getByTestId('evidence-source-name').fill('Founder Stage 6 E2E evidence');
    await page.getByTestId('evidence-source-type').selectOption('FOUNDER_PROVIDED');
    await page.getByTestId('evidence-retrieved-at').fill(retrievedAt);
    await page.getByTestId('evidence-freshness-hours').fill('720');
    await page.getByTestId('evidence-relevance').fill('90');
    await page.getByTestId('evidence-claim-type').selectOption('FOUNDER_PROVIDED_FACT');
    await page.getByTestId('evidence-statement').fill(claim);

    await fillAll(page, '[data-testid^="opportunity-factor-"]', '80');
    await fillAll(page, '[data-testid^="profit-factor-"]', '80');

    let createdId: string | null = null;
    await page.route('**/api/opportunities', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const created = (await response.json()) as { id: string };
      createdId = created.id;
      await route.fulfill({ response });
    });

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' && candidate.url().endsWith('/api/opportunities'),
      ),
      page.getByTestId('opportunity-create-submit').click(),
    ]);

    expect(createResponse.status()).toBe(201);
    expect(createdId).toMatch(/^[0-9a-f-]+$/);
    if (!createdId) throw new Error('Opportunity response did not include an ID');
    await expect(page).toHaveURL(`/dashboard/opportunities/${createdId}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(claim)).toBeVisible();
    await expect(page.getByText('Founder-Provided Fact')).toBeVisible();
    await expect(page.getByTestId('evidence-quality-score')).toHaveText(/^\d/);
    await expect(page.getByText('opportunity-evidence-quality-v1')).toBeVisible();
    await expect(page.getByTestId('compliance-current-result')).toContainText('NOT ASSESSED');

    const complianceStatus = page.getByTestId('compliance-status');
    await expect(complianceStatus).toHaveAttribute('role', 'status');
    await expect(complianceStatus).toHaveAttribute('aria-live', 'polite');
    await expect(complianceStatus).toHaveAttribute('aria-atomic', 'true');

    const complianceCategories = page.getByTestId('compliance-categories');
    const complianceSubmit = page.getByTestId('compliance-submit');
    await complianceCategories.fill('   ');
    await complianceSubmit.click();
    await expect(page.getByRole('alert')).toHaveText(
      'Enter at least one truthful product/category declaration.',
    );

    await page.route('**/api/opportunities/*/compliance-assessment', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ response });
    });
    await complianceCategories.fill('digital planning templates');
    const complianceResponsePromise = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/api/opportunities/') &&
        candidate.url().endsWith('/compliance-assessment'),
    );
    await complianceSubmit.click();
    await expect(page.getByTestId('compliance-form')).toHaveAttribute('aria-busy', 'true');
    const complianceResponse = await complianceResponsePromise;

    expect(complianceResponse.status()).toBe(201);
    const compliance = (await complianceResponse.json()) as {
      auditEventId: string;
      formulaVersion: string;
      policyPackVersion: string;
      result: string;
    };
    expect(compliance).toMatchObject({
      formulaVersion: 'opportunity-compliance-v1',
      policyPackVersion: 'v1',
      result: 'PASS',
    });
    await expect(page.getByTestId('compliance-current-result')).toHaveText(
      `Gate 1: ${compliance.result}`,
    );
    await expect(page.getByTestId('compliance-form')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByText(compliance.formulaVersion, { exact: true })).toBeVisible();
    await expect(page.getByText(`Policy pack ${compliance.policyPackVersion}`)).toBeVisible();
    await expect(page.getByTestId('compliance-audit-id')).toHaveText(
      `Audit evidence: ${compliance.auditEventId}`,
    );
    await expect(page.getByTestId('compliance-blockers')).toHaveCount(0);

    const [promoteResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          candidate.url().includes('/api/opportunities/') &&
          candidate.url().endsWith('/promote'),
      ),
      page.getByRole('button', { name: 'Promote to Venture Proposal' }).click(),
    ]);
    expect(promoteResponse.status()).toBe(201);
    const promoted = (await promoteResponse.json()) as { proposal: { id: string } };

    await page.goto(`/dashboard/finance/${promoted.proposal.id}`);
    await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
    await page.getByPlaceholder('Experiment name').fill(`Stage 6 commercial evidence ${unique}`);
    await page
      .getByPlaceholder('Hypothesis')
      .fill('Observed support load remains manageable during the pilot.');

    const [experimentResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          candidate.url().endsWith(`/api/finance/ventures/${promoted.proposal.id}/experiments`),
      ),
      page.getByRole('button', { name: 'Create experiment (Control vs. Variant B)' }).click(),
    ]);
    expect(experimentResponse.status()).toBe(201);
    const experiment = (await experimentResponse.json()) as {
      metrics: Array<{ name: string }>;
    };
    expect(experiment.metrics.map((metric) => metric.name)).toContain('SUPPORT_MINUTES');

    const [startResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          candidate.url().includes('/api/finance/experiments/') &&
          candidate.url().endsWith('/start'),
      ),
      page.getByRole('button', { name: 'Start experiment' }).click(),
    ]);
    expect(startResponse.status()).toBe(201);

    await expect(page.getByTestId('experiment-result-metric')).toBeVisible();
    await page.getByTestId('experiment-result-metric').selectOption({ label: 'SUPPORT_MINUTES' });
    await page.getByTestId('experiment-result-value').fill('12');
    await page.getByTestId('experiment-evidence-mode').selectOption('REAL');
    await page.getByTestId('experiment-source-type').selectOption('CUSTOMER_SUPPORT');
    await page.getByTestId('experiment-source-ref').fill(`support-log:e2e-${unique}`);
    await page.getByTestId('experiment-observed-at').fill(retrievedAt);

    const [resultResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          candidate.url().includes('/api/finance/experiments/') &&
          candidate.url().endsWith('/results'),
      ),
      page.getByTestId('experiment-record-result').click(),
    ]);
    expect(resultResponse.status()).toBe(201);
    await expect(page.getByText('REAL', { exact: true })).toBeVisible();
    await expect(page.getByText(`CUSTOMER_SUPPORT · support-log:e2e-${unique}`)).toBeVisible();
  });
});
