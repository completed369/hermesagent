import { Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@ventureos/database';

const LIMITS = Object.freeze({
  workflowRuns: 50,
  stepsPerWorkflow: 20,
  objectives: 20,
  tasks: 200,
  dependencies: 1_000,
  runs: 200,
  runtimes: 50,
  connections: 100,
  pendingApprovals: 50,
});

const SENSITIVE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|authorization|transcript|prompt|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat|glpat)[_-][A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/iu;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SAFE_CODE = /^[A-Z0-9][A-Z0-9._-]{0,127}$/u;

const WORKFLOW_STATUSES = new Set(['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED']);
const STEP_STATUSES = new Set(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED']);
const OBJECTIVE_STATUSES = new Set(['ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED']);
const TASK_STATUSES = new Set([
  'BLOCKED',
  'AWAITING_APPROVAL',
  'READY',
  'ASSIGNED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
const RUN_STATUSES = new Set([
  'PREPARED',
  'AWAITING_APPROVAL',
  'ASSIGNED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
const RUNTIME_STATUSES = new Set([
  'CONNECTED',
  'PARTIAL',
  'DEGRADED',
  'DISCONNECTED',
  'NOT_CONFIGURED',
]);
const APPROVAL_STATES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'HELD', 'REVOKED', 'EXPIRED']);

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function safeReference(value: string): string {
  return SAFE_REFERENCE.test(value) && !SENSITIVE_TEXT.test(value) ? value : 'REDACTED_REFERENCE';
}

function safeCode(value: string): string {
  return SAFE_CODE.test(value) && !SENSITIVE_TEXT.test(value) ? value : 'UNKNOWN';
}

function safeDisplayText(value: string, maximumLength = 160): string {
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return '[REDACTED]';
  if (SENSITIVE_TEXT.test(value)) return '[REDACTED]';
  const printable = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!printable) return '[UNAVAILABLE]';
  return printable.slice(0, maximumLength);
}

function knownStatus(value: string, allowed: ReadonlySet<string>): string {
  return allowed.has(value) ? value : 'UNKNOWN';
}

function truncate(
  total: number,
  returned: number,
): { total: number; returned: number; truncated: boolean } {
  return { total, returned, truncated: total > returned };
}

@Injectable()
export class WorkflowCentreService {
  async snapshot(workspaceId: string) {
    return prisma.$transaction(
      async (tx) => {
        const [clock] = await tx.$queryRaw<Array<{ observedAt: Date }>>(
          Prisma.sql`SELECT clock_timestamp() AS "observedAt"`,
        );
        if (!clock?.observedAt) throw new Error('Workflow Centre database clock unavailable');

        const [
          workflowRunTotal,
          objectiveTotal,
          taskTotal,
          dependencyTotal,
          runTotal,
          activeRunTotal,
          runtimeTotal,
          connectionTotal,
          pendingApprovalTotal,
        ] = await Promise.all([
          tx.workflowRun.count({ where: { workspaceId } }),
          tx.acpObjective.count({ where: { workspaceId } }),
          tx.acpTask.count({ where: { workspaceId } }),
          tx.acpTaskDependency.count({ where: { workspaceId } }),
          tx.acpRun.count({ where: { workspaceId } }),
          tx.acpRun.count({
            where: {
              workspaceId,
              status: { in: ['PREPARED', 'AWAITING_APPROVAL', 'ASSIGNED', 'RUNNING'] },
            },
          }),
          tx.acpRuntime.count({ where: { workspaceId } }),
          tx.acpRuntimeConnection.count({ where: { workspaceId } }),
          tx.acpApprovalRequest.count({
            where: {
              workspaceId,
              state: 'PENDING',
              requiredAuthorityLevel: 4,
              expiresAt: { gt: clock.observedAt },
            },
          }),
        ]);

        const [workflowRows, objectiveRows, runtimeRows, connectionRows, approvalRows] =
          await Promise.all([
            tx.workflowRun.findMany({
              where: { workspaceId },
              orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
              take: LIMITS.workflowRuns,
              select: {
                id: true,
                workflowType: true,
                status: true,
                correlationId: true,
                startedAt: true,
                completedAt: true,
                steps: {
                  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                  take: LIMITS.stepsPerWorkflow + 1,
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    attempt: true,
                    startedAt: true,
                    completedAt: true,
                    createdAt: true,
                  },
                },
              },
            }),
            tx.acpObjective.findMany({
              where: { workspaceId },
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
              take: LIMITS.objectives,
              select: {
                id: true,
                title: true,
                status: true,
                maximumAuthority: true,
                version: true,
                createdAt: true,
                updatedAt: true,
              },
            }),
            tx.acpRuntime.findMany({
              where: { workspaceId },
              orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
              take: LIMITS.runtimes,
              select: { id: true, adapterKind: true, status: true, version: true, updatedAt: true },
            }),
            tx.acpRuntimeConnection.findMany({
              where: { workspaceId },
              orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
              take: LIMITS.connections,
              select: {
                id: true,
                runtimeId: true,
                environment: true,
                status: true,
                lastHeartbeatAt: true,
                lastHeartbeatHealth: true,
                version: true,
                updatedAt: true,
              },
            }),
            tx.acpApprovalRequest.findMany({
              where: {
                workspaceId,
                state: 'PENDING',
                requiredAuthorityLevel: 4,
                expiresAt: { gt: clock.observedAt },
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
              take: LIMITS.pendingApprovals,
              select: {
                id: true,
                objectiveId: true,
                taskId: true,
                runId: true,
                actionCode: true,
                state: true,
                expiresAt: true,
                createdAt: true,
              },
            }),
          ]);

        const objectiveIds = objectiveRows.map(({ id }) => id);
        const taskRows =
          objectiveIds.length === 0
            ? []
            : await tx.acpTask.findMany({
                where: { workspaceId, objectiveId: { in: objectiveIds } },
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                take: LIMITS.tasks,
                select: {
                  id: true,
                  objectiveId: true,
                  projectId: true,
                  title: true,
                  kind: true,
                  status: true,
                  requiredAuthority: true,
                  assignedAgentId: true,
                  assignedRuntimeId: true,
                  assignedConnectionId: true,
                  attempt: true,
                  version: true,
                  createdAt: true,
                  updatedAt: true,
                  completedAt: true,
                },
              });
        const taskIds = taskRows.map(({ id }) => id);
        const [dependencyRows, runRows] =
          taskIds.length === 0
            ? [[], []]
            : await Promise.all([
                tx.acpTaskDependency.findMany({
                  where: { workspaceId, taskId: { in: taskIds } },
                  orderBy: [{ taskId: 'asc' }, { dependsOnTaskId: 'asc' }],
                  take: LIMITS.dependencies,
                  select: { taskId: true, dependsOnTaskId: true },
                }),
                tx.acpRun.findMany({
                  where: { workspaceId, taskId: { in: taskIds } },
                  orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                  take: LIMITS.runs,
                  select: {
                    id: true,
                    objectiveId: true,
                    taskId: true,
                    status: true,
                    requiredAuthority: true,
                    assignedAgentId: true,
                    assignedRuntimeId: true,
                    assignedConnectionId: true,
                    attempt: true,
                    version: true,
                    createdAt: true,
                    updatedAt: true,
                    startedAt: true,
                    completedAt: true,
                  },
                }),
              ]);

        return {
          schemaVersion: 1,
          observedAt: clock.observedAt.toISOString(),
          access: { permission: 'workflow:view', mode: 'READ_ONLY' },
          connectivity: {
            status: 'NOT_CONFIGURED',
            targets: ['CODEX', 'HERMES', 'PI'],
            reasonCode: 'NO_AUTHENTICATED_DIRECT_ADAPTER',
          },
          summary: {
            workflowRuns: workflowRunTotal,
            objectives: objectiveTotal,
            tasks: taskTotal,
            runs: runTotal,
            activeRuns: activeRunTotal,
            runtimes: runtimeTotal,
            connections: connectionTotal,
            pendingLevel4Approvals: pendingApprovalTotal,
          },
          bounds: {
            workflowRuns: truncate(workflowRunTotal, workflowRows.length),
            objectives: truncate(objectiveTotal, objectiveRows.length),
            tasks: truncate(taskTotal, taskRows.length),
            dependencies: truncate(dependencyTotal, dependencyRows.length),
            runs: truncate(runTotal, runRows.length),
            runtimes: truncate(runtimeTotal, runtimeRows.length),
            connections: truncate(connectionTotal, connectionRows.length),
            pendingApprovals: truncate(pendingApprovalTotal, approvalRows.length),
            stepsPerWorkflow: LIMITS.stepsPerWorkflow,
          },
          workflows: workflowRows.map((row) => ({
            id: safeReference(row.id),
            type: safeReference(row.workflowType),
            status: knownStatus(row.status, WORKFLOW_STATUSES),
            correlationId: row.correlationId ? safeReference(row.correlationId) : null,
            startedAt: row.startedAt.toISOString(),
            completedAt: iso(row.completedAt),
            stepsTruncated: row.steps.length > LIMITS.stepsPerWorkflow,
            steps: row.steps.slice(0, LIMITS.stepsPerWorkflow).map((step) => ({
              id: safeReference(step.id),
              name: safeDisplayText(step.name),
              status: knownStatus(step.status, STEP_STATUSES),
              attempt: step.attempt,
              startedAt: iso(step.startedAt),
              completedAt: iso(step.completedAt),
              createdAt: step.createdAt.toISOString(),
            })),
          })),
          objectives: objectiveRows.map((row) => ({
            id: safeReference(row.id),
            title: safeDisplayText(row.title),
            status: knownStatus(row.status, OBJECTIVE_STATUSES),
            maximumAuthority: row.maximumAuthority,
            version: row.version,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
          tasks: taskRows.map((row) => ({
            id: safeReference(row.id),
            objectiveId: safeReference(row.objectiveId),
            projectId: safeReference(row.projectId),
            title: safeDisplayText(row.title),
            kind: safeReference(row.kind),
            status: knownStatus(row.status, TASK_STATUSES),
            requiredAuthority: row.requiredAuthority,
            assignment: {
              agentId: row.assignedAgentId ? safeReference(row.assignedAgentId) : null,
              runtimeId: row.assignedRuntimeId ? safeReference(row.assignedRuntimeId) : null,
              connectionId: row.assignedConnectionId
                ? safeReference(row.assignedConnectionId)
                : null,
            },
            attempt: row.attempt,
            version: row.version,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            completedAt: iso(row.completedAt),
          })),
          dependencies: dependencyRows.map((row) => ({
            taskId: safeReference(row.taskId),
            dependsOnTaskId: safeReference(row.dependsOnTaskId),
          })),
          runs: runRows.map((row) => ({
            id: safeReference(row.id),
            objectiveId: safeReference(row.objectiveId),
            taskId: safeReference(row.taskId),
            status: knownStatus(row.status, RUN_STATUSES),
            requiredAuthority: row.requiredAuthority,
            assignment: {
              agentId: row.assignedAgentId ? safeReference(row.assignedAgentId) : null,
              runtimeId: row.assignedRuntimeId ? safeReference(row.assignedRuntimeId) : null,
              connectionId: row.assignedConnectionId
                ? safeReference(row.assignedConnectionId)
                : null,
            },
            attempt: row.attempt,
            version: row.version,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            startedAt: iso(row.startedAt),
            completedAt: iso(row.completedAt),
          })),
          runtimes: runtimeRows.map((row) => ({
            id: safeReference(row.id),
            adapterKind: safeCode(row.adapterKind),
            status: knownStatus(row.status, RUNTIME_STATUSES),
            version: row.version,
            updatedAt: row.updatedAt.toISOString(),
          })),
          connections: connectionRows.map((row) => ({
            id: safeReference(row.id),
            runtimeId: safeReference(row.runtimeId),
            environment: safeCode(row.environment),
            status: knownStatus(row.status, RUNTIME_STATUSES),
            lastHeartbeatAt: iso(row.lastHeartbeatAt),
            lastHeartbeatHealth: row.lastHeartbeatHealth ? safeCode(row.lastHeartbeatHealth) : null,
            version: row.version,
            updatedAt: row.updatedAt.toISOString(),
          })),
          pendingLevel4Approvals: approvalRows.map((row) => ({
            id: row.id,
            objectiveId: safeReference(row.objectiveId),
            taskId: safeReference(row.taskId),
            runId: safeReference(row.runId),
            actionCode: safeCode(row.actionCode),
            state: knownStatus(row.state, APPROVAL_STATES),
            expiresAt: row.expiresAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
          })),
        } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
