import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  workflowInfo,
} from '@temporalio/workflow';
import type * as marketplaceActivities from '../activities/marketplace-activities';
import type * as boardActivities from '../activities/board-approval-activities';

const { prepareListingActivity, requestPublicationApprovalActivity, publishListingActivity } =
  proxyActivities<typeof marketplaceActivities>({
    startToCloseTimeout: '2 minutes',
    retry: { maximumAttempts: 3 },
  });

// getApprovalStateActivity is generic over any ApprovalRequest -- reused
// as-is from Phase 3/4's board-approval-activities rather than duplicated.
const { getApprovalStateActivity } = proxyActivities<typeof boardActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

export interface MarketplacePublicationWorkflowInput {
  workspaceId: string;
  listingVersionId: string;
  actorId: string;
}

export interface MarketplacePublicationWorkflowResult {
  prepareStatus: string;
  prepareBlockedReason: string | null;
  approvalRequestId?: string;
  finalApprovalState?: string | null;
  publishStatus?: string;
  externalListingId?: string | null;
  externalListingUrl?: string | null;
}

// Named distinctly from product-listing-workflow's own
// `productListingFounderDecisionSignal` export (and board-approval-
// workflow's `founderDecisionSignal`) to avoid an ambiguous re-export in
// workflows/index.ts -- the underlying signal name string
// ('founderDecision') is unchanged, since that's the raw string
// ApprovalsService.decide() signals by workflowId, independent of this
// export's identifier.
export const marketplacePublicationFounderDecisionSignal =
  defineSignal<[{ approvalRequestId: string }]>('founderDecision');

/**
 * The Phase 6 Temporal workflow: prepares a (mock) draft listing on the
 * marketplace, raises the second/distinct PUBLICATION ApprovalRequest bound
 * to THIS workflow's id (so the founder's decision resumes it via signal
 * rather than polling), durably waits for that decision, then executes the
 * (mock) publish only if approved -- same signal/condition/retry/timeout
 * shape as Phase 3's boardApprovalWorkflow and Phase 4's
 * productListingWorkflow.
 *
 * If prepare doesn't reach READY_FOR_PUBLISH (blocked on the Phase 4
 * PRODUCT_LISTING approval, a disabled marketplace account, a rate limit,
 * or a mock-adapter failure), the workflow ends there -- no approval is
 * ever raised for a listing that isn't actually ready to publish.
 */
export async function marketplacePublicationWorkflow(
  input: MarketplacePublicationWorkflowInput,
): Promise<MarketplacePublicationWorkflowResult> {
  let decisionReceived = false;
  setHandler(marketplacePublicationFounderDecisionSignal, () => {
    decisionReceived = true;
  });

  const prepareResult = await prepareListingActivity({
    workspaceId: input.workspaceId,
    listingVersionId: input.listingVersionId,
    actorId: input.actorId,
    workflowId: workflowInfo().workflowId,
  });

  if (prepareResult.status !== 'READY_FOR_PUBLISH') {
    return {
      prepareStatus: prepareResult.status,
      prepareBlockedReason: prepareResult.blockedReason,
    };
  }

  const { approvalRequestId } = await requestPublicationApprovalActivity({
    workspaceId: input.workspaceId,
    listingVersionId: input.listingVersionId,
    requestedBy: input.actorId,
    workflowId: workflowInfo().workflowId,
  });

  await condition(() => decisionReceived, '7 days');

  const finalApprovalState = await getApprovalStateActivity({ approvalRequestId });

  if (finalApprovalState !== 'APPROVED' && finalApprovalState !== 'APPROVED_WITH_CONDITIONS') {
    return {
      prepareStatus: prepareResult.status,
      prepareBlockedReason: null,
      approvalRequestId,
      finalApprovalState,
    };
  }

  const publishResult = await publishListingActivity({
    workspaceId: input.workspaceId,
    listingVersionId: input.listingVersionId,
    approvalRequestId,
    actorId: input.actorId,
    workflowId: workflowInfo().workflowId,
  });

  return {
    prepareStatus: prepareResult.status,
    prepareBlockedReason: null,
    approvalRequestId,
    finalApprovalState,
    publishStatus: publishResult.status,
    externalListingId: publishResult.externalListingId,
    externalListingUrl: publishResult.externalListingUrl,
  };
}
