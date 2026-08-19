import { serverApiFetch } from '@/lib/server-api';
import {
  COMMAND_CENTRE_STATUS_COPY,
  ventureProposalCount,
  pendingApprovalCount,
  currentBudgetUtilisation,
  connectedIntegrationCount,
} from '@/lib/dashboard';
import { DataSurface, PageHeader, StatCard } from '@/components/workspace-ui';

interface WorkspaceSummary {
  workspace: { name: string; slug: string; baseCurrency: string };
  memberCount: number;
  ventureCount?: number | null;
  integrations: Array<{ provider: string; mode: string; status: string; writeEnabled: boolean }>;
}

interface ApprovalRequest {
  id: string;
  state: string;
}

interface BudgetAllocation {
  spentEur: string | number | null;
}

interface Budget {
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalLimitEur: string | number | null;
  allocations?: BudgetAllocation[] | null;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function CommandCentrePage() {
  const [summaryRes, approvalsRes, budgetsRes] = await Promise.all([
    serverApiFetch<WorkspaceSummary>('/workspaces/current'),
    serverApiFetch<ApprovalRequest[]>('/approval-requests'),
    serverApiFetch<Budget[]>('/finance/budgets'),
  ]);

  const summary = summaryRes.data;
  const approvals = approvalsRes.data;
  const budgets = budgetsRes.data;

  const ventureValue = ventureProposalCount(summary?.ventureCount ?? null);
  const pendingValue = pendingApprovalCount(approvals);
  const budget = currentBudgetUtilisation(budgets);
  const connectedCount = connectedIntegrationCount(summary?.integrations ?? null);
  const totalIntegrations = summary?.integrations.length ?? null;

  return (
    <div className="vos-page-stack">
      <PageHeader
        eyebrow="Workspace overview"
        title="Command Centre"
        description={
          summary
            ? `${summary.workspace.name} · ${summary.workspace.baseCurrency} workspace · ${summary.memberCount} member${summary.memberCount === 1 ? '' : 's'}`
            : 'Workspace status is temporarily unavailable.'
        }
      />
      <section className="vos-stat-grid" aria-label="Workspace status">
        <StatCard
          label="Venture proposals"
          value={ventureValue ?? '—'}
          detail="Across this workspace"
        />
        <StatCard
          label="Pending approvals"
          value={pendingValue ?? '—'}
          detail="Waiting for authority"
          tone="accent"
        />
        <StatCard
          label="Budget utilisation"
          value={
            budget ? `${formatEur(budget.totalSpentEur)} / ${formatEur(budget.totalLimitEur)}` : '—'
          }
          detail="Current active period"
        />
        <StatCard
          label="Connected integrations"
          value={
            <>
              {connectedCount ?? '—'}
              {totalIntegrations !== null ? <small> / {totalIntegrations}</small> : null}
            </>
          }
          detail="Provider health"
        />
      </section>
      <DataSurface
        title="Integration status"
        description="Provider mode, write authority, and current connection state."
      >
        <table className="vos-data-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Mode</th>
              <th>Write enabled</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.integrations ?? []).map((i) => (
              <tr key={i.provider}>
                <td data-label="Provider">
                  <strong>{i.provider}</strong>
                </td>
                <td data-label="Mode">{i.mode}</td>
                <td data-label="Write enabled">{i.writeEnabled ? 'Yes' : 'No'}</td>
                <td data-label="Status">
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
      </DataSurface>
      <aside className="vos-governance-note">
        <span aria-hidden="true">i</span>
        <div>
          <h2>Available versus gated</h2>
          <p>{COMMAND_CENTRE_STATUS_COPY}</p>
        </div>
      </aside>
    </div>
  );
}
