import { enforceWorkspaceCapability, prisma } from '@ventureos/database';
import type { ApprovalRequest, ApprovalDecision } from '@ventureos/database';
import {
  hashObject,
  hashProductListingBundle,
  hashScaleDecisionArtifact,
} from '@ventureos/security';
import { isApprovalValidForExecution } from '@ventureos/contracts';

export class ApprovalNotFoundError extends Error {}
export class ApprovalAlreadyDecidedError extends Error {}
export class ApprovalInvalidForExecutionError extends Error {
  constructor(public readonly reason: string) {
    super(`Approval is no longer valid: ${reason}`);
  }
}
export class ApprovalNotApprovedError extends Error {}

const DEFAULT_EXPIRY_HOURS = 168; // 7 days

export interface CreateApprovalRequestParams {
  workspaceId: string;
  ventureProposalId: string;
  boardReviewId?: string;
  requestedBy: string;
  expiresInHours?: number;
  workflowId?: string;
}

/**
 * Creates a founder ApprovalRequest for the CURRENT latest VentureProposalVersion.
 * packageHash is computed from the version's snapshot right now via
 * @ventureos/security's hashObject -- this is the value isApprovalValidForExecution
 * later compares against to detect drift (master spec section 14).
 */
export async function createApprovalRequest(
  params: CreateApprovalRequestParams,
): Promise<ApprovalRequest> {
  const proposal = await prisma.ventureProposal.findFirst({
    where: { id: params.ventureProposalId, workspaceId: params.workspaceId },
    include: {
      opportunity: true,
      versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 },
    },
  });
  if (!proposal) throw new ApprovalNotFoundError('Venture proposal not found');
  const latestVersion = proposal.versions[0];
  if (!latestVersion) throw new ApprovalNotFoundError('Venture proposal has no versions');

  const opportunity = proposal.opportunity;
  const evidenceIds = (
    await prisma.evidenceClaim.findMany({
      where: { opportunityId: opportunity.id },
      select: { id: true },
    })
  ).map((c) => c.id);

  const packageHash = hashObject(latestVersion.snapshot);
  const expiresAt = new Date(
    Date.now() + (params.expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000,
  );

  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'AI_MODEL_EXECUTION',
    stage: 'DISPATCH',
    correlationReference: `approval-request:venture-proposal:${proposal.id}`,
  });

  return prisma.approvalRequest.create({
    data: {
      workspaceId: params.workspaceId,
      ventureProposalId: proposal.id,
      ventureProposalVersionId: latestVersion.id,
      boardReviewId: params.boardReviewId,
      requestedAction: `Approve venture proposal for "${opportunity.title}"`,
      explanation:
        'Board review completed. Founder approval is required before this venture proposal may proceed toward product/listing creation.',
      affectedResources: [`Opportunity:${opportunity.id}`, `VentureProposal:${proposal.id}`],
      packageHash,
      estimatedCostEur: opportunity.estimatedCostEur ?? 0,
      maxAuthorizedCostEur: opportunity.estimatedCostEur ?? 0,
      reversible: true,
      risks: opportunity.risks,
      evidenceIds,
      state: 'PENDING',
      requestedBy: params.requestedBy,
      workflowId: params.workflowId,
      expiresAt,
    },
  });
}

export interface DecideApprovalParams {
  workspaceId: string;
  approvalRequestId: string;
  founderIdentity: string;
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION' | 'APPROVE_WITH_CONDITIONS' | 'REVOKE';
  conditions?: string[];
  comment?: string;
  approvedAmountEur?: number;
}

const DECISION_TO_STATE: Record<DecideApprovalParams['decision'], string> = {
  APPROVE: 'APPROVED',
  APPROVE_WITH_CONDITIONS: 'APPROVED_WITH_CONDITIONS',
  REJECT: 'REJECTED',
  REQUEST_REVISION: 'REVISION_REQUESTED',
  REVOKE: 'REVOKED',
};

