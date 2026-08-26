export interface WorkflowCentreSnapshot {
  schemaVersion: 1;
  observedAt: string;
  access: { permission: 'workflow:view'; mode: 'READ_ONLY' };
  connectivity: {
    status: 'NOT_CONFIGURED';
    targets: ['CODEX', 'HERMES', 'PI'];
    reasonCode: 'NO_AUTHENTICATED_DIRECT_ADAPTER';
  };
  summary: {
    workflowRuns: number;
    objectives: number;
    tasks: number;
    runs: number;
    activeRuns: number;
    runtimes: number;
    connections: number;
    pendingLevel4Approvals: number;
  };
  bounds: Record<
    | 'workflowRuns'
    | 'objectives'
    | 'tasks'
    | 'dependencies'
    | 'runs'
    | 'runtimes'
    | 'connections'
    | 'pendingApprovals',
    { total: number; returned: number; truncated: boolean }
  > & { stepsPerWorkflow: number };
  workflows: Array<{
    id: string;
    type: string;
    status: string;
    correlationId: string | null;
    startedAt: string;
    completedAt: string | null;
    stepsTruncated: boolean;
    steps: Array<{
      id: string;
      name: string;
      status: string;
      attempt: number;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
    }>;
  }>;
  objectives: Array<{
    id: string;
    title: string;
    status: string;
    maximumAuthority: number;
    version: number;
    createdAt: string;
    updatedAt: string;
  }>;
  tasks: Array<{
    id: string;
    objectiveId: string;
    projectId: string;
    title: string;
    kind: string;
    status: string;
    requiredAuthority: number;
    assignment: { agentId: string | null; runtimeId: string | null; connectionId: string | null };
    attempt: number;
    version: number;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  }>;
  dependencies: Array<{ taskId: string; dependsOnTaskId: string }>;
  runs: Array<{
    id: string;
    objectiveId: string;
    taskId: string;
    status: string;
    requiredAuthority: number;
    assignment: { agentId: string | null; runtimeId: string | null; connectionId: string | null };
    attempt: number;
    version: number;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  runtimes: Array<{
    id: string;
    adapterKind: string;
    status: string;
    version: number;
    updatedAt: string;
  }>;
  connections: Array<{
    id: string;
    runtimeId: string;
    environment: string;
    status: string;
    lastHeartbeatAt: string | null;
    lastHeartbeatHealth: string | null;
    version: number;
    updatedAt: string;
  }>;
  pendingLevel4Approvals: Array<{
    id: string;
    objectiveId: string;
    taskId: string;
    runId: string;
    actionCode: string;
    state: string;
    expiresAt: string;
    createdAt: string;
  }>;
}

export function statusTone(status: string): 'ok' | 'danger' | 'mock' {
  if (status === 'COMPLETED' || status === 'HEALTHY') return 'ok';
  if (status === 'FAILED' || status === 'DEGRADED' || status === 'UNKNOWN') return 'danger';
  return 'mock';
}

export function shortReference(value: string | null): string {
  if (!value) return '—';
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}
