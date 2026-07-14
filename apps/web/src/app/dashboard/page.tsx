import { serverApiFetch } from '@/lib/server-api';

interface WorkspaceSummary {
  workspace: { name: string; slug: string; baseCurrency: string };
  memberCount: number;
  integrations: Array<{ provider: string; mode: string; status: string; writeEnabled: boolean }>;
}

export default async function CommandCentrePage() {
  const { data } = await serverApiFetch<WorkspaceSummary>('/workspaces/current');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Command Centre</h1>
        <p style={{ color: 'var(--vos-text-muted)', margin: '4px 0 0' }}>
          {data
            ? `${data.workspace.name} · ${data.workspace.baseCurrency} · ${data.memberCount} member(s)`
            : 'Loading workspace...'}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>Active ventures</p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>0</p>
          <span className="vos-badge vos-badge--mock">Phase 2+</span>
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Pending approvals
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>0</p>
          <span className="vos-badge vos-badge--mock">Phase 3+</span>
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Budget utilisation (month)
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>€0 / €100</p>
          <span className="vos-badge vos-badge--mock">Phase 7</span>
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Integrations connected
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>
            {data ? data.integrations.filter((i) => i.status === 'CONNECTED').length : '-'} /{' '}
            {data?.integrations.length ?? '-'}
          </p>
          <span className="vos-badge vos-badge--ok">Live</span>
        </div>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Integration status</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
              <th style={{ padding: '6px 0' }}>Provider</th>
              <th>Mode</th>
              <th>Write enabled</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.integrations ?? []).map((i) => (
              <tr key={i.provider} style={{ borderTop: '1px solid var(--vos-border)' }}>
                <td style={{ padding: '8px 0' }}>{i.provider}</td>
                <td>{i.mode}</td>
                <td>{i.writeEnabled ? 'Yes' : 'No'}</td>
                <td>
                  <span
                    className={`vos-badge ${i.status === 'CONNECTED' ? 'vos-badge--ok' : 'vos-badge--mock'}`}
                  >
                    {i.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>What&apos;s real vs. planned</h2>
        <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', margin: 0 }}>
          This Phase 1 build implements founder authentication, workspace + RBAC, founder
          onboarding, the audit and security event trails, and integration/health status shown above
          - all backed by a real PostgreSQL database. Opportunity research, the AI board of agents,
          approvals, product/listing studios and finance dashboards are architected (see
          docs/ROADMAP.md) but not yet built; their nav items above are greyed out and labelled by
          phase.
        </p>
      </div>
    </div>
  );
}
