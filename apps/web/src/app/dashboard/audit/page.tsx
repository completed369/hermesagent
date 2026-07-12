import { serverApiFetch } from '@/lib/server-api';

interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  correlationId: string | null;
  createdAt: string;
}

export default async function AuditPage() {
  const { data } = await serverApiFetch<AuditEvent[]>('/audit-events?limit=100');

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Audit Centre</h1>
      <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 0 }}>
        Append-only. Every sensitive action recorded here is tamper-evident (integrity-hashed) and can
        never be edited or deleted through the application.
      </p>
      <div className="vos-card" style={{ marginTop: 16 }}>
        {!data || data.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>No audit events yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '6px 0' }}>Time</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '8px 0' }}>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{e.action}</td>
                  <td>{e.entityType}#{e.entityId.slice(0, 8)}</td>
                  <td style={{ color: 'var(--vos-text-muted)' }}>{e.correlationId?.slice(0, 8) ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
