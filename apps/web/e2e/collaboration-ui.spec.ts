import { expect, test, type Page, type Route } from '@playwright/test';

const FOUNDER_EMAIL = process.env.DEV_FOUNDER_EMAIL ?? 'founder@ventureos.local';
const FOUNDER_PASSWORD = process.env.DEV_FOUNDER_PASSWORD ?? 'change-me-dev-only';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const WEB_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
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
  await loginAs(page, FOUNDER_EMAIL, FOUNDER_PASSWORD);
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
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

  test('continues an existing-account claim after sign-in and retains its current role', async ({
    page,
  }) => {
    const token = 'existing-account-fragment-secret';
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
        workspaceName: 'Existing Account Studio',
        roleKey: 'OPERATOR',
        expiresAt: '2026-08-22T00:00:00Z',
      });
    });
    await page.route('**/api/workspace-invitations/accept', async (route) => {
      if (route.request().method() !== 'OPTIONS') {
        requests.push({
          body: route.request().postDataJSON(),
          method: route.request().method(),
          url: route.request().url(),
        });
      }
      await fulfillJson(route, { received: true, workspaceName: 'Existing Account Studio' });
    });
    await page.route('**/api/workspace-invitations/preview-authenticated', async (route) => {
      if (route.request().method() !== 'OPTIONS') {
        requests.push({
          body: route.request().postDataJSON(),
          method: route.request().method(),
          url: route.request().url(),
        });
      }
      await fulfillJson(route, {
        workspaceName: 'Existing Account Studio',
        roleKey: 'OPERATOR',
        currentRoleKey: 'VIEWER',
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
          roleKey: 'VIEWER',
          workspaceId: '00000000-0000-4000-8000-000000000099',
          workspaceName: 'Existing Account Studio',
        },
        acceptGate.promise,
      );
    });

    await page.goto(`/join#token=${token}`);
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByRole('heading', { name: 'Join Existing Account Studio' })).toBeVisible();
    await page.getByLabel('Your name').fill('Existing Founder');
    await page.getByLabel('Email').fill(FOUNDER_EMAIL);
    await page.getByLabel('Create password').fill('Ignored-existing-account-password-9!');
    await page.getByRole('button', { name: 'Request workspace access' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await login(page);
    await page.goto(`/join#token=${token}`);
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByRole('heading', { name: 'Join Existing Account Studio' })).toBeVisible();
    await expect(page.getByText(/already belong as viewer/i)).toContainText(
      'Claiming this link keeps your current role.',
    );
    await expect(page.getByLabel('Email')).toHaveCount(0);
    const form = page.locator('form');
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await expect(form).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Joining…' })).toBeDisabled();
    await expect(form.getByRole('status')).toHaveText('Joining Existing Account Studio.');
    acceptGate.resolve();
    await expect(page).toHaveURL(/\/dashboard$/);

    expect(requests).toHaveLength(4);
    expect(requests[0]).toMatchObject({
      body: { token },
      method: 'POST',
    });
    expect(requests[0]?.url).toMatch(/\/api\/workspace-invitations\/preview$/);
    expect(requests[1]).toMatchObject({
      body: {
        token,
        displayName: 'Existing Founder',
        email: FOUNDER_EMAIL,
        password: 'Ignored-existing-account-password-9!',
      },
      method: 'POST',
    });
    expect(requests[1]?.url).toMatch(/\/api\/workspace-invitations\/accept$/);
    expect(requests[2]).toMatchObject({
      body: { token },
      method: 'POST',
    });
    expect(requests[2]?.url).toMatch(/\/api\/workspace-invitations\/preview-authenticated$/);
    expect(requests[3]).toMatchObject({
      body: { token },
      method: 'POST',
    });
    expect(requests[3]?.url).toMatch(/\/api\/workspace-invitations\/accept-authenticated$/);
    expect(requests.every((request) => !request.url.includes(token))).toBe(true);
  });

  test('switches the live tenant shell and recovers from a denied switch', async ({
    browser,
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.parallelIndex}`;
    const ownWorkspaceName = `Solo Workspace ${suffix}`;
    const memberEmail = `workspace-switch-${suffix}@example.test`;
    const memberPassword = `Switch-${suffix}-A9!`;

    const founderContext = await browser.newContext();
    const founderPage = await founderContext.newPage();
    await login(founderPage);
    const targetSummaryResponse = await founderPage.request.get(
      `${API_BASE_URL}/api/workspaces/current`,
    );
    expect(targetSummaryResponse.ok()).toBe(true);
    const targetSummary = (await targetSummaryResponse.json()) as {
      workspace: { id: string; name: string };
      branding: { brandName: string | null } | null;
      integrations: Array<{ provider: string }>;
    };
    const targetProvider = targetSummary.integrations[0]?.provider;
    expect(targetProvider).toBeTruthy();
    const invitationResponse = await founderPage.request.post(
      `${API_BASE_URL}/api/workspaces/invitations`,
      {
        data: { roleKey: 'VIEWER', expiresInHours: 1 },
        headers: { Origin: WEB_ORIGIN },
      },
    );
    expect(invitationResponse.ok()).toBe(true);
    const invitation = (await invitationResponse.json()) as { token: string };
    await founderContext.close();

    await page.goto('/register');
    await page.getByLabel('Workspace name').fill(ownWorkspaceName);
    await page.getByLabel('Your name').fill('Workspace Switch QA');
    await page.getByLabel('Email').fill(memberEmail);
    await page.getByLabel('Password').fill(memberPassword);
    await page.getByRole('button', { name: 'Start free trial' }).click();
    await expect(page).toHaveURL(/\/login/);
    await loginAs(page, memberEmail, memberPassword);

    const ownSessionResponse = await page.request.get(`${API_BASE_URL}/api/auth/me`);
    expect(ownSessionResponse.ok()).toBe(true);
    const ownSession = (await ownSessionResponse.json()) as {
      user: { workspaceId: string };
    };
    const ownWorkspaceId = ownSession.user.workspaceId;

    const acceptedResponse = await page.request.post(
      `${API_BASE_URL}/api/workspace-invitations/accept-authenticated`,
      {
        data: { token: invitation.token },
        headers: { Origin: WEB_ORIGIN },
      },
    );
    expect(acceptedResponse.ok()).toBe(true);
    const accepted = (await acceptedResponse.json()) as { workspaceId: string };
    expect(accepted.workspaceId).toBe(targetSummary.workspace.id);

    const resetResponse = await page.request.post(`${API_BASE_URL}/api/workspaces/switch`, {
      data: { workspaceId: ownWorkspaceId },
      headers: { Origin: WEB_ORIGIN },
    });
    expect(resetResponse.ok()).toBe(true);
    await page.goto('/dashboard');

    const sidebar = page.getByLabel('Workspace sidebar');
    const switcher = sidebar.locator('.vos-workspace-switcher');
    const selector = switcher.getByRole('combobox', { name: 'Active workspace' });
    await expect(selector).toHaveValue(ownWorkspaceId);
    await expect(sidebar.locator('.vos-dashboard-brand strong')).toHaveText(ownWorkspaceName);
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(targetProvider!);
    await expect(
      selector.getByRole('option', { name: `${targetSummary.workspace.name} · Viewer` }),
    ).toBeAttached();

    const switchGate = deferred();
    let observedSwitch: { body: unknown; method: string } | undefined;
    const allowSwitch = async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      observedSwitch = {
        body: route.request().postDataJSON(),
        method: route.request().method(),
      };
      await switchGate.promise;
      await route.continue();
    };
    await page.route('**/api/workspaces/switch', allowSwitch);

    await selector.selectOption(targetSummary.workspace.id);
    await expect
      .poll(() => observedSwitch)
      .toEqual({
        body: { workspaceId: targetSummary.workspace.id },
        method: 'POST',
      });
    await expect(switcher).toHaveAttribute('aria-busy', 'true');
    await expect(selector).toBeDisabled();
    await expect(switcher.getByRole('status')).toHaveText(
      `Switching to ${targetSummary.workspace.name}.`,
    );

    switchGate.resolve();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(sidebar.locator('.vos-dashboard-brand strong')).toHaveText(
      targetSummary.branding?.brandName ?? 'VentureOS',
    );
    await expect(selector).toHaveValue(targetSummary.workspace.id);
    await expect(selector).toBeEnabled();
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Onboarding' })).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(ownWorkspaceName);
    await expect(page.getByRole('main')).toContainText(targetProvider!);
    await page.unroute('**/api/workspaces/switch', allowSwitch);

    const deniedGate = deferred();
    const denySwitch = async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await deniedGate.promise;
      await route.fulfill({
        status: 403,
        headers: {
          ...CORS_HEADERS,
          'access-control-allow-origin':
            route.request().headers().origin ?? 'http://localhost:3000',
        },
        json: { message: 'Workspace membership is required' },
      });
    };
    await page.route('**/api/workspaces/switch', denySwitch);

    await selector.selectOption(ownWorkspaceId);
    await expect(switcher).toHaveAttribute('aria-busy', 'true');
    await expect(selector).toBeDisabled();
    await expect(switcher.getByRole('status')).toHaveText(`Switching to ${ownWorkspaceName}.`);
    deniedGate.resolve();
    await expect(switcher.getByRole('alert')).toHaveText('Workspace membership is required');
    await expect(switcher).toHaveAttribute('aria-busy', 'false');
    await expect(selector).toBeEnabled();
    await expect(selector).toHaveValue(targetSummary.workspace.id);
    await expect(sidebar.locator('.vos-dashboard-brand strong')).toHaveText(
      targetSummary.branding?.brandName ?? 'VentureOS',
    );
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(ownWorkspaceName);
    await expect(page.getByRole('main')).toContainText(targetProvider!);
    await page.unroute('**/api/workspaces/switch', denySwitch);
  });
});
