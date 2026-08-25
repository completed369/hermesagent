import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  ASSIGNMENT_EVIDENCE_VERIFIER,
  DURABLE_ARTIFACT_EVIDENCE_VERIFIER,
  buildDurableTaskPolicySnapshot,
  hashDurablePlanPolicy,
  hashDurablePolicy,
  validateAcpApprovalReference,
  validateDurableObjectivePlan,
  validateTrustedArtifactEvidence,
  validateTrustedAssignmentEvidence,
  type AcpApprovalBinding,
  type AssignmentEvidenceVerifier,
  type DurableArtifactEvidenceVerifier,
  type DurableObjectivePlanInput,
  type OperationalEventCapability,
  type TrustedArtifactEvidence,
  type TrustedAssignmentEvidence,
  type WorkspaceContext,
} from '@ventureos/agent-control-plane';
import { Prisma, prisma } from '@ventureos/database';
import type { AuditService } from '../audit/audit.service';
import { AUDIT_SERVICE } from '../audit/audit.tokens';

export class AcpTaskRunError extends Error {}
export class AcpTaskRunConflictError extends AcpTaskRunError {}
export class AcpTaskRunDeniedError extends AcpTaskRunError {}
export class AcpTaskRunNotFoundError extends AcpTaskRunError {}

function assertWorkspace(context: WorkspaceContext, workspaceId: string): void {
  if (context.workspaceId !== workspaceId) {
    throw new AcpTaskRunDeniedError('Cross-workspace ACP operation denied');
  }
}

function assertTrustedPlanner(
  capability: OperationalEventCapability,
  context: WorkspaceContext,
): 'HUMAN' | 'AGENT' {
  capability.assertSource('AI_COO');
  const actorKind = capability.actorKindFor(context);
  if (
    (actorKind !== 'HUMAN' && actorKind !== 'AGENT') ||
    capability.authorityLevelFor(context) < 1
  ) {
    throw new AcpTaskRunDeniedError('A bound Level-1 human or AI COO principal is required');
  }
  return actorKind;
}

function assertTrustedControlPlane(
  capability: OperationalEventCapability,
  context: WorkspaceContext,
): 'HUMAN' | 'AGENT' | 'SYSTEM' {
  capability.assertSource('CONTROL_PLANE');
  const actorKind = capability.actorKindFor(context);
  if (actorKind === 'RUNTIME') {
    throw new AcpTaskRunDeniedError('Runtime principals cannot mutate durable task/run state');
  }
  return actorKind;
}

@Injectable()
export class AcpTaskRunService {
  constructor(
    @Inject(AUDIT_SERVICE)
    private readonly auditService: AuditService,
    @Inject(ASSIGNMENT_EVIDENCE_VERIFIER)
    private readonly assignmentVerifier: AssignmentEvidenceVerifier,
    @Inject(DURABLE_ARTIFACT_EVIDENCE_VERIFIER)
    private readonly artifactVerifier: DurableArtifactEvidenceVerifier,
  ) {}