/**
 * The ONLY way an ApprovalRequest's state may change after creation. Always
 * re-validates hash-binding via isApprovalValidForExecution (already
 * unit-tested in @ventureos/contracts) against the CURRENT state of whatever
 * this request's `kind` refers to before honoring any decision -- if a newer
 * artefact was created since the request was raised, or the request has
 * expired, the request is invalidated and a fresh one is required. This is
 * the server-side enforcement docs/APPROVAL_MODEL.md commits to: "never a
 * frontend check alone."
 *
 * `kind` discriminates which artefact is being approved:
 *  - 'VENTURE_PROPOSAL' (Phase 3, default): current artefact is the venture
 *    proposal's latest VentureProposalVersion snapshot.
 *  - 'PRODUCT_LISTING' (Phase 4): current artefact is the latest
 *    ProductPackage for the same ProductVersion -- a regeneration creates a
 *    new ProductPackage row rather than mutating the old one, so "latest
 *    package id differs from the one this request was raised against" is
 *    exactly the drift signal, mirroring the VENTURE_PROPOSAL branch.
 *  - 'PUBLICATION' (Phase 6): current artefact is the latest ListingVersion
 *    for the same Listing, hashed over its marketplace-facing content
 *    (title/description/tags/category/currency/price) -- editing the
 *    listing after this approval was raised is exactly the drift signal.
 *    `@ventureos/marketplace-connectors`'s `publishListing` re-runs this
 *    same check again at the moment of execution, not just at decision
 *    time (defense in depth: content could still drift in the window
 *    between a founder's decision and the workflow actually publishing).
 */
