import { serverApiFetch } from '@/lib/server-api';

interface OpportunityListItem {
  id: string;
  title: string;
  status: string;
  proposal: { id: string; status: string } | null;
}
interface BudgetAllocationSummary {
  id: string;
  category: string;
  limitEur: string;
  spentEur: string;
}
interface BudgetSummary {
  id: string;
  name: string;
  ventureProposalId: string | null;
  status: string;
  totalLimitEur: string;
  allocations: BudgetAllocationSummary[];
}

export default async function FinanceCentreIndexPage() {
  const [{ data: opportunities }, { data: budgets }] = await Promise.all([
    serverApiFetch<OpportunityListItem[]>('/opportunities'),
    serverApiFetch<BudgetSummary[]>('/finance/budgets'),
  ]);
  const withProposals = (opportunities ?? []).filter((o) => o.proposal !== null);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Finance Centre</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 4 }}>
          Real finance assumptions, forecasts, expenses, revenue, budgets, cost ledger, and
          controlled experiments (Gate 6 scale decisions) per venture -- built on top of
          @ventureos/finance-engine&apos;s already-unit-tested unit-economics/break-even/scenario
          functions.
        </p>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Ventures</h2>
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
                      href={`/dashboard/finance/${o.proposal!.id}`}
                      style={{ color: 'var(--vos-accent)' }}
                    >
                      Open Finance Centre →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Budgets</h2>
        {!budgets || budgets.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No budgets created yet. Budgets can be workspace-wide or scoped to a single venture;
            per-category allocations (AI_MODEL_USAGE, RESEARCH, ADVERTISING, PRODUCT_GENERATION,
            OTHER) fail closed once spend would exceed their limit.
          </p>
        ) : (
          budgets.map((b) => (
            <div key={b.id} style={{ marginTop: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                {b.name}{' '}
                <span className="vos-badge vos-badge--mock">
                  {b.ventureProposalId ? 'venture-scoped' : 'workspace-wide'}
                </span>{' '}
                <span className="vos-badge">{b.status}</span>
              </p>
              <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', margin: '4px 0' }}>
                Total limit: EUR {b.totalLimitEur}
              </p>
              {b.allocations.length > 0 && (
                <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
                  {b.allocations.map((a) => (
                    <li key={a.id}>
                      {a.category}: EUR {a.spentEur} / EUR {a.limitEur} spent
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
