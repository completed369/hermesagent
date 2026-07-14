import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  workflowInfo,
} from '@temporalio/workflow';
import type * as activities from '../activities/board-approval-activities';

const { runBoardReviewActivity, createApprovalRequestActivity, getApprovalStateActivity } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '2 minutes',
    retry: { maximumAttempts: 3 },
  });

export interface BoardApprovalWorkflowInput {
  workspaceId: string;
  ventureProposalId: string;
  actorId: string;
}

export interface BoardApprovalWorkflowResult {
  boardReviewId: string;
  approvalRequestId: string;
  finalState: string | null;
}

export const founderDecisionSignal =
  defineSignal<[{ approvalRequestId: string }]>('founderDecision');

/**
 * The Phase 3 slice of the Opportunity-to-Product Draft Workflow (master
 * spec section 24): board review through the first founder approval pause.
 * Runs the 8 mock board agents, computes the deterministic vote result,
 * generates the Decision Synthesiser summary, creates a founder
 * ApprovalRequest, then durably signal-waits for the founder's decision
 * (apps/api's ApprovalsController signals this workflow after
 * decideApprovalRequest persists the decision).
 *
 * Properties: retries + timeouts (activity options above), duplicate-signal
 * protection (`decisionReceived` latch -- only the first signal is
 * honored), approval expiry (the `condition` timeout mirrors
 * ApprovalRequest.expiresAt), resume-after-restart (Temporal's durable
 * execution model, no custom code required), cancellation (propagates by
 * default via Temporal's CancelledFailure). Phase 4 continues from an
 * APPROVED final state into real product generation -- out of scope here.
 */
export async function boardApprovalWorkflow(
  input: BoardApprovalWorkflowInput,
): Promise<BoardApprovalWorkflowResult> {
  let decisionReceived = false;
  setHandler(founderDecisionSignal, () => {
    decisionReceived = true;
  });

  const boardResult = await runBoardReviewActivity({
    workspaceId: input.workspaceId,
    ventureProposalId: input.ventureProposalId,
    actorId: input.actorId,
    workflowId: workflowInfo().workflowId,
  });

  const { approvalRequestId } = await createApprovalRequestActivity({
    workspaceId: input.workspaceId,
    ventureProposalId: input.ventureProposalId,
    boardReviewId: boardResult.boardReviewId,
    requestedBy: input.actorId,
    workflowId: workflowInfo().workflowId,
  });

  // Signal-wait for the founder's decision, bounded by the same window the
  // approval request itself expires on (createApprovalRequest's default is
  // 7 days) so this workflow never blocks forever.
  await condition(() => decisionReceived, '7 days');

  const finalState = await getApprovalStateActivity({ approvalRequestId });

  return { boardReviewId: boardResult.boardReviewId, approvalRequestId, finalState };
}
