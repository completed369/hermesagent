import { expect, test, type Page, type Route } from '@playwright/test';

const FOUNDER_EMAIL = process.env.DEV_FOUNDER_EMAIL ?? 'founder@ventureos.local';
const FOUNDER_PASSWORD = process.env.DEV_FOUNDER_PASSWORD ?? 'change-me-dev-only';
const CORS_HEADERS = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fulfillJson(route: Route, body: unknown, waitFor?: Promise<void>) {
  const headers = {
    ...CORS_HEADERS,
    'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
  };
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers });
    return;
  }
  await waitFor;
  await route.fulfill({ status: 200, headers, json: body });
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(FOUNDER_EMAIL);
  await page.getByTestId('login-password').fill(FOUNDER_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('Collaborative workspace UI behavior', () => {
  test('announces invite progress and focuses the link after clipboard failure', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();

    const inviteGate = deferred();
    await page.route('**/api/workspaces/invitations', (route) =>
      fulfillJson(route, { token: 'single-use-secret' }, inviteGate.promise),
    );

    await page.getByRole('button', { name: 'Create secure invite' }).click();
    const teamActions = page.locator('.vos-team-actions');
    const inviteRegion = teamActions.locator('.vos-team-invite');
    await expect(inviteRegion).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    await expect(teamActions.getByRole('status')).toHaveText('Creating a secure invitation.');

    inviteGate.resolve();
    const inviteInput = page.getByRole('textbox', { name: 'Invitation link' });
    await expect(inviteInput).toHaveValue(/\/join#token=single-use-secret$/);
    await expect(teamActions.getByRole('status')).toHaveText(
      'Secure invitation created. Copy the link now.',
    );

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () =>
            new Promise((_, reject) => {
              window.setTimeout(() => reject(new Error('clipboard denied')), 150);
            }),
        },
      });
    });

    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('button', { name: 'Copying…' })).toBeDisabled();
    await expect(teamActions.getByRole('status')).toHaveText('Copying the invitation link.');
    await expect(
      page.getByRole('alert').filter({
        hasText: 'Could not copy the invitation link. Select and copy it manually.',
      }),
    ).toHaveText('Could not copy the invitation link. Select and copy it manually.');
    await expect(inviteInput).toBeFocused();
    const inviteValue = await inviteInput.inputValue();
    await expect
      .poll(() =>
        inviteInput.evaluate((input: HTMLInputElement) => ({
          end: input.selectionEnd,
          start: input.selectionStart,
          valueLength: input.value.length,
        })),
      )
      .toEqual({ start: 0, end: inviteValue.length, valueLength: inviteValue.length });
  });

  test('removes the bearer fragment and submits it only in static-endpoint bodies', async ({
    page,
  }) => {
    const token = 'fragment-only-secret';
    const previewGate = deferred();
    const acceptGate = deferred();
    const requests: Array<{ body: unknown; method: string; url: string }> = [];

    await page.route('**/api/workspace-invitations/preview', async (route) => {
      if (route.request().method() !== 'OPTIONS') {
        requests.push({
          body: route.request().postDataJSON(),
          method: route.request().method(),
          url: route.request().url(),
        });
      }
      await fulfillJson(
        route,
        { workspaceName: 'Orbital Studio', roleKey: 'VIEWER', expiresAt: '2026-08-22T00:00:00Z' },
        previewGate.promise,
      );
    });
    await page.route('**/api/workspace-invitations/accept', async (route) => {
      if (route.request().method() !== 'OPTIONS') {
        requests.push({
          body: route.request().postDataJSON(),
          method: route.request().method(),
          url: route.request().url(),
        });
      }
      await fulfillJson(
        route,
        { received: true, workspaceName: 'Orbital Studio' },
        acceptGate.promise,
      );
    });

    await page.goto(`/join#token=${token}`);
    await expect(page).toHaveURL(/\/join$/);
    const form = page.locator('form');
    await expect(form).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status')).toHaveText('Checking this invitation.');
    await expect(page.getByLabel('Your name')).toHaveCount(0);

    previewGate.resolve();
    await expect(page.getByRole('heading', { name: 'Join Orbital Studio' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Invitation verified for Orbital Studio.');
    await expect(form).toHaveAttribute('aria-busy', 'false');

    await page.getByLabel('Your name').fill('Avery Operator');
    await page.getByLabel('Email').fill('avery@example.test');
    await page.getByLabel('Create password').fill('Secure-test-password-9!');
    await page.getByRole('button', { name: 'Request workspace access' }).click();

    await expect(form).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('fieldset')).toHaveAttribute('disabled', '');
    await expect(page.getByLabel('Your name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect(page.getByRole('status')).toHaveText('Joining Orbital Studio.');

    acceptGate.resolve();
    await expect(page).toHaveURL(/\/login$/);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toMatch(/\/api\/workspace-invitations\/preview$/);
    expect(requests[0]?.body).toEqual({ token });
    expect(requests[1]?.method).toBe('POST');
    expect(requests[1]?.url).toMatch(/\/api\/workspace-invitations\/accept$/);
    expect(requests[1]?.body).toEqual({
      token,
      displayName: 'Avery Operator',
      email: 'avery@example.test',
      password: 'Secure-test-password-9!',
    });
    expect(requests.every((request) => !request.url.includes(token))).toBe(true);
  });

  test('lets a signed-in account claim an invitation without submitting account credentials', async ({
    page,
  }) => {
    await login(page);
    const token = 'signed-in-fragment-secret';
    const acceptGate = deferred();
    const requests: Array<{ body: unknown; method: string; url: string }> = [];

    await page.route('**/api/workspace-invitations/preview', async (route) => {
      if (route.request().method() !== 'OPTIONS') {
        requests.push({
          body: route.request().postDataJSON(),
          method: route.request().method(),
          url: route.request().url(),
        });
      }
      await fulfillJson(route, {
        workspaceName: 'Signed-in Studio',
        roleKey: 'OPERATOR',
        expiresAt: '2026-08-22T00:00:00Z',
      });
    });
    await page.route('**/api/workspace-invitations/accept-authenticated', async (route) => {
      if (route.request().method() !== 'OPTIONS') {
        requests.push({
          body: route.request().postDataJSON(),
          method: route.request().method(),
          url: route.request().url(),
        });
      }
      await fulfillJson(
        route,
        {
          joined: true,
          roleKey: 'OPERATOR',
          workspaceId: '00000000-0000-4000-8000-000000000099',
          workspaceName: 'Signed-in Studio',
        },
        acceptGate.promise,
      );
    });

    await page.goto(`/join#token=${token}`);
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByRole('heading', { name: 'Join Signed-in Studio' })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveCount(0);
    const form = page.locator('form');
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await expect(form).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Joining…' })).toBeDisabled();
    await expect(form.getByRole('status')).toHaveText('Joining Signed-in Studio.');
    acceptGate.resolve();
    await expect(page).toHaveURL(/\/dashboard$/);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      body: { token },
      method: 'POST',
    });
    expect(requests[0]?.url).toMatch(/\/api\/workspace-invitations\/preview$/);
    expect(requests[1]).toMatchObject({
      body: { token },
      method: 'POST',
    });
    expect(requests[1]?.url).toMatch(/\/api\/workspace-invitations\/accept-authenticated$/);
    expect(requests.every((request) => !request.url.includes(token))).toBe(true);
  });
});
