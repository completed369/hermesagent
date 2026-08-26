import { DataSurface, EmptyState, PageHeader, StatCard } from '@/components/workspace-ui';
import { serverApiFetch } from '@/lib/server-api';
import { shortReference, statusTone, type WorkflowCentreSnapshot } from '@/lib/workflow-centre';
import styles from './workflows.module.css';

function StatusBadge({ status }: { status: string }) {
  return <span className={`vos-badge vos-badge--${statusTone(status)}`}>{status}</span>;
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function WorkflowCentreView({ snapshot }: { snapshot: WorkflowCentreSnapshot }) {
  const dependencies = new Map<string, string[]>();
  for (const edge of snapshot.dependencies) {
    const current = dependencies.get(edge.taskId) ?? [];
    current.push(edge.dependsOnTaskId);
    dependencies.set(edge.taskId, current);
  }
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const hasWork = snapshot.workflows.length > 0 || snapshot.tasks.length > 0;

  return (
    <div className="vos-page-stack" data-testid="workflow-centre">
      <PageHeader
        eyebrow="AI Workforce"
        title="Workflow Centre"
        description={`Read-only workspace snapshot observed ${formatTime(snapshot.observedAt)}.`}
      />
      <section className="vos-stat-grid" aria-label="Workflow Centre status">
        <StatCard
          label="Objectives"
          value={snapshot.summary.objectives}
          detail="Workspace scoped"
        />
        <StatCard label="Tasks" value={snapshot.summary.tasks} detail="Across durable objectives" />
        <StatCard
          label="Active runs"
          value={snapshot.summary.activeRuns}
          detail="Prepared through running"
        />
        <StatCard
          label="Level-4 decisions"
          value={snapshot.summary.pendingLevel4Approvals}
          detail="Pending Founder authority"
          tone="accent"
        />
      </section>

      <aside className={styles.runtimeBoundary} aria-label="Runtime connectivity boundary">
        <strong>Codex, Hermes and Pi: NOT_CONFIGURED</strong>
        <p>
          This view reports persisted state only. No runtime is called connected without
          authenticated registration, capability exchange, heartbeat, task/status exchange, and an
          event/result round trip. This page cannot start, cancel, approve, or execute work.
        </p>
      </aside>

      {!hasWork ? (
        <DataSurface>
          <EmptyState title="No workflow activity yet">
            Durable agent work and application workflows will appear here after they are created
            through governed services. An empty view is not runtime-connectivity evidence.
          </EmptyState>
        </DataSurface>
      ) : null}

      <div className={styles.split}>
        <DataSurface
          title="AI task graph"
          description="Bounded task, dependency, assignment, and authority status."
        >
          {snapshot.tasks.length === 0 ? (
            <EmptyState title="No durable tasks">
              No AI COO task plan exists in this workspace.
            </EmptyState>
          ) : (
            <ol className={styles.taskList}>
              {snapshot.tasks.map((task) => {
                const dependencyIds = dependencies.get(task.id) ?? [];
                const run = snapshot.runs.find((candidate) => candidate.taskId === task.id);
                return (
                  <li className={styles.taskCard} key={task.id}>
                    <div className={styles.taskHeader}>
                      <h3>{task.title}</h3>
                      <StatusBadge status={task.status} />
                    </div>
                    <p className={styles.meta}>
                      {task.kind} · Level {task.requiredAuthority} · attempt {task.attempt} · run{' '}
                      {shortReference(run?.id ?? null)}
                    </p>
                    <p className={styles.dependency}>
                      Depends on:{' '}
                      {dependencyIds.length === 0
                        ? 'none'
                        : dependencyIds
                            .map((id) => tasksById.get(id)?.title ?? shortReference(id))
                            .join(', ')}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
          {snapshot.bounds.tasks.truncated ? (
            <p className={styles.boundaryNote}>
              Showing {snapshot.bounds.tasks.returned} of {snapshot.bounds.tasks.total} tasks.
            </p>
          ) : null}
        </DataSurface>

        <DataSurface
          title="Runtime status"
          description="Persisted provider-neutral records; status is never inferred from installation."
        >
          {snapshot.runtimes.length === 0 ? (
            <EmptyState title="No runtime records">
              Codex, Hermes and Pi remain NOT_CONFIGURED.
            </EmptyState>
          ) : (
            <ul className={styles.runtimeList}>
              {snapshot.runtimes.map((runtime) => {
                const connections = snapshot.connections.filter(
                  (connection) => connection.runtimeId === runtime.id,
                );
                return (
                  <li className={styles.runtimeCard} key={runtime.id}>
                    <div className={styles.runtimeHeader}>
                      <h3>{shortReference(runtime.id)}</h3>
                      <StatusBadge status={runtime.status} />
                    </div>
                    <p className={styles.meta}>
                      {runtime.adapterKind} · {connections.length} bounded connection record
                      {connections.length === 1 ? '' : 's'}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </DataSurface>
      </div>

      <DataSurface
        title="Application workflows"
        description="Safe metadata only; workflow inputs, outputs, and errors are intentionally excluded."
      >
        {snapshot.workflows.length === 0 ? (
          <EmptyState title="No application workflows">
            No persisted workflow run exists here.
          </EmptyState>
        ) : (
          <table className="vos-data-table">
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Status</th>
                <th>Started</th>
                <th>Steps</th>
                <th>Correlation</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td data-label="Workflow">
                    <strong>{workflow.type}</strong>
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={workflow.status} />
                  </td>
                  <td data-label="Started">{formatTime(workflow.startedAt)}</td>
                  <td data-label="Steps">
                    {workflow.steps.length}
                    {workflow.stepsTruncated ? '+' : ''}
                  </td>
                  <td data-label="Correlation">{shortReference(workflow.correlationId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataSurface>

      <DataSurface
        title="Founder decisions required"
        description="Read-only Level-4 summaries. Decision authority remains in the governed approval path."
      >
        {snapshot.pendingLevel4Approvals.length === 0 ? (
          <EmptyState title="No Level-4 decisions pending">
            No durable ACP approval request currently awaits Founder authority.
          </EmptyState>
        ) : (
          <table className="vos-data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>State</th>
                <th>Task</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.pendingLevel4Approvals.map((approval) => (
                <tr key={approval.id}>
                  <td data-label="Action">
                    <strong>{approval.actionCode}</strong>
                  </td>
                  <td data-label="State">
                    <StatusBadge status={approval.state} />
                  </td>
                  <td data-label="Task">{shortReference(approval.taskId)}</td>
                  <td data-label="Expires">{formatTime(approval.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataSurface>
    </div>
  );
}

export default async function WorkflowCentrePage() {
  const { data, status } = await serverApiFetch<WorkflowCentreSnapshot>('/workflow-centre');
  if (!data) {
    return (
      <div className="vos-page-stack">
        <PageHeader
          eyebrow="AI Workforce"
          title="Workflow Centre"
          description="Read-only workflow visibility is unavailable."
        />
        <DataSurface>
          <EmptyState
            title={status === 403 ? 'Workflow access unavailable' : 'Workflow data unavailable'}
          >
            {status === 403
              ? 'Your active workspace role does not include workflow:view.'
              : 'VentureOS could not verify a current workspace snapshot. Try again later.'}
          </EmptyState>
        </DataSurface>
      </div>
    );
  }
  return <WorkflowCentreView snapshot={data} />;
}
