import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  workflowInfo,
} from '@temporalio/workflow';
import type * as productActivities from '../activities/product-listing-activities';
import type * as boardActivities from '../activities/board-approval-activities';

const { generateProductActivity, generateListingActivity } = proxyActivities<
  typeof productActivities
>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 3 },
});

// getApprovalStateActivity is generic over any ApprovalRequest -- reused
// as-is from Phase 3's board-approval-activities rather than duplicated.
const { getApprovalStateActivity } = proxyActivities<typeof boardActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

export interface ProductListingWorkflowInput {
  workspaceId: string;
  ventureProposalId: string;
  actorId: string;
}

export interface ProductListingWorkflowResult {
  productId: string;
  productVersionId: string;
  qaPassed: boolean;
  listingId?: string;
  listingVersionId?: string;
  seoScore?: number;
  approvalRequestId?: string;
  finalState?: string | null;
}

// Named distinctly from board-approval-workflow's own `founderDecisionSignal`
// export to avoid an ambiguous re-export in workflows/index.ts -- the
// underlying signal name string ('founderDecision') is unchanged, since
// that's the raw string ApprovalsService.decide() signals by workflowId,
// independent of this export's identifier.
export const productListingFounderDecisionSignal =
  defineSignal<[{ approvalRequestId: string }]>('founderDecision');

/**
 * The Phase 4 slice of the Opportunity-to-Product Draft Workflow (master
 * spec section 24): product generation through the SECOND founder approval
 * pause. Continues only from an already-APPROVED Phase 3 venture proposal
 * (generateProduct() fails closed otherwise -- enforced inside
 * @ventureos/product-studio, not here).
 *
 * Generates the mock product assets + runs QA. If QA fails, the workflow
 * ends there -- no listing is drafted and no approval request is raised
 * (Gate 3: a product must pass QA before it may be offered for listing).
 * If QA passes, drafts the mock Etsy listing, runs SEO evaluation, and
 * raises the second founder ApprovalRequest (kind PRODUCT_LISTING), then
 * durably signal-waits for the founder's decision -- same
 * signal/condition/retry/timeout pattern as Phase 3's boardApprovalWorkflow
 * (Gate 4: no publication may occur, and none does -- Phase 4 always
 * records a blocked PublicationAttempt regardless of the decision).
 */
export async function productListingWorkflow(
  input: ProductListingWorkflowInput,
): Promise<ProductListingWorkflowResult> {
  let decisionReceived = false;
  setHandler(productListingFounderDecisionSignal, () => {
    decisionReceived = true;
  });

  const productResult = await generateProductActivity({
    workspaceId: input.workspaceId,
    ventureProposalId: input.ventureProposalId,
    actorId: input.actorId,
    workflowId: workflowInfo().workflowId,
  });

  if (!productResult.qaPassed) {
    return productResult;
  }

  const listingResult = await generateListingActivity({
    workspaceId: input.workspaceId,
    productId: productResult.productId,
    requestedBy: input.actorId,
    workflowId: workflowInfo().workflowId,
  });

  // Signal-wait for the founder's decision, bounded the same way Phase 3's
  // workflow is (this approval request's own 7-day default expiry).
  await condition(() => decisionReceived, '7 days');

  const finalState = await getApprovalStateActivity({
    approvalRequestId: listingResult.approvalRequestId,
  });

  return { ...productResult, ...listingResult, finalState };
}
