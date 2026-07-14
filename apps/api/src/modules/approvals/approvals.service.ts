import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { getTemporalClient } from '@ventureos/workflows';
import {
  decideApprovalRequest,
  ApprovalNotFoundError,
  ApprovalAlreadyDecidedError,
  ApprovalInvalidForExecutionError,
  ApprovalNotApprovedError,
} from '@ventureos/agent-runtime';
import { AuditService } from '../audit/audit.service';
import type { DecideApprovalInput } from './approvals.dto';

const APPROVAL_INCLUDE = { decisions: { orderBy: { decidedAt: 'desc' as const } } };

/**
 * Founder Approval Centre. `decide()` is the ONLY way an ApprovalRequest's
 * state may change -- it always delegates to
 * @ventureos/agent-runtime's decideApprovalRequest, which re-validates
 * hash-binding via isApprovalValidForExecution before honoring any decision
 * (master spec section 14: "never a frontend-only check").
 */
@Injectable()
export class ApprovalsService {
  constructor(private readonly auditService: AuditService) {}

  async list(workspaceId: string, ventureProposalId?: string) {
    return prisma.approvalRequest.findMany({
      where: { workspaceId, ...(ventureProposalId ? { ventureProposalId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: APPROVAL_INCLUDE,
    });
  }

  async getById(workspaceId: string, id: string) {
    const request = await prisma.approvalRequest.findFirst({
      where: { id, workspaceId },
      include: APPROVAL_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException('Approval request not found');
    }
    return request;
  }

  async decide(
    workspaceId: string,
    id: string,
    input: DecideApprovalInput,
    founderIdentity: string,
  ) {
    const before = await prisma.approvalRequest.findFirst({ where: { id, workspaceId } });
    if (!before) {
      throw new NotFoundException('Approval request not found');
    }

    let result;
    try {
      result = await decideApprovalRequest({
        workspaceId,
        approvalRequestId: id,
        founderIdentity,
        decision: input.decision,
        conditions: input.conditions,
        comment: input.comment,
        approvedAmountEur: input.approvedAmountEur,
      });
    } catch (err) {
      if (err instanceof ApprovalNotFoundError) throw new NotFoundException(err.message);
      if (err instanceof ApprovalAlreadyDecidedError) throw new ConflictException(err.message);
      if (err instanceof ApprovalNotApprovedError) throw new ConflictException(err.message);
      if (err instanceof ApprovalInvalidForExecutionError) {
        throw new ConflictException(
          `Approval request is no longer valid (${err.reason}); a fresh approval request is required.`,
        );
      }
      throw err;
    }

    await this.auditService.record(workspaceId, {
      actorId: founderIdentity,
      action: 'APPROVAL_DECIDED',
      entityType: 'ApprovalRequest',
      entityId: id,
      before,
      after: result.approvalRequest,
      approvalReference: result.decision.id,
    });

    // Best-effort signal to a workflow that may be waiting on this decision
    // (the Temporal `boardApprovalWorkflow` blocks on a founderDecision
    // signal). The DB state change above is the source of truth regardless
    // of whether the workflow/worker is currently reachable.
    if (before.workflowId) {
      try {
        const client = await getTemporalClient();
        const handle = client.getHandle(before.workflowId);
        await handle.signal('founderDecision', { approvalRequestId: id });
      } catch {
        // Worker may not be running, or the workflow may have already
        // completed/expired -- not fatal, the approval decision is already
        // durably persisted above.
      }
    }

    return result;
  }
}
