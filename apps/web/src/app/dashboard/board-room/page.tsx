import { serverApiFetch } from '@/lib/server-api';

interface OpportunityListItem {
  id: string;
  title: string;
  status: string;
  proposal: { id: string; status: string } | null;
}

export default async function BoardRoomIndexPage() {
  const { data } = await serverApiFetch<OpportunityListItem[]>('/opportunities');
  const withProposals = (data ?? []).filter((o) => o.proposal !== null);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Board Room</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 4 }}>
          Venture proposals available for board review. Promote an opportunity from the Opportunity
          Feed to create one.
        </p>
      </div>
      <div className="vos-card">
        {withProposals.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No venture proposals yet -- promote an opportunity first.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Opportunity</th>
                <th>Proposal status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {withProposals.map((o) => (
                <tr key={o.proposal!.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '10px 0' }}>{o.title}</td>
                  <td>{o.proposal!.status}</td>
                  <td>
                    <a
                      href={`/dashboard/board-room/${o.proposal!.id}`}
                      style={{ color: 'var(--vos-accent)' }}
                    >
                      Open Board Room
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
