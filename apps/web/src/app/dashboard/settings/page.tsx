import { redirect } from 'next/navigation';
import { serverApiFetch } from '@/lib/server-api';
import {
  ChangePlanAction,
  CancelSubscriptionAction,
  IssueLicenseKeyAction,
  RevokeLicenseKeyAction,
} from '@/components/billing-actions';
import { UpdateBrandingAction } from '@/components/branding-actions';
import { TeamActions, type WorkspaceMemberView } from '@/components/team-actions';
import type { AuthenticatedUser } from '@/lib/types';

interface BillingSummary {
  subscription: {
    status: string;
    billingMode: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    plan: { key: string; name: string; priceMonthlyEur: string };
  };
  usage: {
    ventures: { used: number; limit: number };
    members: { used: number; limit: number };
    marketplaceAccounts: { used: number; limit: number };
  };
}

interface LicenseKey {
  id: string;
  key: string;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
}

interface WorkspaceSummary {
  branding: { brandName: string | null; logoUrl: string | null; primaryColorHex: string } | null;
}

export default async function SettingsPage() {
  const { data: auth, status: authStatus } = await serverApiFetch<{ user: AuthenticatedUser }>(
    '/auth/me',
  );

  if (authStatus === 401) redirect('/login');

  const permissions = auth?.user.permissions ?? [];
  const canViewBilling = permissions.includes('billing:view');
  const canManageBilling = permissions.includes('billing:manage');
  const canManageMembers = permissions.includes('workspace:members:manage');
  const canManageBranding = permissions.includes('workspace:branding:manage');
  const canAccessSettings = canViewBilling || canManageMembers || canManageBranding;

  if (!auth || !canAccessSettings) {
    return (
      <SettingsFrame>
        <section className="vos-card" style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>
            {auth ? 'Settings access unavailable' : 'Settings unavailable'}
          </h2>
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14, margin: 0 }} role="status">
            {auth
              ? 'Your current workspace role does not include billing, team, or branding settings.'
              : 'VentureOS could not verify your settings permissions. Try again later.'}
          </p>
        </section>
      </SettingsFrame>
    );
  }

  const [billingResult, licenseKeysResult, workspaceResult, membersResult] = await Promise.all([
    canViewBilling
      ? serverApiFetch<BillingSummary>('/billing')
      : Promise.resolve({ data: null, status: 403 }),
    canViewBilling
      ? serverApiFetch<LicenseKey[]>('/billing/license-keys')
      : Promise.resolve({ data: null, status: 403 }),
    canManageBranding
      ? serverApiFetch<WorkspaceSummary>('/workspaces/current')
      : Promise.resolve({ data: null, status: 403 }),
    canManageMembers
      ? serverApiFetch<WorkspaceMemberView[]>('/workspaces/members')
      : Promise.resolve({ data: null, status: 403 }),
  ]);

  const billing = billingResult.data;
  const licenseKeys = licenseKeysResult.data;
  const workspaceSummary = workspaceResult.data;
  const members = membersResult.data;

  return (
    <SettingsFrame>
      {canViewBilling ? (
        <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Subscription</h2>
          {billingResult.status !== 200 ? (
            <ResourceUnavailable label="Subscription data" />
          ) : billing ? (
            <>
              <Row label="Plan" value={billing.subscription.plan.name} />
              <Row
                label="Status"
                value={billing.subscription.status}
                badge={billing.subscription.status === 'ACTIVE' ? 'ok' : 'mock'}
              />
              <Row label="Billing mode" value={billing.subscription.billingMode} badge="mock" />
              <Row
                label="Ventures"
                value={`${billing.usage.ventures.used} / ${billing.usage.ventures.limit}`}
              />
              <Row
                label="Workspace members"
                value={`${billing.usage.members.used} / ${billing.usage.members.limit}`}
              />
              <Row
                label="Marketplace accounts"
                value={`${billing.usage.marketplaceAccounts.used} / ${billing.usage.marketplaceAccounts.limit}`}
              />
              {canManageBilling ? (
                <>
                  <ChangePlanAction currentPlanKey={billing.subscription.plan.key} />
                  <CancelSubscriptionAction status={billing.subscription.status} />
                </>
              ) : null}
              <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
                Billing mode is always MOCK -- no real payment processor is connected, so no amount
                above is ever actually charged (see docs/DECISIONS.md).
              </p>
            </>
          ) : (
            <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>No subscription found.</p>
          )}
        </section>
      ) : null}

      {canManageMembers ? (
        <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
          <div>
            <p className="vos-auth-kicker" style={{ margin: 0 }}>
              Collaborative access
            </p>
            <h2 style={{ fontSize: 16, margin: '4px 0' }}>Team</h2>
            <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
              Invite operators or read-only viewers with an expiring, one-time link. Only founders
              can manage membership.
            </p>
          </div>
          {membersResult.status !== 200 ? (
            <ResourceUnavailable label="Team data" />
          ) : members ? (
            <TeamActions members={members} />
          ) : (
            <p style={{ color: 'var(--vos-text-muted)', fontSize: 14, margin: 0 }}>
              No workspace members found.
            </p>
          )}
        </section>
      ) : null}

      {canViewBilling ? (
        <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>License keys</h2>
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            For self-hosted/exportable installs (master spec section 3&apos;s resale objective).
          </p>
          {licenseKeysResult.status !== 200 ? (
            <ResourceUnavailable label="License-key data" />
          ) : licenseKeys && licenseKeys.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                  <th style={{ padding: '6px 0' }}>Key</th>
                  <th>Status</th>
                  <th>Issued</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {licenseKeys.map((lk) => (
                  <tr key={lk.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                    <td style={{ padding: '8px 0', fontFamily: 'monospace' }}>{lk.key}</td>
                    <td>
                      <span
                        className={`vos-badge vos-badge--${lk.status === 'ACTIVE' ? 'ok' : 'danger'}`}
                      >
                        {lk.status}
                      </span>
                    </td>
                    <td>{new Date(lk.issuedAt).toLocaleDateString()}</td>
                    <td>{lk.expiresAt ? new Date(lk.expiresAt).toLocaleDateString() : 'Never'}</td>
                    <td>
                      {canManageBilling && lk.status === 'ACTIVE' ? (
                        <RevokeLicenseKeyAction id={lk.id} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
              No license keys issued yet.
            </p>
          )}
          {canManageBilling && licenseKeysResult.status === 200 ? <IssueLicenseKeyAction /> : null}
        </section>
      ) : null}

      {canManageBranding ? (
        <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>White-label branding</h2>
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Applied to the dashboard shell (app name, logo, accent color) so a reselling
            customer&apos;s installation doesn&apos;t visibly say &quot;VentureOS&quot;.
          </p>
          {workspaceResult.status !== 200 ? (
            <ResourceUnavailable label="Branding data" />
          ) : (
            <UpdateBrandingAction
              brandName={workspaceSummary?.branding?.brandName ?? null}
              logoUrl={workspaceSummary?.branding?.logoUrl ?? null}
              primaryColorHex={workspaceSummary?.branding?.primaryColorHex ?? '#4F46E5'}
            />
          )}
        </section>
      ) : null}
    </SettingsFrame>
  );
}

function SettingsFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Settings</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 0 }}>
          Workspace settings are limited to capabilities granted to your active role.
        </p>
      </div>
      {children}
    </div>
  );
}

function ResourceUnavailable({ label }: { label: string }) {
  return (
    <p className="vos-error" role="status" style={{ margin: 0 }}>
      {label} is unavailable. Try again later.
    </p>
  );
}

function Row({ label, value, badge }: { label: string; value: string; badge?: 'mock' | 'ok' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
      <span style={{ color: 'var(--vos-text-muted)' }}>{label}</span>
      <span>
        {value} {badge ? <span className={`vos-badge vos-badge--${badge}`}>{badge}</span> : null}
      </span>
    </div>
  );
}
