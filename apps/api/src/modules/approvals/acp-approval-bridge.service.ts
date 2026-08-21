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

export class AcpApprovalBridgeError extends Error {}
export class AcpApprovalConflictError extends AcpApprovalBridgeError {}
export class AcpApprovalDeniedError extends AcpApprovalBridgeError {}
export class AcpApprovalNotFoundError extends AcpApprovalBridgeError {}

type FounderDecision = 'APPROVE' | 'REJECT' | 'REVOKE';

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
  constructor(private readonly auditService: AuditService) {}

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

    const id = randomUUID();
    try {
      const request = await prisma.$transaction(async (tx) => {
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
    workspaceId: string,
    approvalRequestId: string,
    approverUserId: string,
    decision: FounderDecision,
    idempotencyKey: string,
    currentBinding?: AcpApprovalBinding,
  ) {
    validateAcpApprovalReference(workspaceId, 'workspaceId');
    validateAcpApprovalReference(approvalRequestId, 'approvalRequestId');
    validateAcpApprovalReference(approverUserId, 'approverUserId');
    validateAcpApprovalReference(idempotencyKey, 'idempotencyKey');
    if (!['APPROVE', 'REJECT', 'REVOKE'].includes(decision)) {
      throw new AcpApprovalDeniedError('Unsupported approval decision');
    }

    return prisma.$transaction(async (tx) => {
      const founder = await tx.user.findFirst({
        where: {
          id: approverUserId,
          isFounder: true,
          deletedAt: null,
          memberships: {
            some: {
              workspaceId,
              role: {
                rolePermissions: { some: { permission: { key: 'approval:decide' } } },
              },
            },
          },
        },
      });
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
        return { request: replay.approvalRequest, decision: replay, replayed: true };
      }
      const request = await tx.acpApprovalRequest.findFirst({
        where: { id: approvalRequestId, workspaceId },
      });
      if (!request) throw new AcpApprovalNotFoundError('ACP approval request not found');

      const now = new Date();
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

      const changed = await tx.acpApprovalRequest.updateMany({
        where: { id: request.id, workspaceId, state: { in: expectedStates } },
        data: { state: nextState },
      });
      if (changed.count !== 1) {
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
      const updated = await tx.acpApprovalRequest.findUniqueOrThrow({ where: { id: request.id } });
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
    });
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
      const request = await tx.acpApprovalRequest.findFirst({
        where: { id: approvalRequestId, workspaceId: context.workspaceId },
      });
      if (!request) throw new AcpApprovalNotFoundError('ACP approval request not found');
      if (request.state !== 'APPROVED') {
        throw new AcpApprovalDeniedError(`Approval is not permit-ready: ${request.state}`);
      }
      const now = new Date();
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
      const changed = await tx.acpApprovalRequest.updateMany({
        where: { id: request.id, state: 'APPROVED' },
        data: { state: 'PERMIT_ISSUED' },
      });
      if (changed.count !== 1) throw new AcpApprovalConflictError('Approval changed concurrently');
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
    const now = new Date();
    assertExecutable(request, currentBinding, now);
    if (permit.bindingHash !== computeAcpApprovalBindingHash(currentBinding)) {
      throw new AcpApprovalDeniedError('Permit binding no longer matches current work');
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const claimHash = hashObject({
          permitId,
          workspaceId: context.workspaceId,
          approvalRequestId: request.id,
          bindingHash: permit.bindingHash,
          claimedByReference: context.principalId,
          claimIdempotencyKey,
          claimedAt: now.toISOString(),
        });
        const changedPermit = await tx.acpExecutionPermit.updateMany({
          where: { id: permitId, workspaceId: context.workspaceId, claimedAt: null },
          data: {
            claimedAt: now,
            claimedByReference: context.principalId,
            claimIdempotencyKey,
            claimHash,
          },
        });
        const changedRequest = await tx.acpApprovalRequest.updateMany({
          where: { id: request.id, state: 'PERMIT_ISSUED' },
          data: { state: 'PERMIT_CLAIMED' },
        });
        if (changedPermit.count !== 1 || changedRequest.count !== 1) {
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
            correlationId: request.runId,
            facts: { taskId: request.taskId, runId: request.runId },
          },
          undefined,
          tx,
        );
        const claimed = await tx.acpExecutionPermit.findUniqueOrThrow({ where: { id: permitId } });
        return { permit: claimed, replayed: false, executed: false as const };
      });
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
