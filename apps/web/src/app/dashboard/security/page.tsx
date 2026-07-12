import { serverApiFetch } from '@/lib/server-api';

interface SecurityEvent {
  id: string;
  type: string;
  severity: string;
  description: string;
  createdAt: string;
}

export default async function SecurityPage() {
  const { data } = await serverApiFetch<SecurityEvent[]>('/security-events?limit=100');

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Security Events</h1>
      <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 0 }}>
        Login attempts, rate-limit hits, and other security-relevant activity.
      </p>
      <div className="vos-card" style={{ marginTop: 16 }}>
        {!data || data.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>No security events yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '6px 0' }}>Time</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '8px 0' }}>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{e.type}</td>
                  <td>
                    <span
                      className={`vos-badge ${e.severity === 'CRITICAL' ? 'vos-badge--danger' : e.severity === 'WARN' ? 'vos-badge--mock' : 'vos-badge--ok'}`}
                    >
                      {e.severity}
                    </span>
                  </td>
                  <td>{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
