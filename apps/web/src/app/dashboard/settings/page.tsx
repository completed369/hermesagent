import { serverApiFetch } from '@/lib/server-api';
import {
  ChangePlanAction,
  CancelSubscriptionAction,
  IssueLicenseKeyAction,
  RevokeLicenseKeyAction,
} from '@/components/billing-actions';
import { UpdateBrandingAction } from '@/components/branding-actions';

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
  const [{ data: billing }, { data: licenseKeys }, { data: workspaceSummary }] = await Promise.all([
    serverApiFetch<BillingSummary>('/billing'),
    serverApiFetch<LicenseKey[]>('/billing/license-keys'),
    serverApiFetch<WorkspaceSummary>('/workspaces/current'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Settings</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 0 }}>
          Subscription, plan limits, license keys, and white-label branding (master spec sections 1,
          3, 34 -- Phase 8).
        </p>
      </div>

      <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Subscription</h2>
        {billing ? (
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
            <ChangePlanAction currentPlanKey={billing.subscription.plan.key} />
            <CancelSubscriptionAction status={billing.subscription.status} />
            <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
              Billing mode is always MOCK -- no real payment processor is connected, so no amount
              above is ever actually charged (see docs/DECISIONS.md).
            </p>
          </>
        ) : (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>No subscription found.</p>
        )}
      </section>

      <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>License keys</h2>
        <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
          For self-hosted/exportable installs (master spec section 3&apos;s resale objective).
        </p>
        {licenseKeys && licenseKeys.length > 0 ? (
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
                  <td>{lk.status === 'ACTIVE' && <RevokeLicenseKeyAction id={lk.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No license keys issued yet.
          </p>
        )}
        <IssueLicenseKeyAction />
      </section>

      <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>White-label branding</h2>
        <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
          Applied to the dashboard shell (app name, logo, accent color) so a reselling customer&apos;s
          installation doesn&apos;t visibly say &quot;VentureOS&quot;.
        </p>
        <UpdateBrandingAction
          brandName={workspaceSummary?.branding?.brandName ?? null}
          logoUrl={workspaceSummary?.branding?.logoUrl ?? null}
          primaryColorHex={workspaceSummary?.branding?.primaryColorHex ?? '#4F46E5'}
        />
      </section>
    </div>
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
