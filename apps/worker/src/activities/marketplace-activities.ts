import {
  prepareListingForPublication,
  requestPublicationApproval,
  publishListing,
  type PublicationRunResult,
} from '@ventureos/marketplace-connectors';
import { writeAuditEvent } from '../lib/write-audit-event';

export interface PrepareListingActivityInput {
  workspaceId: string;
  listingVersionId: string;
  actorId: string;
  workflowId: string;
}

export async function prepareListingActivity(
  input: PrepareListingActivityInput,
): Promise<PublicationRunResult> {
  const result = await prepareListingForPublication(input);
  await writeAuditEvent(input.workspaceId, {
    actorId: input.actorId,
    action: 'PUBLICATION_PREPARED',
    entityType: 'ListingVersion',
    entityId: input.listingVersionId,
    workflowId: input.workflowId,
    after: result as unknown as Record<string, unknown>,
  });
  return result;
}

export interface RequestPublicationApprovalActivityInput {
  workspaceId: string;
  listingVersionId: string;
  requestedBy: string;
  workflowId: string;
}

export async function requestPublicationApprovalActivity(
  input: RequestPublicationApprovalActivityInput,
): Promise<{ approvalRequestId: string }> {
  const result = await requestPublicationApproval(input);
  await writeAuditEvent(input.workspaceId, {
    actorId: input.requestedBy,
    action: 'PUBLICATION_APPROVAL_REQUESTED',
    entityType: 'ListingVersion',
    entityId: input.listingVersionId,
    workflowId: input.workflowId,
    after: result as unknown as Record<string, unknown>,
  });
  return result;
}

export interface PublishListingActivityInput {
  workspaceId: string;
  listingVersionId: string;
  approvalRequestId: string;
  actorId: string;
  workflowId: string;
}

export async function publishListingActivity(
  input: PublishListingActivityInput,
): Promise<PublicationRunResult> {
  const result = await publishListing(input);
  await writeAuditEvent(input.workspaceId, {
    actorId: input.actorId,
    action: result.status === 'PUBLISHED' ? 'PUBLICATION_PUBLISHED' : 'PUBLICATION_FAILED',
    entityType: 'ListingVersion',
    entityId: input.listingVersionId,
    workflowId: input.workflowId,
    approvalReference: input.approvalRequestId,
    after: result as unknown as Record<string, unknown>,
  });
  return result;
}
