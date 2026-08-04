import {
  runBoardReview,
  createApprovalRequest,
  getApprovalRequestState,
  type RunBoardReviewResult,
} from '@ventureos/agent-runtime';
import { writeAuditEvent } from '../lib/write-audit-event';
import { runWithActivityCapability } from './run-with-activity-capability';

export interface RunBoardReviewActivityInput {
  workspaceId: string;
  ventureProposalId: string;
  actorId: string;
  workflowId: string;
}

export async function runBoardReviewActivity(
  input: RunBoardReviewActivityInput,
): Promise<RunBoardReviewResult> {
  const result = await runWithActivityCapability(
    {
      workspaceId: input.workspaceId,
      capability: 'AI_MODEL_EXECUTION',
      stage: 'DISPATCH',
    },
    () => runBoardReview(input),
  );
  await writeAuditEvent(input.workspaceId, {
    actorId: input.actorId,
    action: 'BOARD_REVIEW_COMPLETED',
    entityType: 'BoardReview',
    entityId: result.boardReviewId,
    workflowId: input.workflowId,
    after: result as unknown as Record<string, unknown>,
  });
  return result;
}

export interface CreateApprovalRequestActivityInput {
  workspaceId: string;
  ventureProposalId: string;
  boardReviewId?: string;
  requestedBy: string;
  workflowId: string;
}

export async function createApprovalRequestActivity(
  input: CreateApprovalRequestActivityInput,
): Promise<{ approvalRequestId: string; state: string }> {
  const request = await runWithActivityCapability(
    {
      workspaceId: input.workspaceId,
      capability: 'AI_MODEL_EXECUTION',
      stage: 'DISPATCH',
    },
    () => createApprovalRequest(input),
  );
  await writeAuditEvent(input.workspaceId, {
    actorId: input.requestedBy,
    action: 'APPROVAL_REQUESTED',
    entityType: 'ApprovalRequest',
    entityId: request.id,
    workflowId: input.workflowId,
    after: { kind: 'VENTURE_PROPOSAL', ventureProposalId: input.ventureProposalId },
  });
  return { approvalRequestId: request.id, state: request.state };
}

export async function getApprovalStateActivity(input: {
  approvalRequestId: string;
}): Promise<string | null> {
  return getApprovalRequestState(input.approvalRequestId);
}
