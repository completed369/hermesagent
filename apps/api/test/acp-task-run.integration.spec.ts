import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OperationalEventCapability,
  type AssignmentEvidenceVerifier,
  type DurableArtifactEvidenceVerifier,
  type DurableObjectivePlanInput,
} from '@ventureos/agent-control-plane';
import { prisma } from '@ventureos/database';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  AcpTaskRunConflictError,
  AcpTaskRunDeniedError,
  AcpTaskRunService,
} from '../src/modules/agent-control-plane/acp-task-run.service';
import { AcpApprovalBridgeService } from '../src/modules/approvals/acp-approval-bridge.service';

describe('durable ACP task/run spine (PostgreSQL integration)', () => {
  const suffix = randomUUID();
  const plannerId = `coo-${suffix}`;
  const controlId = `control-${suffix}`;
  let workspaceId: string;
  let secondWorkspaceId: string;
  const assignmentVerifier: AssignmentEvidenceVerifier = {
    async verify(_workspaceId, evidence) {
      return evidence.evidenceHash === 'c'.repeat(64);
    },
  };
  const artifactVerifier: DurableArtifactEvidenceVerifier = {
    async verify(_workspaceId, evidence) {
      return evidence.evidenceHash === 'd'.repeat(64);
    },
  };
  const service = new AcpTaskRunService(new AuditService(), assignmentVerifier, artifactVerifier);
  const approvalBridge = new AcpApprovalBridgeService(new AuditService(), service);
  let plannerCapability: OperationalEventCapability;
  let controlCapability: OperationalEventCapability;

  const task = (id: string, dependencyIds: readonly string[] = []) => ({
    id,
    projectId: `project-${suffix}`,
    title: `Task ${id}`,
    kind: 'quality.verify' as const,
    dependencyIds,
    requiredAuthority: 3 as const,
    costLimit: { currency: 'EUR', maximumMinorUnits: 100, maximumComputeUnits: 100 },
    estimatedDurationMs: 1_000,
    acceptanceCriteria: [`accept-${id}`],
    verificationCriteria: [`verify-${id}`],
    stopConditions: ['policy-stop'],
    retryPolicy: {
      maximumAttempts: 2,
      retryableFailureCodes: ['TRANSIENT'],
      stopAfterFailureCodes: ['POLICY_DENIED'],
    },
    agentPolicy: { templateId: 'quality-agent', scopes: ['read'] },
    routingPolicy: { capabilityId: 'quality.verify', maximumLatencyMs: 1_000 },
  });

  const plan = (): DurableObjectivePlanInput => {
    const firstId = `first-${suffix}`;
    return {
      workspaceId,
      idempotencyKey: `plan-${suffix}`,
      policyVersion: 'acp-task-run-v1',
      objective: {
        id: `objective-${suffix}`,
        title: 'Verify release candidate',
        desiredOutcome: 'Produce bounded release evidence',
        maximumAuthority: 4,
        costLimit: { currency: 'EUR', maximumMinorUnits: 1_000, maximumComputeUnits: 1_000 },
        acceptanceCriteria: ['All declared checks pass'],
        verificationCriteria: ['Evidence hashes are verified'],
        stopConditions: ['Stop on policy denial'],
      },
      projects: [{ id: `project-${suffix}`, title: 'Release evidence' }],
      tasks: [
        task(firstId),
        task(`dependent-${suffix}`, [firstId]),
        task(`race-${suffix}`),
        {
          ...task(`level4-${suffix}`),
          requiredAuthority: 4,
          approval: {
            actionCode: 'PRODUCTION.DEPLOY',
            exactTarget: `release/hermesagent/${suffix}`,
            artifactVersionId: `release-${suffix}`,
            evidenceHash: 'a'.repeat(64),
          },
        },
      ],
    };
  };

  beforeAll(async () => {
    const [workspace, secondWorkspace] = await Promise.all([
      prisma.workspace.create({
        data: { name: 'ACP task/run integration', slug: `acp-task-run-${suffix}` },
      }),
      prisma.workspace.create({
        data: { name: 'ACP task/run isolation', slug: `acp-task-run-other-${suffix}` },
      }),
    ]);
    workspaceId = workspace.id;
    secondWorkspaceId = secondWorkspace.id;
    plannerCapability = OperationalEventCapability.issue('AI_COO', [
      { workspaceId, principalId: plannerId, actorKind: 'AGENT', authorityLevel: 3 },
    ]);
    controlCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId: controlId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
  });

  afterAll(async () => {
    if (workspaceId)
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspaceId, secondWorkspaceId] } },
      });
  });

  it('atomically creates an exact durable plan, dependencies, prepared runs, and audit evidence', async () => {
    const input = plan();
    const created = await service.createPlan(
      plannerCapability,
      { workspaceId, principalId: plannerId },
      input,
    );
    expect(created.replayed).toBe(false);
    expect(created.objective.tasks).toHaveLength(4);
    const routine = created.objective.tasks.find((candidate) => candidate.id.startsWith('first-'))!;
    const dependent = created.objective.tasks.find((candidate) =>
      candidate.id.startsWith('dependent-'),
    )!;
    const level4 = created.objective.tasks.find((candidate) => candidate.id.startsWith('level4-'))!;
    expect(routine).toMatchObject({ status: 'READY', requiredAuthority: 3 });
    expect(routine.runs[0]).toMatchObject({ status: 'PREPARED', assignedAgentId: null });
    expect(dependent).toMatchObject({ status: 'BLOCKED' });
    expect(level4).toMatchObject({ status: 'AWAITING_APPROVAL', requiredAuthority: 4 });
    expect(level4.runs[0]).toMatchObject({
      status: 'AWAITING_APPROVAL',
      assignedAgentId: null,
      evidenceHash: 'a'.repeat(64),
    });
    expect(
      await prisma.auditEvent.count({ where: { workspaceId, correlationId: input.objective.id } }),
    ).toBeGreaterThanOrEqual(9);

    const replay = await service.createPlan(
      plannerCapability,
      { workspaceId, principalId: plannerId },
      input,
    );
    expect(replay.replayed).toBe(true);
    await expect(
      service.createPlan(
        plannerCapability,
        { workspaceId, principalId: plannerId },
        { ...input, objective: { ...input.objective, title: 'Drifted objective' } },
      ),
    ).rejects.toBeInstanceOf(AcpTaskRunConflictError);
  });

  it('returns the exact unassigned Level-4 approval binding and denies workspace or authority bypass', async () => {
    const level4 = await prisma.acpTask.findFirstOrThrow({
      where: { workspaceId, id: { startsWith: 'level4-' } },
      include: { runs: true },
    });
    await expect(
      service.getPreparedApprovalBinding(
        { workspaceId: secondWorkspaceId, principalId: plannerId },
        level4.runs[0]!.id,
      ),
    ).rejects.toThrow();
    const binding = await service.getPreparedApprovalBinding(
      { workspaceId, principalId: plannerId },
      level4.runs[0]!.id,
    );
    expect(binding).toMatchObject({
      workspaceId,
      objectiveId: level4.objectiveId,
      taskId: level4.id,
      runId: level4.runs[0]!.id,
    });
    expect(binding).not.toHaveProperty('requiredAuthority');
    const requested = await approvalBridge.requestApproval(
      plannerCapability,
      { workspaceId, principalId: plannerId },
      {
        ...binding,
        idempotencyKey: `level4-approval-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    );
    expect(requested.request).toMatchObject({
      taskId: level4.id,
      runId: level4.runs[0]!.id,
      state: 'PENDING',
    });
    await expect(
      approvalBridge.requestApproval(
        plannerCapability,
        { workspaceId, principalId: plannerId },
        {
          ...binding,
          runId: `fabricated-${suffix}`,
          idempotencyKey: `fabricated-approval-${suffix}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ),
    ).rejects.toThrow();
    await expect(
      service.reserveAssignment(
        controlCapability,
        { workspaceId, principalId: controlId },
        {
          evidenceId: `assign-level4-${suffix}`,
          evidenceHash: 'c'.repeat(64),
          taskId: level4.id,
          runId: level4.runs[0]!.id,
          agentId: `agent-${suffix}`,
          runtimeId: `runtime-${suffix}`,
          connectionId: `connection-${suffix}`,
        },
        1,
        `assign-level4-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(AcpTaskRunDeniedError);
  });

  it('requires trusted assignment/artifact evidence, optimistic versions, and complete declared evidence', async () => {
    const routine = await prisma.acpTask.findFirstOrThrow({
      where: { workspaceId, id: { startsWith: 'first-' } },
      include: { runs: true },
    });
    const run = routine.runs[0]!;
    const assignment = {
      evidenceId: `assign-${suffix}`,
      evidenceHash: 'c'.repeat(64),
      taskId: routine.id,
      runId: run.id,
      agentId: `agent-${suffix}`,
      runtimeId: `runtime-${suffix}`,
      connectionId: `connection-${suffix}`,
    };
    const assigned = await service.reserveAssignment(
      controlCapability,
      { workspaceId, principalId: controlId },
      assignment,
      1,
      `assign-${suffix}`,
    );
    expect(assigned.run).toMatchObject({ status: 'ASSIGNED', version: 2 });
    expect(
      (
        await service.reserveAssignment(
          controlCapability,
          { workspaceId, principalId: controlId },
          assignment,
          1,
          `assign-${suffix}`,
        )
      ).replayed,
    ).toBe(true);
    await expect(
      service.reserveAssignment(
        controlCapability,
        { workspaceId, principalId: controlId },
        { ...assignment, agentId: `forged-${suffix}` },
        1,
        `assign-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(AcpTaskRunConflictError);
    const started = await service.startRun(
      controlCapability,
      { workspaceId, principalId: controlId },
      run.id,
      2,
      `start-${suffix}`,
    );
    expect(started.run).toMatchObject({ status: 'RUNNING', version: 3 });
    await expect(
      service.completeRun(
        controlCapability,
        { workspaceId, principalId: controlId },
        run.id,
        3,
        `complete-missing-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(AcpTaskRunDeniedError);

    for (const [index, criterion] of [
      ...routine.acceptanceCriteria,
      ...routine.verificationCriteria,
    ].entries()) {
      await service.recordArtifact(
        controlCapability,
        { workspaceId, principalId: controlId },
        {
          evidenceId: `artifact-evidence-${index}-${suffix}`,
          evidenceHash: 'd'.repeat(64),
          taskId: routine.id,
          runId: run.id,
          artifactId: `artifact-${index}-${suffix}`,
          criterion,
          kind: 'QA_REPORT',
          uriReference: `artifact/${index}/${suffix}`,
          contentHash: `${index + 1}`.repeat(64),
        },
        `artifact-${index}-${suffix}`,
      );
    }
    const completed = await service.completeRun(
      controlCapability,
      { workspaceId, principalId: controlId },
      run.id,
      3,
      `complete-${suffix}`,
    );
    expect(completed.run.status).toBe('COMPLETED');
    const dependent = await prisma.acpTask.findFirstOrThrow({
      where: { workspaceId, id: { startsWith: 'dependent-' } },
    });
    expect(dependent.status).toBe('READY');
  });

  it('permits only one concurrent assignment and enforces the immutable retry budget', async () => {
    const race = await prisma.acpTask.findFirstOrThrow({
      where: { workspaceId, id: { startsWith: 'race-' } },
      include: { runs: true },
    });
    const attempts = await Promise.allSettled([
      service.reserveAssignment(
        controlCapability,
        { workspaceId, principalId: controlId },
        {
          evidenceId: `race-a-${suffix}`,
          evidenceHash: 'c'.repeat(64),
          taskId: race.id,
          runId: race.runs[0]!.id,
          agentId: `agent-a-${suffix}`,
          runtimeId: `runtime-${suffix}`,
          connectionId: `connection-${suffix}`,
        },
        1,
        `race-a-${suffix}`,
      ),
      service.reserveAssignment(
        controlCapability,
        { workspaceId, principalId: controlId },
        {
          evidenceId: `race-b-${suffix}`,
          evidenceHash: 'c'.repeat(64),
          taskId: race.id,
          runId: race.runs[0]!.id,
          agentId: `agent-b-${suffix}`,
          runtimeId: `runtime-${suffix}`,
          connectionId: `connection-${suffix}`,
        },
        1,
        `race-b-${suffix}`,
      ),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const dependent = await prisma.acpTask.findFirstOrThrow({
      where: { workspaceId, id: { startsWith: 'dependent-' } },
      include: { runs: true },
    });
    const firstRun = dependent.runs[0]!;
    const assignment = {
      evidenceId: `retry-assign-1-${suffix}`,
      evidenceHash: 'c'.repeat(64),
      taskId: dependent.id,
      runId: firstRun.id,
      agentId: `retry-agent-${suffix}`,
      runtimeId: `runtime-${suffix}`,
      connectionId: `connection-${suffix}`,
    };
    await service.reserveAssignment(
      controlCapability,
      { workspaceId, principalId: controlId },
      assignment,
      1,
      `retry-assign-1-${suffix}`,
    );
    await service.startRun(
      controlCapability,
      { workspaceId, principalId: controlId },
      firstRun.id,
      2,
      `retry-start-1-${suffix}`,
    );
    const failed = await service.failRun(
      controlCapability,
      { workspaceId, principalId: controlId },
      firstRun.id,
      3,
      'TRANSIENT',
      `retry-fail-1-${suffix}`,
    );
    expect(failed.retryRunId).toBeTruthy();
    await expect(
      service.failRun(
        controlCapability,
        { workspaceId, principalId: controlId },
        firstRun.id,
        3,
        'POLICY_DENIED',
        `retry-fail-1-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(AcpTaskRunConflictError);
    const retryRun = await prisma.acpRun.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId, id: failed.retryRunId! } },
    });
    await service.reserveAssignment(
      controlCapability,
      { workspaceId, principalId: controlId },
      { ...assignment, evidenceId: `retry-assign-2-${suffix}`, runId: retryRun.id },
      1,
      `retry-assign-2-${suffix}`,
    );
    await service.startRun(
      controlCapability,
      { workspaceId, principalId: controlId },
      retryRun.id,
      2,
      `retry-start-2-${suffix}`,
    );
    const exhausted = await service.failRun(
      controlCapability,
      { workspaceId, principalId: controlId },
      retryRun.id,
      3,
      'TRANSIENT',
      `retry-fail-2-${suffix}`,
    );
    expect(exhausted.retryRunId).toBeUndefined();
    expect(
      (
        await prisma.acpTask.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: dependent.id } },
        })
      ).status,
    ).toBe('FAILED');
  });

  it('rolls back durable mutations when audit persistence fails', async () => {
    const rollbackPlan = {
      ...plan(),
      idempotencyKey: `rollback-${suffix}`,
      objective: { ...plan().objective, id: `rollback-objective-${suffix}` },
    };
    const failingAudit = {
      async recordOperationalEvent() {
        throw new Error('audit unavailable');
      },
    } as AuditService;
    const failingService = new AcpTaskRunService(
      failingAudit,
      assignmentVerifier,
      artifactVerifier,
    );
    await expect(
      failingService.createPlan(
        plannerCapability,
        { workspaceId, principalId: plannerId },
        rollbackPlan,
      ),
    ).rejects.toThrow('audit unavailable');
    expect(
      await prisma.acpObjective.findUnique({
        where: { workspaceId_id: { workspaceId, id: rollbackPlan.objective.id } },
      }),
    ).toBeNull();
  });

  it('enforces database immutability and workspace-scoped foreign keys', async () => {
    const routine = await prisma.acpTask.findFirstOrThrow({
      where: { workspaceId, id: { startsWith: 'first-' } },
    });
    await expect(
      prisma.acpTask.update({
        where: { workspaceId_id: { workspaceId, id: routine.id } },
        data: { policyHash: 'f'.repeat(64), version: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.acpTaskDependency.create({
        data: { workspaceId: secondWorkspaceId, taskId: routine.id, dependsOnTaskId: routine.id },
      }),
    ).rejects.toThrow();
  });

  it('supports tenant erasure without database triggers preserving ACP graph rows', async () => {
    const eraseWorkspace = await prisma.workspace.create({
      data: { name: 'ACP erasure', slug: `acp-erase-${suffix}` },
    });
    const erasePlanner = OperationalEventCapability.issue('AI_COO', [
      {
        workspaceId: eraseWorkspace.id,
        principalId: plannerId,
        actorKind: 'AGENT',
        authorityLevel: 3,
      },
    ]);
    const erasePlan = {
      ...plan(),
      workspaceId: eraseWorkspace.id,
      idempotencyKey: `erase-${suffix}`,
    };
    await service.createPlan(
      erasePlanner,
      { workspaceId: eraseWorkspace.id, principalId: plannerId },
      erasePlan,
    );
    expect(
      await prisma.acpTask.count({ where: { workspaceId: eraseWorkspace.id } }),
    ).toBeGreaterThan(0);
    await prisma.workspace.delete({ where: { id: eraseWorkspace.id } });
    expect(await prisma.acpObjective.count({ where: { workspaceId: eraseWorkspace.id } })).toBe(0);
    expect(await prisma.acpTask.count({ where: { workspaceId: eraseWorkspace.id } })).toBe(0);
    expect(await prisma.acpRun.count({ where: { workspaceId: eraseWorkspace.id } })).toBe(0);
    const retainedAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { workspaceReference: eraseWorkspace.id },
    });
    expect(retainedAudit.workspaceId).toBeNull();
  });
});
