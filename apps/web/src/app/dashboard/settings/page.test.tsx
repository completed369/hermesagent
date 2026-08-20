import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { serverApiFetchMock } = vi.hoisted(() => ({ serverApiFetchMock: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/server-api', () => ({ serverApiFetch: serverApiFetchMock }));
vi.mock('@/components/billing-actions', () => ({
  ChangePlanAction: () => 'change-plan-control',
  CancelSubscriptionAction: () => 'cancel-subscription-control',
  IssueLicenseKeyAction: () => 'issue-license-control',
  RevokeLicenseKeyAction: () => 'revoke-license-control',
}));
vi.mock('@/components/branding-actions', () => ({
  UpdateBrandingAction: () => 'branding-control',
}));
vi.mock('@/components/team-actions', () => ({
  TeamActions: () => 'team-control',
}));
vi.stubGlobal('React', React);

import SettingsPage from './page';

function authenticated(permissions: string[]) {
  return {
    data: {
      user: {
        userId: 'user-1',
        email: 'member@example.test',
        isFounder: false,
        workspaceId: 'workspace-1',
        workspaceName: 'Test workspace',
        roleKey: 'VIEWER',
        permissions,
      },
    },
    status: 200,
  };
}

describe('Settings capability boundaries', () => {
  beforeEach(() => {
    serverApiFetchMock.mockReset();
  });

  it('does not request or render founder settings for an unprivileged collaborator', async () => {
    serverApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/auth/me') return authenticated(['opportunity:view']);
      throw new Error(`Unexpected forbidden settings request: ${path}`);
    });

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain('Settings access unavailable');
    expect(html).toContain('does not include billing, team, or branding settings');
    expect(html).not.toContain('Subscription');
    expect(html).not.toContain('License keys');
    expect(html).not.toContain('White-label branding');
    expect(html).not.toContain('team-control');
    expect(serverApiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports failed authorized resources as unavailable instead of empty', async () => {
    serverApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/auth/me') {
        return authenticated([
          'billing:view',
          'billing:manage',
          'workspace:members:manage',
          'workspace:branding:manage',
        ]);
      }
      return { data: null, status: 500 };
    });

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain('Subscription data is unavailable');
    expect(html).toContain('License-key data is unavailable');
    expect(html).toContain('Team data is unavailable');
    expect(html).toContain('Branding data is unavailable');
    expect(html).not.toContain('No subscription found');
    expect(html).not.toContain('No license keys issued yet');
    expect(html).not.toContain('change-plan-control');
    expect(html).not.toContain('issue-license-control');
    expect(html).not.toContain('branding-control');
    expect(html).not.toContain('team-control');
  });

  it('keeps billing management controls hidden for a billing read-only role', async () => {
    serverApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/auth/me') return authenticated(['billing:view']);
      if (path === '/billing') {
        return {
          data: {
            subscription: {
              status: 'ACTIVE',
              billingMode: 'MOCK',
              trialEndsAt: null,
              currentPeriodEnd: null,
              plan: { key: 'STARTER', name: 'Starter', priceMonthlyEur: '29' },
            },
            usage: {
              ventures: { used: 1, limit: 3 },
              members: { used: 1, limit: 2 },
              marketplaceAccounts: { used: 0, limit: 1 },
            },
          },
          status: 200,
        };
      }
      if (path === '/billing/license-keys') return { data: [], status: 200 };
      throw new Error(`Unexpected capability-gated request: ${path}`);
    });

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain('Starter');
    expect(html).toContain('No license keys issued yet');
    expect(html).not.toContain('change-plan-control');
    expect(html).not.toContain('cancel-subscription-control');
    expect(html).not.toContain('issue-license-control');
    expect(html).not.toContain('White-label branding');
    expect(html).not.toContain('Team');
  });
});
