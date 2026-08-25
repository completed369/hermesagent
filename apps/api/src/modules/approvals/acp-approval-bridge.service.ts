import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  assertAcpApprovalBindingMatch,
  computeAcpApprovalBindingHash,
  validateAcpApprovalBinding,
  validateAcpApprovalReference,
  validateAcpApprovalRequestInput,
  type AcpApprovalBinding,
  type AcpApprovalRequestInput,
  type OperationalEventCapability,
  type WorkspaceContext,
} from '@ventureos/agent-control-plane';
import { isApprovalValidForExecution } from '@ventureos/contracts';
import { Prisma, prisma, type AcpApprovalRequest } from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import { AuditService } from '../audit/audit.service';
import { AcpTaskRunService } from '../agent-control-plane/acp-task-run.service';

export class AcpApprovalBridgeError extends Error {}
export class AcpApprovalConflictError extends AcpApprovalBridgeError {}
export class AcpApprovalDeniedError extends AcpApprovalBridgeError {}
export class AcpApprovalNotFoundError extends AcpApprovalBridgeError {}

type FounderDecision = 'APPROVE' | 'REJECT' | 'REVOKE';

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  const now = rows[0]?.now;
  if (!(now instanceof Date)) {
    throw new AcpApprovalDeniedError('Database clock is unavailable');
  }
  return now;
}

function requestBinding(request: AcpApprovalRequest): AcpApprovalBinding {
  return {
    workspaceId: request.workspaceId,
    objectiveId: request.objectiveId,
    taskId: request.taskId,
    runId: request.runId,
    actionCode: request.actionCode,
    exactTarget: request.exactTarget,
    artifactVersionId: request.artifactVersionId,
    evidenceHash: request.evidenceHash,
    policyVersion: request.policyVersion,
    policyHash: request.policyHash,
  };
}

function assertExecutable(
  request: AcpApprovalRequest,
  current: AcpApprovalBinding,
  now: Date,
): void {
  assertAcpApprovalBindingMatch(requestBinding(request), current);
  const result = isApprovalValidForExecution(
    {
      approvedArtifactVersionId: request.artifactVersionId,
      approvedPackageHash: request.evidenceHash,
      expiresAt: request.expiresAt.toISOString(),
    },
    {
      artifactVersionId: current.artifactVersionId,
      packageHash: current.evidenceHash,
      now,
    },
  );
  if (!result.valid) {
    throw new AcpApprovalDeniedError(`Approval is invalid for execution: ${result.reason}`);
  }
}

function sameRequest(
  existing: AcpApprovalRequest,
  input: AcpApprovalRequestInput,
  requesterReference: string,
  requesterActorKind: string,
  requesterAuthorityLevel: number,
): boolean {
  return (
    existing.bindingHash === computeAcpApprovalBindingHash(input) &&
    existing.requesterReference === requesterReference &&
    existing.requesterActorKind === requesterActorKind &&
    existing.requesterAuthorityLevel === requesterAuthorityLevel &&
    existing.expiresAt.toISOString() === input.expiresAt
  );
}

/**
 * Durable ACP authorization preparation. This service never dispatches a
 * runtime or performs the approved action. OperationalEventCapability is a
 * server composition-root trust boundary and must never be issued from an
 * AI COO card, voice transcript, request body, or runtime-supplied payload.
 */
@Injectable()
export class AcpApprovalBridgeService {
  constructor(
    private readonly auditService: AuditService,
    private readonly taskRunService: AcpTaskRunService,
  ) {}