export async function decideApprovalRequest(
  params: DecideApprovalParams,
): Promise<{ approvalRequest: ApprovalRequest; decision: ApprovalDecision }> {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: params.approvalRequestId, workspaceId: params.workspaceId },
  });
  if (!request) throw new ApprovalNotFoundError('Approval request not found');

  if (params.decision === 'REVOKE') {
    if (request.state !== 'APPROVED' && request.state !== 'APPROVED_WITH_CONDITIONS') {
      throw new ApprovalNotApprovedError('Only an approved request may be revoked');
    }
  } else if (request.state !== 'PENDING') {
    throw new ApprovalAlreadyDecidedError(
      `Approval request has already been decided (state: ${request.state})`,
    );
  }

  let approvedArtifactVersionId: string;
  let currentArtifactVersionId: string;
  let currentHash: string;

  if (request.kind === 'PRODUCT_LISTING') {
    if (!request.productPackageId) {
      throw new ApprovalNotFoundError(
        'Product-listing approval request is missing its product package reference',
      );
    }
    const requestedPackage = await prisma.productPackage.findUnique({
      where: { id: request.productPackageId },
    });
    if (!requestedPackage) throw new ApprovalNotFoundError('Product package not found');
    const latestPackage = await prisma.productPackage.findFirst({
      where: { productVersionId: requestedPackage.productVersionId },
      orderBy: { createdAt: 'desc' as const },
      include: {
        listingVersion: {
          include: {
            listing: { select: { productVersionId: true, workspaceId: true } },
            images: {
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                productAssetVersionId: true,
                position: true,
                altText: true,
              },
            },
            files: {
              orderBy: { id: 'asc' },
              select: { id: true, productAssetVersionId: true, displayName: true },
            },
          },
        },
      },
    });
    if (!latestPackage) throw new ApprovalNotFoundError('Product version has no package');
    const listingVersion = latestPackage.listingVersion;
    if (
      !listingVersion ||
      listingVersion.listing.workspaceId !== request.workspaceId ||
      listingVersion.listing.productVersionId !== latestPackage.productVersionId
    ) {
      throw new ApprovalNotFoundError('Product package listing evidence is unavailable');
    }
    approvedArtifactVersionId = request.productPackageId;
    currentArtifactVersionId = latestPackage.id;
    currentHash = hashProductListingBundle({
      assetVersionIds: latestPackage.assetVersionIds,
      listing: listingVersion,
      images: listingVersion.images,
      files: listingVersion.files,
    });
  } else if (request.kind === 'PUBLICATION') {
    if (!request.listingVersionId) {
      throw new ApprovalNotFoundError(
        'Publication approval request is missing its listing version reference',
      );
    }
    const requestedVersion = await prisma.listingVersion.findUnique({
      where: { id: request.listingVersionId },
    });
    if (!requestedVersion) throw new ApprovalNotFoundError('Listing version not found');
    const latestVersion = await prisma.listingVersion.findFirst({
      where: { listingId: requestedVersion.listingId },
      orderBy: { versionNumber: 'desc' as const },
    });
    if (!latestVersion) throw new ApprovalNotFoundError('Listing has no versions');
    approvedArtifactVersionId = request.listingVersionId;
    currentArtifactVersionId = latestVersion.id;
    currentHash = hashObject({
      title: latestVersion.title,
      description: latestVersion.description,
      tags: latestVersion.tags,
      category: latestVersion.category,
      currency: latestVersion.currency,
      priceEur: latestVersion.priceEur.toString(),
    });
  } else if (request.kind === 'SCALE_DECISION') {
    if (!request.experimentId) {
      throw new ApprovalNotFoundError(
        'Scale-decision approval request is missing its experiment reference',
      );
    }
    const experiment = await prisma.experiment.findFirst({
      where: { id: request.experimentId, workspaceId: request.workspaceId },
      include: { variants: { include: { results: true } }, metrics: true },
    });
    if (!experiment) throw new ApprovalNotFoundError('Experiment not found');
    const proposal = await prisma.ventureProposal.findUnique({
      where: { id: request.ventureProposalId },
      include: { versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 } },
    });
    const latestVersion = proposal?.versions[0];
    if (!latestVersion) throw new ApprovalNotFoundError('Venture proposal has no versions');
    approvedArtifactVersionId = request.ventureProposalVersionId;
    currentArtifactVersionId = latestVersion.id;
    currentHash = hashScaleDecisionArtifact({
      proposalVersionId: latestVersion.id,
      proposalSnapshot: latestVersion.snapshot,
      experiment,
    });
  } else {
    const proposal = await prisma.ventureProposal.findUnique({
      where: { id: request.ventureProposalId },
      include: { versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 } },
    });
    const latestVersion = proposal?.versions[0];
    if (!latestVersion) throw new ApprovalNotFoundError('Venture proposal has no versions');
    approvedArtifactVersionId = request.ventureProposalVersionId;
    currentArtifactVersionId = latestVersion.id;
    currentHash = hashObject(latestVersion.snapshot);
  }

  const validity = isApprovalValidForExecution(
    {
      approvedArtifactVersionId,
      approvedPackageHash: request.packageHash,
      expiresAt: request.expiresAt.toISOString(),
    },
    { artifactVersionId: currentArtifactVersionId, packageHash: currentHash },
  );

  if (!validity.valid && params.decision !== 'REVOKE') {
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { state: 'EXPIRED' },
    });
    throw new ApprovalInvalidForExecutionError(validity.reason ?? 'unknown');
  }

  const decidedAt = new Date();
  const auditSignature = hashObject({
    approvalRequestId: request.id,
    decision: params.decision,
    decidedAt: decidedAt.toISOString(),
    founderIdentity: params.founderIdentity,
  });

  const [updatedRequest, decisionRow] = await prisma.$transaction(async (tx) => {
    const expectedStates =
      params.decision === 'REVOKE' ? ['APPROVED', 'APPROVED_WITH_CONDITIONS'] : ['PENDING'];
    const transitioned = await tx.approvalRequest.updateMany({
      where: { id: request.id, workspaceId: params.workspaceId, state: { in: expectedStates } },
      data: {
        state: DECISION_TO_STATE[params.decision],
        ...(params.decision === 'REVOKE'
          ? {
              revokedAt: decidedAt,
              revokedBy: params.founderIdentity,
              revocationReason: params.comment,
            }
          : {}),
      },
    });
    if (transitioned.count !== 1) {
      if (params.decision === 'REVOKE') {
        throw new ApprovalNotApprovedError('Only an approved request may be revoked');
      }
      throw new ApprovalAlreadyDecidedError('Approval request has already been decided');
    }

    const decision = await tx.approvalDecision.create({
      data: {
        approvalRequestId: request.id,
        founderIdentity: params.founderIdentity,
        decidedAt,
        decision: params.decision,
        conditions: params.conditions ?? [],
        comment: params.comment,
        approvedAmountEur: params.approvedAmountEur,
        approvedArtifactVersionId: currentArtifactVersionId,
        approvedPackageHash: currentHash,
        expiresAt: request.expiresAt,
        auditSignature,
      },
    });

    if (params.decision === 'REQUEST_REVISION') {
      await tx.revisionRequest.create({
        data: {
          workspaceId: request.workspaceId,
          ventureProposalId: request.ventureProposalId,
          boardReviewId: request.boardReviewId,
          approvalRequestId: request.id,
          requestedChanges: params.conditions ?? [],
          reason: params.comment ?? 'Revision requested by founder.',
          status: 'OPEN',
        },
      });
    }

    const updated = await tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
    return [updated, decision] as const;
  });

  return { approvalRequest: updatedRequest, decision: decisionRow };
}

export async function getApprovalRequestState(approvalRequestId: string): Promise<string | null> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    select: { state: true },
  });
  return request?.state ?? null;
}
