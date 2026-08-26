import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  OperationalEventCapability,
  type AssignmentEvidenceVerifier,
  type DurableArtifactEvidenceVerifier,
  type DurableObjectivePlanInput,
} from '@ventureos/agent-control-plane';
import { hashSessionToken } from '@ventureos/auth';
import { loadEnv } from '@ventureos/config';
import { prisma } from '@ventureos/database';
import { AppModule } from '../src/app.module';
import { SafeExceptionFilter } from '../src/common/filters/safe-exception.filter';
import { AcpTaskRunService } from '../src/modules/agent-control-plane/acp-task-run.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { WorkflowCentreService } from '../src/modules/workflow-centre/workflow-centre.service';

describe('read-only Workflow Centre snapshot (PostgreSQL integration)', () => {
  const suffix = randomUUID();
  const secretSentinel = `password=hunter2-${suffix}`;
  const env = loadEnv();
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  const roleIds: string[] = [];
  let app: INestApplication;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let allowedCookie: string;
  let deniedCookie: string;
  let nullWorkspaceWorkflowId: string;
  let primaryWorkflowId: string;
  let objectiveId: string;
  let taskId: string;
  let primaryDependencyTaskId: string;
  let runId: string;
  let otherObjectiveId: string;
  let otherTaskId: string;
  let otherRunId: string;
  let otherDependencyTaskId: string;
  let expiredApprovalId: string;
  let capturedHttpException: unknown;

  const assignmentVerifier: AssignmentEvidenceVerifier = {
    async verify() {
      return false;
    },
  };
  const artifactVerifier: DurableArtifactEvidenceVerifier = {
    async verify() {
      return false;
    },
  };
  const taskRuns = new AcpTaskRunService(new AuditService(), assignmentVerifier, artifactVerifier);

  function plan(targetWorkspaceId: string, marker: string): DurableObjectivePlanInput {
    const projectId = `workflow-project-${marker}-${suffix}`;
    const prerequisiteId = `workflow-task-prerequisite-${marker}-${suffix}`;
    return {
      workspaceId: targetWorkspaceId,
      idempotencyKey: `workflow-plan-${marker}-${suffix}`,
      policyVersion: 'workflow-centre-v1',
      objective: {
        id: `workflow-objective-${marker}-${suffix}`,
        title: `Workflow objective ${marker}`,
        desiredOutcome: `Observe workspace ${marker} without mutation`,
        maximumAuthority: 4,
        costLimit: { currency: 'EUR', maximumMinorUnits: 100, maximumComputeUnits: 100 },
        acceptanceCriteria: ['Read model remains bounded'],
        verificationCriteria: ['Tenant isolation is verified'],
        stopConditions: ['Stop on policy denial'],
      },
      projects: [{ id: projectId, title: `Workflow project ${marker}` }],
      tasks: [
        {
          id: prerequisiteId,
          projectId,
          title: `Prepare workflow evidence ${marker}`,
          kind: 'quality.verify',
          dependencyIds: [],
          requiredAuthority: 3,
          costLimit: { currency: 'EUR', maximumMinorUnits: 40, maximumComputeUnits: 40 },
          estimatedDurationMs: 500,
          acceptanceCriteria: ['Preparation remains workspace scoped'],
          verificationCriteria: ['Dependency remains explicit'],
          stopConditions: ['Policy denial'],
          retryPolicy: {
            maximumAttempts: 1,
            retryableFailureCodes: ['TRANSIENT'],
            stopAfterFailureCodes: ['POLICY_DENIED'],
          },
          agentPolicy: { templateId: 'read-only-viewer' },
          routingPolicy: { capabilityId: 'quality.verify' },
        },
        {
          id: `workflow-task-${marker}-${suffix}`,
          projectId,
          title:
            marker === 'primary'
              ? 'Review <script>globalThis.compromised=true</script>'
              : `Workflow task ${marker}`,
          kind: 'quality.verify',
          dependencyIds: [prerequisiteId],
          requiredAuthority: 4,
          costLimit: { currency: 'EUR', maximumMinorUnits: 60, maximumComputeUnits: 60 },
          estimatedDurationMs: 1_000,
          acceptanceCriteria: ['Bounded response'],
          verificationCriteria: ['No authority is exposed'],
          stopConditions: ['Policy denial'],
          retryPolicy: {
            maximumAttempts: 1,
            retryableFailureCodes: ['TRANSIENT'],
            stopAfterFailureCodes: ['POLICY_DENIED'],
          },
          agentPolicy: { templateId: 'read-only-viewer' },
          routingPolicy: { capabilityId: 'quality.verify' },
          approval: {
            actionCode: 'RELEASE.PREPARE',
            exactTarget: `source/${marker}/${suffix}`,
            artifactVersionId: `artifact-${marker}-${suffix}`,
            evidenceHash: 'a'.repeat(64),
          },
        },
      ],
    };
  }

  async function sessionCookie(userId: string, activeWorkspaceId: string): Promise<string> {
    const token = randomUUID();
    await prisma.session.create({
      data: {
        userId,
        activeWorkspaceId,
        tokenDigest: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
    return `${env.AUTH_COOKIE_NAME}=${token}`;
  }

  beforeAll(async () => {
    const originalCatch = SafeExceptionFilter.prototype.catch;
    vi.spyOn(SafeExceptionFilter.prototype, 'catch').mockImplementation(function (exception, host) {
      capturedHttpException = exception;
      return originalCatch.call(this, exception, host);
    });
    app = await NestFactory.create(AppModule);
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();

    const [workspace, otherWorkspace] = await Promise.all([
      prisma.workspace.create({
        data: { name: 'Workflow Centre primary', slug: `workflow-centre-${suffix}` },
      }),
      prisma.workspace.create({
        data: { name: 'Workflow Centre isolated', slug: `workflow-centre-other-${suffix}` },
      }),
    ]);
    workspaceId = workspace.id;
    otherWorkspaceId = otherWorkspace.id;
    workspaceIds.push(workspaceId, otherWorkspaceId);

    const workflowPermission = await prisma.permission.upsert({
      where: { key: 'workflow:view' },
      update: {},
      create: { key: 'workflow:view', description: 'View workflow runs' },
    });
    const allowedRole = await prisma.role.create({
      data: {
        key: `WORKFLOW_VIEW_${suffix}`,
        name: 'Workflow Centre viewer',
        rolePermissions: { create: { permissionId: workflowPermission.id } },
      },
    });
    const deniedRole = await prisma.role.create({
      data: { key: `WORKFLOW_DENIED_${suffix}`, name: 'Workflow Centre denied' },
    });
    roleIds.push(allowedRole.id, deniedRole.id);
    const [allowedUser, deniedUser] = await Promise.all([
      prisma.user.create({
        data: { email: `workflow-view-${suffix}@example.test`, displayName: 'Workflow viewer' },
      }),
      prisma.user.create({
        data: { email: `workflow-denied-${suffix}@example.test`, displayName: 'Denied viewer' },
      }),
    ]);
    userIds.push(allowedUser.id, deniedUser.id);
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: allowedUser.id, roleId: allowedRole.id },
        { workspaceId, userId: deniedUser.id, roleId: deniedRole.id },
      ],
    });
    allowedCookie = await sessionCookie(allowedUser.id, workspaceId);
    deniedCookie = await sessionCookie(deniedUser.id, workspaceId);

    const planner = (targetWorkspaceId: string, marker: string) =>
      OperationalEventCapability.issue('AI_COO', [
        {
          workspaceId: targetWorkspaceId,
          principalId: `workflow-coo-${marker}-${suffix}`,
          actorKind: 'AGENT',
          authorityLevel: 3,
        },
      ]);
    const primaryPlan = plan(workspaceId, 'primary');
    const otherPlan = plan(otherWorkspaceId, 'other');
    await taskRuns.createPlan(
      planner(workspaceId, 'primary'),
      { workspaceId, principalId: `workflow-coo-primary-${suffix}` },
      primaryPlan,
    );
    await taskRuns.createPlan(
      planner(otherWorkspaceId, 'other'),
      { workspaceId: otherWorkspaceId, principalId: `workflow-coo-other-${suffix}` },
      otherPlan,
    );
    objectiveId = primaryPlan.objective.id;
    taskId = primaryPlan.tasks[1]!.id;
    primaryDependencyTaskId = primaryPlan.tasks[0]!.id;
    runId = (await prisma.acpRun.findFirstOrThrow({ where: { workspaceId, taskId } })).id;
    otherObjectiveId = otherPlan.objective.id;
    otherTaskId = otherPlan.tasks[1]!.id;
    otherDependencyTaskId = otherPlan.tasks[0]!.id;
    otherRunId = (
      await prisma.acpRun.findFirstOrThrow({
        where: { workspaceId: otherWorkspaceId, taskId: otherTaskId },
      })
    ).id;

    primaryWorkflowId = randomUUID();
    await prisma.workflowRun.create({
      data: {
        id: primaryWorkflowId,
        workspaceId,
        workflowType: 'boardApprovalWorkflow',
        temporalWorkflowId: `workflow-primary-${suffix}`,
        status: 'RUNNING',
        input: { private: secretSentinel },
        output: { transcript: secretSentinel },
        startedAt: new Date('2099-01-01T00:00:00.000Z'),
        steps: {
          create: Array.from({ length: 21 }, (_, index) => ({
            name:
              index === 0
                ? '<img src=x onerror=globalThis.compromised=true>'
                : index === 1
                  ? 'pass\u0001word=hunter2'
                  : index === 2
                    ? 'api\u200Bkey=secret'
                    : index === 3
                      ? 'chain\u200Dof\u200Dthought'
                      : `step-${index}`,
            status: index === 0 ? 'RUNNING' : 'PENDING',
            attempt: 1,
            input: { authorization: secretSentinel },
            output: { prompt: secretSentinel },
            error: secretSentinel,
            createdAt: new Date(2_000 + index),
          })),
        },
      },
    });
    await prisma.workflowRun.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        workspaceId,
        workflowType: 'productListingWorkflow',
        temporalWorkflowId: `workflow-filler-${index}-${suffix}`,
        status: index % 2 === 0 ? 'COMPLETED' : 'FAILED',
        startedAt: new Date(`2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`),
      })),
    });
    await prisma.workflowRun.create({
      data: {
        workspaceId: otherWorkspaceId,
        workflowType: 'otherWorkspaceWorkflow',
        temporalWorkflowId: `workflow-other-${suffix}`,
      },
    });
    const nullWorkspaceWorkflow = await prisma.workflowRun.create({
      data: {
        workspaceId: null,
        workflowType: 'erasedWorkspaceWorkflow',
        temporalWorkflowId: `workflow-null-${suffix}`,
      },
    });
    nullWorkspaceWorkflowId = nullWorkspaceWorkflow.id;

    await prisma.acpRuntime.create({
      data: {
        id: `runtime-primary-${suffix}`,
        workspaceId,
        adapterKind: 'PROTOCOL_NEUTRAL',
        principalReference: `credential-${secretSentinel}`,
        secretReference: `api-key-${secretSentinel}`,
        secretDigest: 'b'.repeat(64),
        capabilityPolicyHash: 'c'.repeat(64),
        provisioningIdempotencyKey: `runtime-primary-${suffix}`,
        connections: {
          create: {
            id: `connection-primary-${suffix}`,
            environment: 'TEST_ONLY',
            status: 'PARTIAL',
            lastHeartbeatHealth: 'HEALTHY',
            lastHeartbeatAt: new Date('2026-08-26T00:00:00.000Z'),
            lastHeartbeatSequence: 1,
          },
        },
      },
    });
    await prisma.acpRuntime.create({
      data: {
        id: `runtime-other-${suffix}`,
        workspaceId: otherWorkspaceId,
        adapterKind: 'PROTOCOL_NEUTRAL',
        principalReference: `principal-other-${suffix}`,
        secretReference: `secret-other-${suffix}`,
        secretDigest: 'd'.repeat(64),
        capabilityPolicyHash: 'e'.repeat(64),
        provisioningIdempotencyKey: `runtime-other-${suffix}`,
        connections: {
          create: {
            id: `connection-other-${suffix}`,
            environment: 'TEST_ONLY',
            status: 'NOT_CONFIGURED',
          },
        },
      },
    });

    const approval = (
      targetWorkspaceId: string,
      targetObjectiveId: string,
      targetTaskId: string,
      targetRunId: string,
      marker: string,
    ) => ({
      id: randomUUID(),
      workspaceId: targetWorkspaceId,
      objectiveId: targetObjectiveId,
      taskId: targetTaskId,
      runId: targetRunId,
      actionCode: 'RELEASE.PREPARE',
      exactTarget: marker === 'primary' ? secretSentinel : `target-${marker}-${suffix}`,
      artifactVersionId: `artifact-${marker}-${suffix}`,
      evidenceHash: '1'.repeat(64),
      policyVersion: 'workflow-centre-v1',
      policyHash: '2'.repeat(64),
      bindingHash: '3'.repeat(64),
      requesterReference: marker === 'primary' ? secretSentinel : `requester-${marker}-${suffix}`,
      requesterActorKind: 'AGENT',
      requesterAuthorityLevel: 3,
      requiredAuthorityLevel: 4,
      idempotencyKey: `approval-${marker}-${suffix}`,
      state: 'PENDING',
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
    const expired = {
      ...approval(workspaceId, objectiveId, taskId, runId, 'expired'),
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      expiresAt: new Date('2020-01-02T00:00:00.000Z'),
    };
    expiredApprovalId = expired.id;
    await prisma.acpApprovalRequest.createMany({
      data: [
        approval(workspaceId, objectiveId, taskId, runId, 'primary'),
        expired,
        approval(otherWorkspaceId, otherObjectiveId, otherTaskId, otherRunId, 'other'),
      ],
    });
  });

  afterAll(async () => {
    await prisma.workflowStep.deleteMany({
      where: { workflowRun: { workspaceId: { in: workspaceIds } } },
    });
    await prisma.workflowRun.deleteMany({
      where: { OR: [{ workspaceId: { in: workspaceIds } }, { id: nullWorkspaceWorkflowId }] },
    });
    await prisma.auditEvent.deleteMany({ where: { workspaceReference: { in: workspaceIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it('requires authentication and workflow:view permission', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/api/workflow-centre')).status).toBe(401);
    expect(
      (await request(server).get('/api/workflow-centre').set('Cookie', deniedCookie)).status,
    ).toBe(403);
  });

  it('durably rejects non-Level-4 approval rows before they can pollute the summary', async () => {
    const existing = await prisma.acpApprovalRequest.findFirstOrThrow({
      where: { workspaceId, taskId, state: 'PENDING', expiresAt: { gt: new Date() } },
    });
    await expect(
      prisma.acpApprovalRequest.create({
        data: {
          id: randomUUID(),
          workspaceId,
          objectiveId,
          taskId,
          runId,
          actionCode: existing.actionCode,
          exactTarget: `l3-target-${suffix}`,
          artifactVersionId: `l3-artifact-${suffix}`,
          evidenceHash: existing.evidenceHash,
          policyVersion: existing.policyVersion,
          policyHash: existing.policyHash,
          bindingHash: existing.bindingHash,
          requesterReference: `l3-requester-${suffix}`,
          requesterActorKind: 'AGENT',
          requesterAuthorityLevel: 3,
          requiredAuthorityLevel: 3,
          idempotencyKey: `l3-approval-${suffix}`,
          state: 'PENDING',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });

  it('returns one bounded deterministic workspace snapshot without authority or sensitive data', async () => {
    const workflowCentre = app.get(WorkflowCentreService);
    const directSnapshot = await workflowCentre.snapshot(workspaceId);
    expect(() => JSON.stringify(directSnapshot)).not.toThrow();
    capturedHttpException = undefined;

    const response = await request(app.getHttpServer())
      .get('/api/workflow-centre')
      .query({ workspaceId: otherWorkspaceId })
      .set('Cookie', allowedCookie);
    if (response.status !== 200 && capturedHttpException instanceof Error) {
      const safeFrames = capturedHttpException.stack
        ?.split('\n')
        .filter((line) => line.includes('/apps/api/'))
        .slice(0, 3)
        .join('\n');
      throw new Error(
        `Workflow Centre HTTP boundary raised ${capturedHttpException.name}${safeFrames ? `\n${safeFrames}` : ''}`,
      );
    }
    expect(response.status).toBe(200);
    expect(response.body.access).toEqual({ permission: 'workflow:view', mode: 'READ_ONLY' });
    expect(response.body.connectivity).toEqual({
      status: 'NOT_CONFIGURED',
      targets: ['CODEX', 'HERMES', 'PI'],
      reasonCode: 'NO_AUTHENTICATED_DIRECT_ADAPTER',
    });
    expect(response.body.summary).toMatchObject({
      workflowRuns: 51,
      objectives: 1,
      tasks: 2,
      runs: 2,
      runtimes: 1,
      connections: 1,
      pendingLevel4Approvals: 1,
    });
    expect(response.body.bounds.workflowRuns).toEqual({ total: 51, returned: 50, truncated: true });
    expect(response.body.workflows).toHaveLength(50);
    expect(response.body.workflows[0].id).toBe(primaryWorkflowId);
    expect(response.body.workflows[0].steps).toHaveLength(20);
    expect(response.body.workflows[0].stepsTruncated).toBe(true);
    expect(response.body.workflows[0].steps.map((step: { name: string }) => step.name)).toEqual([
      '<img src=x onerror=globalThis.compromised=true>',
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      ...Array.from({ length: 16 }, (_, index) => `step-${index + 4}`),
    ]);
    expect(response.body.objectives.map((item: { id: string }) => item.id)).toEqual([objectiveId]);
    expect(response.body.tasks.map((item: { id: string }) => item.id)).toContain(taskId);
    expect(response.body.runs.map((item: { id: string }) => item.id)).toContain(runId);
    expect(response.body.dependencies).toEqual([
      { taskId, dependsOnTaskId: primaryDependencyTaskId },
    ]);
    expect(response.body.runtimes.map((item: { id: string }) => item.id)).toEqual([
      `runtime-primary-${suffix}`,
    ]);
    expect(response.body.connections.map((item: { id: string }) => item.id)).toEqual([
      `connection-primary-${suffix}`,
    ]);
    expect(response.body.pendingLevel4Approvals).toHaveLength(1);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(secretSentinel);
    expect(serialized).not.toContain(otherObjectiveId);
    expect(serialized).not.toContain(otherTaskId);
    expect(serialized).not.toContain(otherRunId);
    expect(serialized).not.toContain(otherDependencyTaskId);
    expect(serialized).not.toContain(expiredApprovalId);
    expect(serialized).not.toContain('otherWorkspaceWorkflow');
    expect(serialized).not.toContain(nullWorkspaceWorkflowId);
    expect(response.body.connectivity.status).toBe('NOT_CONFIGURED');
    for (const forbiddenKey of [
      'input',
      'output',
      'error',
      'desiredOutcome',
      'acceptanceCriteria',
      'verificationCriteria',
      'stopConditions',
      'policyHash',
      'evidenceHash',
      'exactTarget',
      'secretReference',
      'secretDigest',
      'principalReference',
      'artifactVersionId',
      'requesterReference',
      'requesterActorKind',
      'requiredAuthorityLevel',
      'approverReference',
      'costMinorUnits',
      'computeUnits',
      'approve',
      'reject',
      'hold',
      'permit',
    ]) {
      expect(serialized).not.toContain(`"${forbiddenKey}"`);
    }

    const containsBigInt = (value: unknown): boolean => {
      if (typeof value === 'bigint') return true;
      if (Array.isArray(value)) return value.some(containsBigInt);
      if (value && typeof value === 'object') return Object.values(value).some(containsBigInt);
      return false;
    };
    expect(containsBigInt(response.body)).toBe(false);
  });
});