  async requestApproval(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: AcpApprovalRequestInput,
  ) {
    const now = new Date();
    validateAcpApprovalRequestInput(input, now);
    if (context.workspaceId !== input.workspaceId) {
      throw new AcpApprovalDeniedError('Cross-workspace approval request denied');
    }
    capability.assertSource('AI_COO');
    const actorKind = capability.actorKindFor(context);
    const requesterAuthorityLevel = capability.authorityLevelFor(context);
    if (requesterAuthorityLevel < 1) {
      throw new AcpApprovalDeniedError('Requester requires at least Level-1 recommend authority');
    }
    if (actorKind !== 'HUMAN' && actorKind !== 'AGENT') {
      throw new AcpApprovalDeniedError('Only a bound human or agent may request approval');
    }
    const existing = await prisma.acpApprovalRequest.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (!sameRequest(existing, input, context.principalId, actorKind, requesterAuthorityLevel)) {
        throw new AcpApprovalConflictError('Approval request idempotency key was reused');
      }
      return { request: existing, replayed: true };
    }

    const durableBinding = await this.taskRunService.getPreparedApprovalBinding(
      context,
      input.runId,
    );
    try {
      assertAcpApprovalBindingMatch(durableBinding, input);
    } catch {
      throw new AcpApprovalDeniedError(
        'Approval request does not match current durable prepared work',
      );
    }