  async createPlan(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: DurableObjectivePlanInput,
  ) {
    validateDurableObjectivePlan(input);
    assertWorkspace(context, input.workspaceId);
    const actorKind = assertTrustedPlanner(capability, context);
    const snapshots = input.tasks.map((task) => buildDurableTaskPolicySnapshot(input, task));
    const taskHashes = snapshots.map(hashDurablePolicy);
    const objectivePolicyHash = hashDurablePlanPolicy(input, taskHashes);

    const existing = await prisma.acpObjective.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: { projects: true, tasks: { include: { dependencies: true, runs: true } } },
    });
    if (existing) {
      if (existing.id !== input.objective.id || existing.policyHash !== objectivePolicyHash) {
        throw new AcpTaskRunConflictError('Plan idempotency key was reused with different work');
      }
      return { objective: existing, replayed: true };
    }

    try {
      const objective = await prisma.$transaction(
        async (tx) => {
          const created = await tx.acpObjective.create({
            data: {
              id: input.objective.id,
              workspaceId: input.workspaceId,
              title: input.objective.title,
              desiredOutcome: input.objective.desiredOutcome,
              maximumAuthority: input.objective.maximumAuthority,
              currency: input.objective.costLimit.currency,
              maximumCostMinorUnits: BigInt(input.objective.costLimit.maximumMinorUnits),
              maximumComputeUnits: BigInt(input.objective.costLimit.maximumComputeUnits),
              acceptanceCriteria: [...input.objective.acceptanceCriteria],
              verificationCriteria: [...input.objective.verificationCriteria],
              stopConditions: [...input.objective.stopConditions],
              policyVersion: input.policyVersion,
              policyHash: objectivePolicyHash,
              idempotencyKey: input.idempotencyKey,
            },
          });
          await this.auditService.recordOperationalEvent(
            capability,
            context,
            {
              id: randomUUID(),
              workspaceId: input.workspaceId,
              type: 'objective.created',
              source: 'AI_COO',
              actorKind,
              actorId: context.principalId,
              subjectType: 'AcpObjective',
              subjectId: created.id,
              occurredAt: new Date().toISOString(),
              idempotencyKey: `${input.idempotencyKey}:objective`,
              correlationId: created.id,
              facts: { titleLength: input.objective.title.length },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );

          for (const project of input.projects) {
            await tx.acpProject.create({
              data: {
                id: project.id,
                workspaceId: input.workspaceId,
                objectiveId: created.id,
                title: project.title,
              },
            });
            await this.auditService.recordOperationalEvent(
              capability,
              context,
              {
                id: randomUUID(),
                workspaceId: input.workspaceId,
                type: 'project.created',
                source: 'AI_COO',
                actorKind,
                actorId: context.principalId,
                subjectType: 'AcpProject',
                subjectId: project.id,
                occurredAt: new Date().toISOString(),
                idempotencyKey: `${input.idempotencyKey}:project:${project.id}`,
                correlationId: created.id,
                facts: { titleLength: project.title.length },
              },
              actorKind === 'HUMAN' ? context.principalId : undefined,
              tx,
            );
          }

          for (let index = 0; index < input.tasks.length; index += 1) {
            const task = input.tasks[index]!;
            const snapshot = snapshots[index]!;
            const taskPolicyHash = taskHashes[index]!;
            const taskStatus =
              task.dependencyIds.length > 0
                ? 'BLOCKED'
                : task.requiredAuthority === 4
                  ? 'AWAITING_APPROVAL'
                  : 'READY';
            const runStatus = task.requiredAuthority === 4 ? 'AWAITING_APPROVAL' : 'PREPARED';
            const runId = randomUUID();
            await tx.acpTask.create({
              data: {
                id: task.id,
                workspaceId: input.workspaceId,
                objectiveId: created.id,
                projectId: task.projectId,
                title: task.title,
                kind: task.kind,
                status: taskStatus,
                requiredAuthority: task.requiredAuthority,
                currency: task.costLimit.currency,
                maximumCostMinorUnits: BigInt(task.costLimit.maximumMinorUnits),
                maximumComputeUnits: BigInt(task.costLimit.maximumComputeUnits),
                estimatedDurationMs: BigInt(task.estimatedDurationMs),
                acceptanceCriteria: [...task.acceptanceCriteria],
                verificationCriteria: [...task.verificationCriteria],
                stopConditions: [...task.stopConditions],
                maximumAttempts: task.retryPolicy.maximumAttempts,
                retryableFailureCodes: [...task.retryPolicy.retryableFailureCodes],
                stopAfterFailureCodes: [...task.retryPolicy.stopAfterFailureCodes],
                agentPolicy: snapshot.agentPolicy as Prisma.InputJsonValue,
                routingPolicy: snapshot.routingPolicy as Prisma.InputJsonValue,
                exactTarget: task.approval?.exactTarget,
                approvalActionCode: task.approval?.actionCode,
                approvalArtifactVersion: task.approval?.artifactVersionId,
                approvalEvidenceHash: task.approval?.evidenceHash,
                policyVersion: input.policyVersion,
                policyHash: taskPolicyHash,
              },
            });
            await tx.acpRun.create({
              data: {
                id: runId,
                workspaceId: input.workspaceId,
                objectiveId: created.id,
                taskId: task.id,
                status: runStatus,
                requiredAuthority: task.requiredAuthority,
                policyVersion: input.policyVersion,
                policyHash: taskPolicyHash,
                actionCode: task.approval?.actionCode,
                exactTarget: task.approval?.exactTarget,
                artifactVersionId: task.approval?.artifactVersionId,
                evidenceHash: task.approval?.evidenceHash,
                attempt: 1,
                idempotencyKey: `${input.idempotencyKey}:run:${task.id}:1`,
              },
            });
            await this.auditService.recordOperationalEvent(
              capability,
              context,
              {
                id: randomUUID(),
                workspaceId: input.workspaceId,
                type: 'task.created',
                source: 'AI_COO',
                actorKind,
                actorId: context.principalId,
                subjectType: 'AcpTask',
                subjectId: task.id,
                occurredAt: new Date().toISOString(),
                idempotencyKey: `${input.idempotencyKey}:task:${task.id}`,
                correlationId: created.id,
                facts: {
                  titleLength: task.title.length,
                  kind: task.kind,
                  status: taskStatus,
                  requiredAuthorityLevel: task.requiredAuthority,
                },
              },
              actorKind === 'HUMAN' ? context.principalId : undefined,
              tx,
            );
            await this.auditService.recordOperationalEvent(
              capability,
              context,
              {
                id: randomUUID(),
                workspaceId: input.workspaceId,
                type: 'run.created',
                source: 'AI_COO',
                actorKind,
                actorId: context.principalId,
                subjectType: 'AcpRun',
                subjectId: runId,
                occurredAt: new Date().toISOString(),
                idempotencyKey: `${input.idempotencyKey}:run-event:${task.id}`,
                correlationId: created.id,
                facts: { taskId: task.id, status: runStatus },
              },
              actorKind === 'HUMAN' ? context.principalId : undefined,
              tx,
            );
          }
          await tx.acpTaskDependency.createMany({
            data: input.tasks.flatMap((task) =>
              task.dependencyIds.map((dependsOnTaskId) => ({
                workspaceId: input.workspaceId,
                taskId: task.id,
                dependsOnTaskId,
              })),
            ),
          });
          return tx.acpObjective.findUniqueOrThrow({
            where: { workspaceId_id: { workspaceId: input.workspaceId, id: created.id } },
            include: { projects: true, tasks: { include: { dependencies: true, runs: true } } },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { objective, replayed: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AcpTaskRunConflictError(
          'Plan IDs or idempotency keys collide with existing work',
        );
      }
      throw error;
    }
  }

  async getPreparedApprovalBinding(
    context: WorkspaceContext,
    runId: string,
    client: Pick<Prisma.TransactionClient, 'acpRun' | '$queryRaw'> = prisma,
    lockForApproval = false,
  ): Promise<AcpApprovalBinding> {
    validateAcpApprovalReference(runId, 'runId');
    if (lockForApproval) {
      await client.$queryRaw(
        Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${runId} FOR SHARE`,
      );
    }
    const run = await client.acpRun.findUnique({
      where: { workspaceId_id: { workspaceId: context.workspaceId, id: runId } },
      include: { task: true },
    });
    if (!run) throw new AcpTaskRunNotFoundError('Prepared ACP run not found');
    if (
      run.status !== 'AWAITING_APPROVAL' ||
      run.requiredAuthority !== 4 ||
      run.task.status !== 'AWAITING_APPROVAL'
    ) {
      throw new AcpTaskRunDeniedError('Run is not an approval-ready, unassigned Level-4 run');
    }
    if (
      run.assignedAgentId ||
      run.assignedRuntimeId ||
      run.assignedConnectionId ||
      !run.actionCode ||
      !run.exactTarget ||
      !run.artifactVersionId ||
      !run.evidenceHash
    ) {
      throw new AcpTaskRunDeniedError(
        'Approval-ready run binding is incomplete or already assigned',
      );
    }
    return {
      workspaceId: run.workspaceId,
      objectiveId: run.objectiveId,
      taskId: run.taskId,
      runId: run.id,
      actionCode: run.actionCode,
      exactTarget: run.exactTarget,
      artifactVersionId: run.artifactVersionId,
      evidenceHash: run.evidenceHash,
      policyVersion: run.policyVersion,
      policyHash: run.policyHash,
    };
  }

  async reserveAssignment(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    evidence: TrustedAssignmentEvidence,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const actorKind = assertTrustedControlPlane(capability, context);
    validateTrustedAssignmentEvidence(evidence);
    validateAcpApprovalReference(idempotencyKey, 'idempotencyKey');
    if (!(await this.assignmentVerifier.verify(context.workspaceId, evidence))) {
      throw new AcpTaskRunDeniedError('Trusted assignment evidence was not verified');
    }
    return prisma.$transaction(
      async (tx) => {
        const run = await tx.acpRun.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: evidence.runId } },
          include: { task: true },
        });
        if (!run) throw new AcpTaskRunNotFoundError('ACP run not found');
        if (run.taskId !== evidence.taskId)
          throw new AcpTaskRunDeniedError('Assignment evidence targets a different task');
        if (run.requiredAuthority === 4)
          throw new AcpTaskRunDeniedError(
            'Level-4 runs require a claimed exact approval permit before assignment',
          );
        if (run.status === 'ASSIGNED' && run.assignmentIdempotencyKey === idempotencyKey) {
          if (
            run.assignedAgentId !== evidence.agentId ||
            run.assignedRuntimeId !== evidence.runtimeId ||
            run.assignedConnectionId !== evidence.connectionId ||
            run.assignmentEvidenceId !== evidence.evidenceId ||
            run.assignmentEvidenceHash !== evidence.evidenceHash
          ) {
            throw new AcpTaskRunConflictError('Assignment idempotency key was reused');
          }
          return { run, replayed: true };
        }
        if (
          run.version !== expectedVersion ||
          run.status !== 'PREPARED' ||
          run.task.status !== 'READY'
        ) {
          throw new AcpTaskRunConflictError('Run or task is no longer ready for assignment');
        }
        const runChanged = await tx.acpRun.updateMany({
          where: {
            workspaceId: context.workspaceId,
            id: run.id,
            version: expectedVersion,
            status: 'PREPARED',
          },
          data: {
            status: 'ASSIGNED',
            assignedAgentId: evidence.agentId,
            assignedRuntimeId: evidence.runtimeId,
            assignedConnectionId: evidence.connectionId,
            assignmentEvidenceId: evidence.evidenceId,
            assignmentEvidenceHash: evidence.evidenceHash,
            assignmentIdempotencyKey: idempotencyKey,
            version: { increment: 1 },
          },
        });
        if (runChanged.count !== 1)
          throw new AcpTaskRunConflictError('Run was assigned concurrently');
        const taskChanged = await tx.acpTask.updateMany({
          where: {
            workspaceId: context.workspaceId,
            id: run.taskId,
            version: run.task.version,
            status: 'READY',
          },
          data: {
            status: 'ASSIGNED',
            assignedAgentId: evidence.agentId,
            assignedRuntimeId: evidence.runtimeId,
            assignedConnectionId: evidence.connectionId,
            attempt: run.attempt,
            version: { increment: 1 },
          },
        });
        if (taskChanged.count !== 1)
          throw new AcpTaskRunConflictError('Task was assigned concurrently');
        const updated = await tx.acpRun.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: run.id } },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'task.assigned',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpTask',
            subjectId: run.taskId,
            occurredAt: new Date().toISOString(),
            idempotencyKey: `${idempotencyKey}:event`,
            correlationId: run.id,
            facts: {
              agentId: evidence.agentId,
              runtimeId: evidence.runtimeId,
              attempt: run.attempt,
            },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return { run: updated, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async recordArtifact(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    evidence: TrustedArtifactEvidence,
    idempotencyKey: string,
  ) {
    const actorKind = assertTrustedControlPlane(capability, context);
    validateTrustedArtifactEvidence(evidence);
    validateAcpApprovalReference(idempotencyKey, 'idempotencyKey');
    if (!(await this.artifactVerifier.verify(context.workspaceId, evidence))) {
      throw new AcpTaskRunDeniedError('Trusted artifact evidence was not verified');
    }
    return prisma.$transaction(
      async (tx) => {
        const replay = await tx.acpArtifact.findUnique({
          where: {
            workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey },
          },
        });
        if (replay) {
          if (
            replay.id !== evidence.artifactId ||
            replay.runId !== evidence.runId ||
            replay.taskId !== evidence.taskId ||
            replay.kind !== evidence.kind ||
            replay.uriReference !== evidence.uriReference ||
            replay.contentHash !== evidence.contentHash ||
            replay.sourceEvidenceId !== evidence.evidenceId ||
            replay.evidenceHash !== evidence.evidenceHash ||
            replay.criterion !== evidence.criterion
          ) {
            throw new AcpTaskRunConflictError('Artifact idempotency key was reused');
          }
          return { artifact: replay, replayed: true };
        }
        const run = await tx.acpRun.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: evidence.runId } },
          include: { task: true },
        });
        if (!run || run.taskId !== evidence.taskId)
          throw new AcpTaskRunNotFoundError('Bound ACP run/task not found');
        if (!['ASSIGNED', 'RUNNING'].includes(run.status))
          throw new AcpTaskRunDeniedError('Artifacts require an active assigned run');
        if (
          ![...run.task.acceptanceCriteria, ...run.task.verificationCriteria].includes(
            evidence.criterion,
          )
        ) {
          throw new AcpTaskRunDeniedError('Artifact does not satisfy a declared criterion');
        }
        const artifact = await tx.acpArtifact.create({
          data: {
            id: evidence.artifactId,
            workspaceId: context.workspaceId,
            objectiveId: run.objectiveId,
            taskId: run.taskId,
            runId: run.id,
            criterion: evidence.criterion,
            kind: evidence.kind,
            uriReference: evidence.uriReference,
            contentHash: evidence.contentHash,
            sourceEvidenceId: evidence.evidenceId,
            evidenceHash: evidence.evidenceHash,
            idempotencyKey,
          },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'artifact.created',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpArtifact',
            subjectId: artifact.id,
            occurredAt: new Date().toISOString(),
            idempotencyKey: `${idempotencyKey}:event`,
            correlationId: run.id,
            facts: { taskId: run.taskId, runId: run.id, kind: evidence.kind },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return { artifact, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async startRun(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    runId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const actorKind = assertTrustedControlPlane(capability, context);
    validateAcpApprovalReference(runId, 'runId');
    validateAcpApprovalReference(idempotencyKey, 'idempotencyKey');
    return prisma.$transaction(
      async (tx) => {
        const eventKey = `${idempotencyKey}:run`;
        const replay = await tx.auditEvent.findUnique({
          where: {
            workspaceReference_source_idempotencyKey: {
              workspaceReference: context.workspaceId,
              source: 'CONTROL_PLANE',
              idempotencyKey: eventKey,
            },
          },
        });
        if (replay) {
          if (replay.action !== 'run.status.changed' || replay.entityId !== runId)
            throw new AcpTaskRunConflictError('Run-start idempotency key was reused');
          return {
            run: await tx.acpRun.findUniqueOrThrow({
              where: { workspaceId_id: { workspaceId: context.workspaceId, id: runId } },
            }),
            replayed: true,
          };
        }
        const run = await tx.acpRun.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: runId } },
          include: { task: true },
        });
        if (!run) throw new AcpTaskRunNotFoundError('ACP run not found');
        if (run.requiredAuthority === 4)
          throw new AcpTaskRunDeniedError('Level-4 execution is not implemented by this service');
        if (
          run.version !== expectedVersion ||
          run.status !== 'ASSIGNED' ||
          run.task.status !== 'ASSIGNED'
        )
          throw new AcpTaskRunConflictError('Run is not at the expected assigned version');
        const now = new Date();
        const runChanged = await tx.acpRun.updateMany({
          where: {
            workspaceId: context.workspaceId,
            id: run.id,
            version: expectedVersion,
            status: 'ASSIGNED',
          },
          data: { status: 'RUNNING', startedAt: now, version: { increment: 1 } },
        });
        if (runChanged.count !== 1)
          throw new AcpTaskRunConflictError('Run was started concurrently');
        const taskChanged = await tx.acpTask.updateMany({
          where: {
            workspaceId: context.workspaceId,
            id: run.taskId,
            version: run.task.version,
            status: 'ASSIGNED',
          },
          data: { status: 'RUNNING', version: { increment: 1 } },
        });
        if (taskChanged.count !== 1)
          throw new AcpTaskRunConflictError('Task was started concurrently');
        const started = await tx.acpRun.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: run.id } },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'run.status.changed',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpRun',
            subjectId: run.id,
            occurredAt: now.toISOString(),
            idempotencyKey: eventKey,
            correlationId: run.id,
            facts: { previousStatus: 'ASSIGNED', nextStatus: 'RUNNING', taskId: run.taskId },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return { run: started, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async failRun(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    runId: string,
    expectedVersion: number,
    failureCode: string,
    idempotencyKey: string,
  ) {
    const actorKind = assertTrustedControlPlane(capability, context);
    validateAcpApprovalReference(runId, 'runId');
    validateAcpApprovalReference(failureCode, 'failureCode');
    validateAcpApprovalReference(idempotencyKey, 'idempotencyKey');
    const failureCodeDigest = createHash('sha256').update(failureCode).digest('hex');
    return prisma.$transaction(
      async (tx) => {
        const eventKey = `${idempotencyKey}:run`;
        const replay = await tx.auditEvent.findUnique({
          where: {
            workspaceReference_source_idempotencyKey: {
              workspaceReference: context.workspaceId,
              source: 'CONTROL_PLANE',
              idempotencyKey: eventKey,
            },
          },
        });
        if (replay) {
          const taskReplay = await tx.auditEvent.findUnique({
            where: {
              workspaceReference_source_idempotencyKey: {
                workspaceReference: context.workspaceId,
                source: 'CONTROL_PLANE',
                idempotencyKey: `${idempotencyKey}:task`,
              },
            },
          });
          const replayFacts = taskReplay?.after;
          if (
            !['run.failed', 'run.status.changed'].includes(replay.action) ||
            replay.entityId !== runId ||
            !replayFacts ||
            typeof replayFacts !== 'object' ||
            Array.isArray(replayFacts) ||
            (replayFacts as Record<string, unknown>).failureCodeDigest !== failureCodeDigest
          )
            throw new AcpTaskRunConflictError('Run-failure idempotency key was reused');
          return {
            run: await tx.acpRun.findUniqueOrThrow({
              where: { workspaceId_id: { workspaceId: context.workspaceId, id: runId } },
            }),
            replayed: true,
          };
        }
        const run = await tx.acpRun.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: runId } },
          include: { task: true },
        });
        if (!run) throw new AcpTaskRunNotFoundError('ACP run not found');
        if (
          run.version !== expectedVersion ||
          !['ASSIGNED', 'RUNNING'].includes(run.status) ||
          !['ASSIGNED', 'RUNNING'].includes(run.task.status)
        )
          throw new AcpTaskRunConflictError('Run is not at the expected active version');
        const shouldStop = run.task.stopAfterFailureCodes.includes(failureCode);
        const shouldRetry =
          !shouldStop &&
          run.task.retryableFailureCodes.includes(failureCode) &&
          run.attempt < run.task.maximumAttempts;
        const now = new Date();
        const nextRunStatus = shouldStop ? 'STOPPED' : 'FAILED';
        const runChanged = await tx.acpRun.updateMany({
          where: {
            workspaceId: context.workspaceId,
            id: run.id,
            version: expectedVersion,
            status: run.status,
          },
          data: { status: nextRunStatus, completedAt: now, version: { increment: 1 } },
        });
        if (runChanged.count !== 1) throw new AcpTaskRunConflictError('Run failed concurrently');
        const failed = await tx.acpRun.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: run.id } },
        });
        let retryRunId: string | undefined;
        if (shouldRetry) {
          const nextAttempt = run.attempt + 1;
          retryRunId = randomUUID();
          const changed = await tx.acpTask.updateMany({
            where: {
              workspaceId: context.workspaceId,
              id: run.taskId,
              version: run.task.version,
              status: run.task.status,
            },
            data: {
              status: 'READY',
              assignedAgentId: null,
              assignedRuntimeId: null,
              assignedConnectionId: null,
              attempt: nextAttempt - 1,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw new AcpTaskRunConflictError('Task failed concurrently');
          await tx.acpRun.create({
            data: {
              id: retryRunId,
              workspaceId: context.workspaceId,
              objectiveId: run.objectiveId,
              taskId: run.taskId,
              status: 'PREPARED',
              requiredAuthority: run.requiredAuthority,
              policyVersion: run.policyVersion,
              policyHash: run.policyHash,
              attempt: nextAttempt,
              idempotencyKey: `${idempotencyKey}:retry:${nextAttempt}`,
            },
          });
        } else {
          const changed = await tx.acpTask.updateMany({
            where: {
              workspaceId: context.workspaceId,
              id: run.taskId,
              version: run.task.version,
              status: run.task.status,
            },
            data: {
              status: shouldStop ? 'STOPPED' : 'FAILED',
              completedAt: now,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw new AcpTaskRunConflictError('Task failed concurrently');
        }
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: nextRunStatus === 'FAILED' ? 'run.failed' : 'run.status.changed',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpRun',
            subjectId: run.id,
            occurredAt: now.toISOString(),
            idempotencyKey: eventKey,
            correlationId: run.id,
            facts: { previousStatus: run.status, nextStatus: nextRunStatus, taskId: run.taskId },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        const taskEventType = shouldRetry
          ? 'task.retry.ready'
          : shouldStop
            ? 'task.stopped'
            : 'task.failed';
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: taskEventType,
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpTask',
            subjectId: run.taskId,
            occurredAt: now.toISOString(),
            idempotencyKey: `${idempotencyKey}:task`,
            correlationId: retryRunId ?? run.id,
            facts: { failureCodeDigest, attempt: shouldRetry ? run.attempt + 1 : run.attempt },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return { run: failed, retryRunId, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async completeRun(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    runId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const actorKind = assertTrustedControlPlane(capability, context);
    validateAcpApprovalReference(runId, 'runId');
    validateAcpApprovalReference(idempotencyKey, 'idempotencyKey');
    return prisma.$transaction(
      async (tx) => {
        const eventKey = `${idempotencyKey}:run`;
        const replay = await tx.auditEvent.findUnique({
          where: {
            workspaceReference_source_idempotencyKey: {
              workspaceReference: context.workspaceId,
              source: 'CONTROL_PLANE',
              idempotencyKey: eventKey,
            },
          },
        });
        if (replay) {
          if (replay.action !== 'run.completed' || replay.entityId !== runId)
            throw new AcpTaskRunConflictError('Run-completion idempotency key was reused');
          return {
            run: await tx.acpRun.findUniqueOrThrow({
              where: { workspaceId_id: { workspaceId: context.workspaceId, id: runId } },
            }),
            replayed: true,
          };
        }
        const run = await tx.acpRun.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: runId } },
          include: { task: true, artifacts: true },
        });
        if (!run) throw new AcpTaskRunNotFoundError('ACP run not found');
        if (
          run.version !== expectedVersion ||
          run.status !== 'RUNNING' ||
          run.task.status !== 'RUNNING'
        ) {
          throw new AcpTaskRunConflictError('Run is not at the expected running version');
        }
        const evidenced = new Set(run.artifacts.map((artifact) => artifact.criterion));
        const missing = [...run.task.acceptanceCriteria, ...run.task.verificationCriteria].filter(
          (criterion) => !evidenced.has(criterion),
        );
        if (missing.length > 0)
          throw new AcpTaskRunDeniedError(
            'Run lacks trusted artifact evidence for every acceptance and verification criterion',
          );
        const now = new Date();
        const runChanged = await tx.acpRun.updateMany({
          where: {
            workspaceId: context.workspaceId,
            id: run.id,
            version: expectedVersion,
            status: 'RUNNING',
          },
          data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
        });
        if (runChanged.count !== 1) throw new AcpTaskRunConflictError('Run completed concurrently');
        const taskChanged = await tx.acpTask.updateMany({
          where: {
            workspaceId: context.workspaceId,
            id: run.taskId,
            version: run.task.version,
            status: 'RUNNING',
          },
          data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
        });
        if (taskChanged.count !== 1)
          throw new AcpTaskRunConflictError('Task completed concurrently');
        const completed = await tx.acpRun.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: run.id } },
        });
        const artifactIds = run.artifacts.map((artifact) => artifact.id).sort();
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'run.completed',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpRun',
            subjectId: run.id,
            occurredAt: now.toISOString(),
            idempotencyKey: eventKey,
            correlationId: run.id,
            facts: { previousStatus: 'RUNNING', nextStatus: 'COMPLETED', taskId: run.taskId },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'task.completed',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpTask',
            subjectId: run.taskId,
            occurredAt: now.toISOString(),
            idempotencyKey: `${idempotencyKey}:task`,
            correlationId: run.id,
            facts: { artifactIds },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        const dependents = await tx.acpTaskDependency.findMany({
          where: { workspaceId: context.workspaceId, dependsOnTaskId: run.taskId },
          select: { taskId: true },
        });
        for (const dependent of dependents) {
          const blocked = await tx.acpTask.findUnique({
            where: { workspaceId_id: { workspaceId: context.workspaceId, id: dependent.taskId } },
            include: { dependencies: { include: { dependsOn: true } } },
          });
          if (
            !blocked ||
            blocked.status !== 'BLOCKED' ||
            blocked.dependencies.some((dependency) => dependency.dependsOn.status !== 'COMPLETED')
          )
            continue;
          const nextStatus = blocked.requiredAuthority === 4 ? 'AWAITING_APPROVAL' : 'READY';
          await tx.acpTask.update({
            where: { workspaceId_id: { workspaceId: context.workspaceId, id: blocked.id } },
            data: { status: nextStatus, version: { increment: 1 } },
          });
          await this.auditService.recordOperationalEvent(
            capability,
            context,
            {
              id: randomUUID(),
              workspaceId: context.workspaceId,
              type: 'task.ready',
              source: 'CONTROL_PLANE',
              actorKind,
              actorId: context.principalId,
              subjectType: 'AcpTask',
              subjectId: blocked.id,
              occurredAt: now.toISOString(),
              idempotencyKey: `${idempotencyKey}:ready:${blocked.id}`,
              correlationId: run.objectiveId,
              facts: {
                dependencyIds: blocked.dependencies
                  .map((dependency) => dependency.dependsOnTaskId)
                  .sort(),
              },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
        }
        return { run: completed, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