    const id = randomUUID();
    try {
      const request = await prisma.$transaction(async (tx) => {
        const lockedDurableBinding = await this.taskRunService.getPreparedApprovalBinding(
          context,
          input.runId,
          tx,
          true,
        );
        try {
          assertAcpApprovalBindingMatch(lockedDurableBinding, input);
        } catch {
          throw new AcpApprovalDeniedError(
            'Approval request does not match current durable prepared work',
          );
        }
        const created = await tx.acpApprovalRequest.create({
          data: {
            id,
            ...input,
            expiresAt: new Date(input.expiresAt),
            bindingHash: computeAcpApprovalBindingHash(input),
            requesterReference: context.principalId,
            requesterActorKind: actorKind,
            requesterAuthorityLevel,
            requiredAuthorityLevel: 4,
          },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id,
            workspaceId: input.workspaceId,
            type: 'approval.requested',
            source: 'AI_COO',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpApprovalRequest',
            subjectId: id,
            occurredAt: now.toISOString(),
            idempotencyKey: id,
            correlationId: input.runId,
            facts: { taskId: input.taskId, runId: input.runId },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return created;
      });
      return { request, replayed: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await prisma.acpApprovalRequest.findUnique({
          where: {
            workspaceId_idempotencyKey: {
              workspaceId: input.workspaceId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (
          raced &&
          sameRequest(raced, input, context.principalId, actorKind, requesterAuthorityLevel)
        ) {
          return { request: raced, replayed: true };
        }
        throw new AcpApprovalConflictError('Approval request idempotency key was reused');
      }
      throw error;
    }
  }

  async decideApproval(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    approvalRequestId: string,
    decision: FounderDecision,
    idempotencyKey: string,
    currentBinding?: AcpApprovalBinding,
  ) {
    const workspaceId = context.workspaceId;
    const approverUserId = context.principalId;
    validateAcpApprovalReference(workspaceId, 'workspaceId');
    validateAcpApprovalReference(approvalRequestId, 'approvalRequestId');
    validateAcpApprovalReference(approverUserId, 'approverUserId');
    validateAcpApprovalReference(idempotencyKey, 'idempotencyKey');
    if (!['APPROVE', 'REJECT', 'REVOKE'].includes(decision)) {
      throw new AcpApprovalDeniedError('Unsupported approval decision');
    }
    capability.assertSource('CONTROL_PLANE');
    if (capability.actorKindFor(context) !== 'HUMAN') {
      throw new AcpApprovalDeniedError('Only an authenticated human principal may decide');
    }

    return prisma.$transaction(
      async (tx) => {
        const founders = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT u."id"
        FROM "users" u
        JOIN "workspace_members" wm ON wm."userId" = u."id"
        JOIN "roles" r ON r."id" = wm."roleId"
        JOIN "role_permissions" rp ON rp."roleId" = r."id"
        JOIN "permissions" p ON p."id" = rp."permissionId"
        WHERE u."id" = ${approverUserId}::uuid
          AND wm."workspaceId" = ${workspaceId}::uuid
          AND u."isFounder" = TRUE
          AND u."deletedAt" IS NULL
          AND p."key" = 'approval:decide'
        FOR SHARE OF u, wm, r, rp, p
      `);
        const founder = founders[0];
        if (!founder) {
          throw new AcpApprovalDeniedError(
            'A current workspace founder with approval:decide authority is required',
          );
        }
        const replay = await tx.acpApprovalDecision.findUnique({
          where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
          include: { approvalRequest: true },
        });
        if (replay) {
          if (
            replay.approvalRequestId !== approvalRequestId ||
            replay.approverReference !== founder.id ||
            replay.decision !== decision
          ) {
            throw new AcpApprovalConflictError('Decision idempotency key was reused');
          }
          if (decision === 'APPROVE') {
            if (!currentBinding) throw new AcpApprovalDeniedError('Current binding is required');
            assertExecutable(replay.approvalRequest, currentBinding, new Date());
          }
          return { request: replay.approvalRequest, decision: replay, replayed: true };
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "acp_approval_requests"
          WHERE "id" = ${approvalRequestId}::uuid
            AND "workspaceId" = ${workspaceId}::uuid
          FOR UPDATE
        `);
        const request = await tx.acpApprovalRequest.findFirst({
          where: { id: approvalRequestId, workspaceId },
        });
        if (!request) throw new AcpApprovalNotFoundError('ACP approval request not found');

        const now = await databaseNow(tx);
        let expectedStates: string[];
        let nextState: string;
        if (decision === 'APPROVE') {
          if (!currentBinding) throw new AcpApprovalDeniedError('Current binding is required');
          validateAcpApprovalBinding(currentBinding);
          assertExecutable(request, currentBinding, now);
          expectedStates = ['PENDING'];
          nextState = 'APPROVED';
        } else if (decision === 'REJECT') {
          expectedStates = ['PENDING'];
          nextState = 'REJECTED';
        } else {
          expectedStates = ['APPROVED', 'PERMIT_ISSUED'];
          nextState = 'REVOKED';
        }

        const changed =
          decision === 'APPROVE'
            ? await tx.$executeRaw(Prisma.sql`
              UPDATE "acp_approval_requests"
              SET "state" = 'APPROVED', "updatedAt" = CURRENT_TIMESTAMP
              WHERE "id" = ${request.id}::uuid
                AND "workspaceId" = ${workspaceId}::uuid
                AND "state" = 'PENDING'
                AND "expiresAt" > clock_timestamp()
            `)
            : (
                await tx.acpApprovalRequest.updateMany({
                  where: { id: request.id, workspaceId, state: { in: expectedStates } },
                  data: { state: nextState },
                })
              ).count;
        if (changed !== 1) {
          throw new AcpApprovalConflictError(`Approval cannot transition from ${request.state}`);
        }

        const decisionId = randomUUID();
        const decisionHash = hashObject({
          id: decisionId,
          workspaceId,
          approvalRequestId,
          decision,
          approverReference: approverUserId,
          approverAuthorityLevel: 4,
          bindingHash: request.bindingHash,
          artifactVersionId: request.artifactVersionId,
          evidenceHash: request.evidenceHash,
          policyVersion: request.policyVersion,
          policyHash: request.policyHash,
          idempotencyKey,
          decidedAt: now.toISOString(),
          expiresAt: request.expiresAt.toISOString(),
        });
        const decisionRecord = await tx.acpApprovalDecision.create({
          data: {
            id: decisionId,
            workspaceId,
            approvalRequestId,
            decision,
            approverId: founder.id,
            approverReference: founder.id,
            approverAuthorityLevel: 4,
            bindingHash: request.bindingHash,
            artifactVersionId: request.artifactVersionId,
            evidenceHash: request.evidenceHash,
            policyVersion: request.policyVersion,
            policyHash: request.policyHash,
            idempotencyKey,
            decidedAt: now,
            expiresAt: request.expiresAt,
            decisionHash,
          },
        });
        const updated = await tx.acpApprovalRequest.findUniqueOrThrow({
          where: { id: request.id },
        });
        await this.auditService.record(
          workspaceId,
          {
            actorId: founder.id,
            action: 'ACP_APPROVAL_DECIDED',
            entityType: 'AcpApprovalRequest',
            entityId: request.id,
            before: { state: request.state, bindingHash: request.bindingHash },
            after: { state: updated.state, decision, bindingHash: request.bindingHash },
            approvalReference: decisionId,
          },
          tx,
        );
        return { request: updated, decision: decisionRecord, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async issueExecutionPermit(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    approvalRequestId: string,
    currentBinding: AcpApprovalBinding,
    executionPrincipalReference: string,
    issueIdempotencyKey: string,
  ) {
    validateAcpApprovalBinding(currentBinding);
    validateAcpApprovalReference(approvalRequestId, 'approvalRequestId');
    validateAcpApprovalReference(executionPrincipalReference, 'executionPrincipalReference');
    validateAcpApprovalReference(issueIdempotencyKey, 'issueIdempotencyKey');
    if (context.workspaceId !== currentBinding.workspaceId) {
      throw new AcpApprovalDeniedError('Cross-workspace permit issue denied');
    }
    capability.assertSource('CONTROL_PLANE');
    const actorKind = capability.actorKindFor(context);
    if (actorKind !== 'AGENT' && actorKind !== 'SYSTEM') {
      throw new AcpApprovalDeniedError('Only a bound control-plane principal may issue a permit');
    }

    const replay = await prisma.acpExecutionPermit.findUnique({
      where: {
        workspaceId_issueIdempotencyKey: {
          workspaceId: context.workspaceId,
          issueIdempotencyKey,
        },
      },
      include: { approvalRequest: true },
    });
    if (replay) {
      if (
        replay.approvalRequestId !== approvalRequestId ||
        replay.executionPrincipalReference !== executionPrincipalReference ||
        replay.bindingHash !== computeAcpApprovalBindingHash(currentBinding)
      ) {
        throw new AcpApprovalConflictError('Permit issue idempotency key was reused');
      }
      if (replay.approvalRequest.state !== 'PERMIT_ISSUED') {
        throw new AcpApprovalDeniedError(
          `Issued permit is no longer usable: ${replay.approvalRequest.state}`,
        );
      }
      assertExecutable(replay.approvalRequest, currentBinding, new Date());
      return { permit: replay, replayed: true };
    }

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "acp_approval_requests"
        WHERE "id" = ${approvalRequestId}::uuid
          AND "workspaceId" = ${context.workspaceId}::uuid
        FOR UPDATE
      `);
      const request = await tx.acpApprovalRequest.findFirst({
        where: { id: approvalRequestId, workspaceId: context.workspaceId },
      });
      if (!request) throw new AcpApprovalNotFoundError('ACP approval request not found');
      if (request.state !== 'APPROVED') {
        throw new AcpApprovalDeniedError(`Approval is not permit-ready: ${request.state}`);
      }
      const now = await databaseNow(tx);
      assertExecutable(request, currentBinding, now);
      const approved = await tx.acpApprovalDecision.findFirst({
        where: { approvalRequestId, decision: 'APPROVE' },
        orderBy: { decidedAt: 'desc' },
      });
      if (!approved || approved.bindingHash !== request.bindingHash) {
        throw new AcpApprovalDeniedError('No exact founder approval decision exists');
      }

      const permitId = randomUUID();
      const permit = await tx.acpExecutionPermit.create({
        data: {
          id: permitId,
          workspaceId: request.workspaceId,
          approvalRequestId: request.id,
          taskId: request.taskId,
          runId: request.runId,
          actionCode: request.actionCode,
          exactTarget: request.exactTarget,
          artifactVersionId: request.artifactVersionId,
          evidenceHash: request.evidenceHash,
          policyVersion: request.policyVersion,
          policyHash: request.policyHash,
          bindingHash: request.bindingHash,
          executionPrincipalReference,
          issueIdempotencyKey,
          issuedAt: now,
          expiresAt: request.expiresAt,
        },
      });
      const changed = await tx.$executeRaw(Prisma.sql`
        UPDATE "acp_approval_requests"
        SET "state" = 'PERMIT_ISSUED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${request.id}::uuid
          AND "state" = 'APPROVED'
          AND "expiresAt" > clock_timestamp()
      `);
      if (changed !== 1) throw new AcpApprovalConflictError('Approval changed or expired');
      await this.auditService.recordOperationalEvent(
        capability,
        context,
        {
          id: permitId,
          workspaceId: request.workspaceId,
          type: 'approval.permit.issued',
          source: 'CONTROL_PLANE',
          actorKind,
          actorId: context.principalId,
          subjectType: 'AcpExecutionPermit',
          subjectId: permitId,
          occurredAt: now.toISOString(),
          idempotencyKey: permitId,
          correlationId: request.runId,
          facts: { taskId: request.taskId, runId: request.runId },
        },
        undefined,
        tx,
      );
      return { permit, replayed: false };
    });
  }

  async claimExecutionPermit(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    permitId: string,
    currentBinding: AcpApprovalBinding,
    claimIdempotencyKey: string,
  ) {
    validateAcpApprovalBinding(currentBinding);
    validateAcpApprovalReference(permitId, 'permitId');
    validateAcpApprovalReference(claimIdempotencyKey, 'claimIdempotencyKey');
    capability.assertSource('CONTROL_PLANE');
    const actorKind = capability.actorKindFor(context);
    if (!['AGENT', 'RUNTIME', 'SYSTEM'].includes(actorKind)) {
      throw new AcpApprovalDeniedError('Only a bound execution principal may claim a permit');
    }
    const permit = await prisma.acpExecutionPermit.findFirst({
      where: { id: permitId, workspaceId: context.workspaceId },
      include: { approvalRequest: true },
    });
    if (!permit) throw new AcpApprovalNotFoundError('ACP execution permit not found');
    if (permit.executionPrincipalReference !== context.principalId) {
      throw new AcpApprovalDeniedError('Permit is bound to a different execution principal');
    }
    if (permit.claimedAt) {
      assertAcpApprovalBindingMatch(requestBinding(permit.approvalRequest), currentBinding);
      if (permit.bindingHash !== computeAcpApprovalBindingHash(currentBinding)) {
        throw new AcpApprovalDeniedError('Claim receipt binding no longer matches current work');
      }
      if (
        permit.claimIdempotencyKey === claimIdempotencyKey &&
        permit.claimedByReference === context.principalId
      ) {
        return { permit, replayed: true, executed: false as const };
      }
      throw new AcpApprovalConflictError('Execution permit was already claimed');
    }
    const request = permit.approvalRequest;
    if (request.state !== 'PERMIT_ISSUED') {
      throw new AcpApprovalDeniedError(`Permit cannot be claimed: ${request.state}`);
    }
    assertExecutable(request, currentBinding, new Date());
    if (permit.bindingHash !== computeAcpApprovalBindingHash(currentBinding)) {
      throw new AcpApprovalDeniedError('Permit binding no longer matches current work');
    }

    try {
      return await prisma.$transaction(
        async (tx) => {
          // Every consuming path locks the request first, then the permit. The
          // DB clock is sampled only after both locks are held so a wait cannot
          // carry a pre-expiry authorization across its deadline.
          await tx.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "acp_approval_requests"
            WHERE "id" = ${request.id}::uuid
              AND "workspaceId" = ${context.workspaceId}::uuid
            FOR UPDATE
          `);
          await tx.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "acp_execution_permits"
            WHERE "id" = ${permitId}::uuid
              AND "workspaceId" = ${context.workspaceId}::uuid
            FOR UPDATE
          `);
          const lockedPermit = await tx.acpExecutionPermit.findFirst({
            where: { id: permitId, workspaceId: context.workspaceId },
            include: { approvalRequest: true },
          });
          if (!lockedPermit) {
            throw new AcpApprovalNotFoundError('ACP execution permit not found');
          }
          if (lockedPermit.claimedAt) {
            throw new AcpApprovalConflictError('Execution permit was claimed concurrently');
          }
          if (lockedPermit.executionPrincipalReference !== context.principalId) {
            throw new AcpApprovalDeniedError('Permit is bound to a different execution principal');
          }
          const lockedRequest = lockedPermit.approvalRequest;
          if (lockedRequest.state !== 'PERMIT_ISSUED') {
            throw new AcpApprovalDeniedError(`Permit cannot be claimed: ${lockedRequest.state}`);
          }
          const now = await databaseNow(tx);
          assertExecutable(lockedRequest, currentBinding, now);
          if (lockedPermit.expiresAt.getTime() <= now.getTime()) {
            throw new AcpApprovalDeniedError('Execution permit expired before claim');
          }
          if (lockedPermit.bindingHash !== computeAcpApprovalBindingHash(currentBinding)) {
            throw new AcpApprovalDeniedError('Permit binding no longer matches current work');
          }
          const claimHash = hashObject({
            permitId,
            workspaceId: context.workspaceId,
            approvalRequestId: lockedRequest.id,
            bindingHash: lockedPermit.bindingHash,
            claimedByReference: context.principalId,
            claimIdempotencyKey,
            claimedAt: now.toISOString(),
          });
          const changedPermit = await tx.$executeRaw(Prisma.sql`
          UPDATE "acp_execution_permits"
          SET "claimedAt" = ${now},
              "claimedByReference" = ${context.principalId},
              "claimIdempotencyKey" = ${claimIdempotencyKey},
              "claimHash" = ${claimHash}
          WHERE "id" = ${permitId}::uuid
            AND "workspaceId" = ${context.workspaceId}::uuid
            AND "claimedAt" IS NULL
            AND "expiresAt" > clock_timestamp()
        `);
          const changedRequest = await tx.$executeRaw(Prisma.sql`
          UPDATE "acp_approval_requests"
          SET "state" = 'PERMIT_CLAIMED', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${lockedRequest.id}::uuid
            AND "state" = 'PERMIT_ISSUED'
            AND "expiresAt" > clock_timestamp()
        `);
          if (changedPermit !== 1 || changedRequest !== 1) {
            throw new AcpApprovalConflictError('Execution permit was claimed concurrently');
          }
          await this.auditService.recordOperationalEvent(
            capability,
            context,
            {
              id: randomUUID(),
              workspaceId: context.workspaceId,
              type: 'approval.permit.claimed',
              source: 'CONTROL_PLANE',
              actorKind,
              actorId: context.principalId,
              subjectType: 'AcpExecutionPermit',
              subjectId: permitId,
              occurredAt: now.toISOString(),
              idempotencyKey: claimIdempotencyKey,
              correlationId: lockedRequest.runId,
              facts: { taskId: lockedRequest.taskId, runId: lockedRequest.runId },
            },
            undefined,
            tx,
          );
          const claimed = await tx.acpExecutionPermit.findUniqueOrThrow({
            where: { id: permitId },
          });
          return { permit: claimed, replayed: false, executed: false as const };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof AcpApprovalConflictError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code))
      ) {
        const raced = await prisma.acpExecutionPermit.findFirst({
          where: { id: permitId, workspaceId: context.workspaceId },
        });
        if (
          raced?.claimedAt &&
          raced.claimIdempotencyKey === claimIdempotencyKey &&
          raced.claimedByReference === context.principalId &&
          raced.bindingHash === computeAcpApprovalBindingHash(currentBinding)
        ) {
          return { permit: raced, replayed: true, executed: false as const };
        }
      }
      throw error;
    }
  }
}
