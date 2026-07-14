import { prisma } from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import { isApprovalValidForExecution } from '@ventureos/contracts';
import { MarketplaceBlockedError } from './errors.js';
import {
  fetchMockCreateDraftListing,
  fetchMockUploadListingImage,
  fetchMockUploadListingFile,
  fetchMockPublishListing,
} from './mock-etsy-client.js';
import { withIdempotency } from './idempotency.js';
import { writeMarketplaceHealth } from './health.js';

/**
 * Resolves the workspace's MarketplaceAccount for a marketplace, creating a
 * MOCK one on first use (linked to the "etsy" Integration row Phase 1
 * already seeds) rather than requiring a separate manual setup step --
 * consistent with the founder's mock-only decision (2026-07-14): every
 * account created here is `mode: "MOCK"` and never carries real credentials.
 */
async function resolveMarketplaceAccount(workspaceId: string, marketplace: string) {
  const existing = await prisma.marketplaceAccount.findFirst({
    where: { workspaceId, marketplace },
  });
  if (existing) return existing;

  const integration = await prisma.integration.upsert({
    where: { workspaceId_provider: { workspaceId, provider: marketplace } },
    update: {},
    create: { workspaceId, provider: marketplace, mode: 'MOCK', writeEnabled: false },
  });

  return prisma.marketplaceAccount.create({
    data: {
      workspaceId,
      integrationId: integration.id,
      marketplace,
      mode: 'MOCK',
      connectedAt: new Date(),
    },
  });
}

interface FailClosedCheckResult {
  blockedReason: string | null;
}

/** Fail-closed checks shared by both prepare and publish -- disabled kill
 * switch and per-day rate limit, mirroring Phase 5's acquisition-runner
 * disabled/rate-limit checks. Neither is expected to trip in mock-only mode
 * (no seed data disables an account or sets a tight limit), but the check
 * exists for real -- not decorative -- the moment a founder ever does flip
 * `disabled: true` or a real account's limits apply. */
async function checkFailClosed(account: {
  id: string;
  disabled: boolean;
  disabledReason: string | null;
  rateLimitPerDay: number | null;
}): Promise<FailClosedCheckResult> {
  if (account.disabled) {
    return {
      blockedReason:
        account.disabledReason ?? 'Marketplace account is disabled (kill switch active).',
    };
  }
  if (account.rateLimitPerDay != null) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todaysAttempts = await prisma.publicationAttempt.count({
      where: {
        marketplaceAccountId: account.id,
        attemptedAt: { gte: startOfDay },
        status: { in: ['READY_FOR_PUBLISH', 'PUBLISHED'] },
      },
    });
    if (todaysAttempts >= account.rateLimitPerDay) {
      return {
        blockedReason: `Rate limit of ${account.rateLimitPerDay} publication action(s)/day reached.`,
      };
    }
  }
  return { blockedReason: null };
}

export interface PrepareListingForPublicationParams {
  workspaceId: string;
  listingVersionId: string;
}

export interface PublicationRunResult {
  publicationAttemptId: string;
  status: string;
  blockedReason: string | null;
  externalListingId: string | null;
  externalListingUrl: string | null;
}

/**
 * Stage 1 of the Phase 6 publish flow: creates a draft listing on the (mock)
 * marketplace and uploads its images/files -- but does NOT publish. This
 * mirrors the real Etsy flow (createDraftListing -> uploadListingImage /
 * uploadListingFile are all draft-safe, reversible operations that don't
 * require the second PUBLICATION approval; only the later `updateListing
 * state=active` call does). Every external write here goes through
 * `withIdempotency`, so a retried prepare call never creates a second draft.
 *
 * Requires the listing's Phase 4 PRODUCT_LISTING approval to already be
 * APPROVED / APPROVED_WITH_CONDITIONS -- publication preparation must never
 * run ahead of that gate.
 */
export async function prepareListingForPublication(
  params: PrepareListingForPublicationParams,
): Promise<PublicationRunResult> {
  const listingVersion = await prisma.listingVersion.findFirst({
    where: { id: params.listingVersionId },
    include: {
      listing: true,
      images: true,
      files: true,
    },
  });
  if (!listingVersion || listingVersion.listing.workspaceId !== params.workspaceId) {
    throw new MarketplaceBlockedError('Listing version not found');
  }
  const { listing } = listingVersion;

  const productListingApproval = await prisma.approvalRequest.findFirst({
    where: {
      workspaceId: params.workspaceId,
      kind: 'PRODUCT_LISTING',
      state: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS'] },
      affectedResources: { has: `ListingVersion:${listingVersion.id}` },
    },
  });
  if (!productListingApproval) {
    const attempt = await prisma.publicationAttempt.create({
      data: {
        listingVersionId: listingVersion.id,
        marketplace: listing.marketplace,
        status: 'BLOCKED_NO_APPROVAL',
        blockedReason:
          "This listing version has no founder-approved PRODUCT_LISTING approval; publication preparation is blocked until Phase 4's gate is passed.",
      },
    });
    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason: attempt.blockedReason,
      externalListingId: null,
      externalListingUrl: null,
    };
  }

  const account = await resolveMarketplaceAccount(params.workspaceId, listing.marketplace);
  const failClosed = await checkFailClosed(account);
  if (failClosed.blockedReason) {
    const attempt = await prisma.publicationAttempt.create({
      data: {
        listingVersionId: listingVersion.id,
        marketplace: listing.marketplace,
        marketplaceAccountId: account.id,
        status: account.disabled ? 'BLOCKED_DISABLED' : 'BLOCKED_RATE_LIMIT',
        blockedReason: failClosed.blockedReason,
      },
    });
    await writeMarketplaceHealth(params.workspaceId, listing.marketplace, account.mode, {
      healthy: false,
      message: failClosed.blockedReason,
    });
    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason: failClosed.blockedReason,
      externalListingId: null,
      externalListingUrl: null,
    };
  }

  try {
    const draft = await withIdempotency({
      workspaceId: params.workspaceId,
      marketplaceAccountId: account.id,
      key: `draft:${listingVersion.id}`,
      operationType: 'CREATE_DRAFT_LISTING',
      requestPayload: {
        title: listingVersion.title,
        description: listingVersion.description,
        tags: listingVersion.tags,
        priceEur: listingVersion.priceEur.toString(),
      },
      execute: async () =>
        fetchMockCreateDraftListing({
          title: listingVersion.title,
          description: listingVersion.description,
          tags: listingVersion.tags,
          priceEur: listingVersion.priceEur.toString(),
          isDigital: true,
        }),
    });

    for (const [index, image] of listingVersion.images.entries()) {
      await withIdempotency({
        workspaceId: params.workspaceId,
        marketplaceAccountId: account.id,
        key: `image:${image.id}`,
        operationType: 'UPLOAD_LISTING_IMAGE',
        requestPayload: { externalListingId: draft.result.externalListingId, position: index },
        execute: async () => fetchMockUploadListingImage(draft.result.externalListingId, index),
      });
    }

    for (const file of listingVersion.files) {
      await withIdempotency({
        workspaceId: params.workspaceId,
        marketplaceAccountId: account.id,
        key: `file:${file.id}`,
        operationType: 'UPLOAD_LISTING_FILE',
        requestPayload: {
          externalListingId: draft.result.externalListingId,
          displayName: file.displayName,
        },
        execute: async () =>
          fetchMockUploadListingFile(draft.result.externalListingId, file.displayName),
      });
    }

    const attempt = await prisma.publicationAttempt.create({
      data: {
        listingVersionId: listingVersion.id,
        marketplace: listing.marketplace,
        marketplaceAccountId: account.id,
        status: 'READY_FOR_PUBLISH',
        externalListingId: draft.result.externalListingId,
      },
    });

    await writeMarketplaceHealth(params.workspaceId, listing.marketplace, account.mode, {
      healthy: true,
      message: `Draft prepared (${listingVersion.images.length} image(s), ${listingVersion.files.length} file(s)); awaiting PUBLICATION approval.`,
    });

    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason: null,
      externalListingId: draft.result.externalListingId,
      externalListingUrl: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error preparing draft listing';
    const attempt = await prisma.publicationAttempt.create({
      data: {
        listingVersionId: listingVersion.id,
        marketplace: listing.marketplace,
        marketplaceAccountId: account.id,
        status: 'FAILED',
        errorMessage: message,
      },
    });
    await writeMarketplaceHealth(params.workspaceId, listing.marketplace, account.mode, {
      healthy: false,
      message,
    });
    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason: null,
      externalListingId: null,
      externalListingUrl: null,
    };
  }
}

export interface RequestPublicationApprovalParams {
  workspaceId: string;
  listingVersionId: string;
  requestedBy: string;
  expiresInHours?: number;
  /** Temporal workflow id to bind this approval to -- when set,
   * ApprovalsService.decide() signals this workflow's `founderDecision`
   * handler the moment the founder decides, so a signal-waiting workflow
   * (marketplacePublicationWorkflow) resumes immediately rather than
   * polling. Omitted for approvals requested outside a workflow (e.g. a
   * manual/reconciliation re-request via the synchronous API). */
  workflowId?: string;
}

/**
 * Creates the second, distinct PUBLICATION ApprovalRequest (task #67) --
 * separate from Phase 4's PRODUCT_LISTING approval, and only raisable once
 * a PublicationAttempt has actually reached READY_FOR_PUBLISH (a real draft
 * exists on the mock marketplace). packageHash is computed from the
 * listing version's marketplace-facing content right now, exactly what
 * `publishListing`'s isApprovalValidForExecution re-check will compare
 * against later -- so any edit to title/description/tags/price/category
 * after this request is raised invalidates it before it can ever publish.
 */
export async function requestPublicationApproval(
  params: RequestPublicationApprovalParams,
): Promise<{ approvalRequestId: string }> {
  const listingVersion = await prisma.listingVersion.findFirst({
    where: { id: params.listingVersionId },
    include: {
      listing: {
        include: { product: { include: { ventureProposal: { include: { opportunity: true } } } } },
      },
    },
  });
  if (!listingVersion || listingVersion.listing.workspaceId !== params.workspaceId) {
    throw new MarketplaceBlockedError('Listing version not found');
  }

  const preparedAttempt = await prisma.publicationAttempt.findFirst({
    where: { listingVersionId: params.listingVersionId, status: 'READY_FOR_PUBLISH' },
    orderBy: { attemptedAt: 'desc' as const },
  });
  if (!preparedAttempt) {
    throw new MarketplaceBlockedError(
      'No READY_FOR_PUBLISH publication attempt exists for this listing version yet; run prepareListingForPublication first.',
    );
  }

  const existingPending = await prisma.approvalRequest.findFirst({
    where: {
      workspaceId: params.workspaceId,
      kind: 'PUBLICATION',
      listingVersionId: params.listingVersionId,
      state: 'PENDING',
    },
  });
  if (existingPending) return { approvalRequestId: existingPending.id };

  const { listing } = listingVersion;
  const { product } = listing;
  const { ventureProposal } = product;
  const opportunity = ventureProposal.opportunity;
  const proposalVersion = await prisma.ventureProposalVersion.findFirst({
    where: { ventureProposalId: ventureProposal.id },
    orderBy: { versionNumber: 'desc' as const },
  });
  if (!proposalVersion) throw new MarketplaceBlockedError('Venture proposal has no versions');

  const packageHash = hashObject({
    title: listingVersion.title,
    description: listingVersion.description,
    tags: listingVersion.tags,
    category: listingVersion.category,
    currency: listingVersion.currency,
    priceEur: listingVersion.priceEur.toString(),
  });

  const expiresAt = new Date(Date.now() + (params.expiresInHours ?? 168) * 60 * 60 * 1000);

  const approvalRequest = await prisma.approvalRequest.create({
    data: {
      workspaceId: params.workspaceId,
      ventureProposalId: ventureProposal.id,
      ventureProposalVersionId: proposalVersion.id,
      kind: 'PUBLICATION',
      listingVersionId: listingVersion.id,
      requestedAction: `Publish "${listingVersion.title}" live on ${listing.marketplace} (mock adapter -- founder decision recorded: no real account connected)`,
      explanation:
        'Draft listing prepared on the (mock) marketplace. Founder approval is required before this second, distinct gate before any publish call is made -- this is separate from the earlier PRODUCT_LISTING approval.',
      affectedResources: [
        `Listing:${listing.id}`,
        `ListingVersion:${listingVersion.id}`,
        `PublicationAttempt:${preparedAttempt.id}`,
      ],
      packageHash,
      estimatedCostEur: opportunity.estimatedCostEur ?? 0,
      maxAuthorizedCostEur: opportunity.estimatedCostEur ?? 0,
      reversible: false,
      risks: [
        ...opportunity.risks,
        'Publishing is simulated via the mock adapter only -- no real Etsy account is connected.',
      ],
      evidenceIds: [],
      state: 'PENDING',
      requestedBy: params.requestedBy,
      workflowId: params.workflowId,
      expiresAt,
    },
  });

  return { approvalRequestId: approvalRequest.id };
}

export interface PublishListingParams {
  workspaceId: string;
  listingVersionId: string;
  approvalRequestId: string;
}

/**
 * Stage 2 of the Phase 6 publish flow -- the actual `updateListing
 * state=active` equivalent. Only runs if a PUBLICATION-kind ApprovalRequest
 * for this exact listing version is APPROVED / APPROVED_WITH_CONDITIONS,
 * and re-validates hash-binding via `isApprovalValidForExecution` against
 * the CURRENT latest listing version at the moment of execution (never
 * trusting the approval decision alone, master spec section 14) -- if the
 * listing changed since approval, this fails closed and the ApprovalRequest
 * is marked EXPIRED, exactly like Phase 3/4's re-validation.
 */
export async function publishListing(params: PublishListingParams): Promise<PublicationRunResult> {
  const preparedAttempt = await prisma.publicationAttempt.findFirst({
    where: { listingVersionId: params.listingVersionId, status: 'READY_FOR_PUBLISH' },
    orderBy: { attemptedAt: 'desc' as const },
  });
  if (
    !preparedAttempt ||
    !preparedAttempt.marketplaceAccountId ||
    !preparedAttempt.externalListingId
  ) {
    throw new MarketplaceBlockedError(
      'No READY_FOR_PUBLISH publication attempt found for this listing version; run prepareListingForPublication first.',
    );
  }

  const approvalRequest = await prisma.approvalRequest.findFirst({
    where: {
      id: params.approvalRequestId,
      workspaceId: params.workspaceId,
      kind: 'PUBLICATION',
      listingVersionId: params.listingVersionId,
    },
  });
  if (!approvalRequest) throw new MarketplaceBlockedError('Publication approval request not found');
  if (
    approvalRequest.state !== 'APPROVED' &&
    approvalRequest.state !== 'APPROVED_WITH_CONDITIONS'
  ) {
    throw new MarketplaceBlockedError(
      `Publication approval request is not approved (state: ${approvalRequest.state}).`,
    );
  }

  const decision = await prisma.approvalDecision.findFirst({
    where: {
      approvalRequestId: approvalRequest.id,
      decision: { in: ['APPROVE', 'APPROVE_WITH_CONDITIONS'] },
    },
    orderBy: { decidedAt: 'desc' as const },
  });
  if (!decision) throw new MarketplaceBlockedError('Publication approval has no recorded decision');

  const requestedVersion = await prisma.listingVersion.findUnique({
    where: { id: params.listingVersionId },
  });
  if (!requestedVersion) throw new MarketplaceBlockedError('Listing version not found');
  const latestVersion = await prisma.listingVersion.findFirst({
    where: { listingId: requestedVersion.listingId },
    orderBy: { versionNumber: 'desc' as const },
  });
  if (!latestVersion) throw new MarketplaceBlockedError('Listing has no versions');
  const currentHash = hashObject({
    title: latestVersion.title,
    description: latestVersion.description,
    tags: latestVersion.tags,
    category: latestVersion.category,
    currency: latestVersion.currency,
    priceEur: latestVersion.priceEur.toString(),
  });

  const validity = isApprovalValidForExecution(
    {
      approvedArtifactVersionId: decision.approvedArtifactVersionId,
      approvedPackageHash: decision.approvedPackageHash,
      expiresAt: decision.expiresAt.toISOString(),
    },
    { artifactVersionId: latestVersion.id, packageHash: currentHash },
  );

  if (!validity.valid) {
    await prisma.approvalRequest.update({
      where: { id: approvalRequest.id },
      data: { state: 'EXPIRED' },
    });
    throw new MarketplaceBlockedError(
      `Publication approval is no longer valid (${validity.reason}); a fresh PUBLICATION approval is required.`,
    );
  }

  const account = await prisma.marketplaceAccount.findUniqueOrThrow({
    where: { id: preparedAttempt.marketplaceAccountId },
  });
  const failClosed = await checkFailClosed(account);
  if (failClosed.blockedReason) {
    const attempt = await prisma.publicationAttempt.create({
      data: {
        listingVersionId: params.listingVersionId,
        marketplace: preparedAttempt.marketplace,
        marketplaceAccountId: account.id,
        status: account.disabled ? 'BLOCKED_DISABLED' : 'BLOCKED_RATE_LIMIT',
        blockedReason: failClosed.blockedReason,
      },
    });
    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason: failClosed.blockedReason,
      externalListingId: null,
      externalListingUrl: null,
    };
  }

  try {
    const published = await withIdempotency({
      workspaceId: params.workspaceId,
      marketplaceAccountId: account.id,
      key: `publish:${params.listingVersionId}`,
      operationType: 'PUBLISH_LISTING',
      requestPayload: { externalListingId: preparedAttempt.externalListingId },
      execute: async () => fetchMockPublishListing(preparedAttempt.externalListingId!),
    });

    const attempt = await prisma.publicationAttempt.create({
      data: {
        listingVersionId: params.listingVersionId,
        marketplace: preparedAttempt.marketplace,
        marketplaceAccountId: account.id,
        status: 'PUBLISHED',
        externalListingId: published.result.externalListingId,
        externalListingUrl: published.result.externalListingUrl,
        completedAt: new Date(),
      },
    });

    await prisma.approvalRequest.update({
      where: { id: approvalRequest.id },
      data: {
        executedAt: new Date(),
        executionSuccess: true,
        executionResult: {
          externalListingId: published.result.externalListingId,
          externalListingUrl: published.result.externalListingUrl,
        },
      },
    });

    await writeMarketplaceHealth(params.workspaceId, preparedAttempt.marketplace, account.mode, {
      healthy: true,
      message: `Published (mock): ${published.result.externalListingUrl}`,
    });

    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason: null,
      externalListingId: published.result.externalListingId,
      externalListingUrl: published.result.externalListingUrl,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error publishing listing';
    const attempt = await prisma.publicationAttempt.create({
      data: {
        listingVersionId: params.listingVersionId,
        marketplace: preparedAttempt.marketplace,
        marketplaceAccountId: account.id,
        status: 'FAILED',
        errorMessage: message,
      },
    });
    await prisma.approvalRequest.update({
      where: { id: approvalRequest.id },
      data: {
        executedAt: new Date(),
        executionSuccess: false,
        executionResult: { error: message },
      },
    });
    await writeMarketplaceHealth(params.workspaceId, preparedAttempt.marketplace, account.mode, {
      healthy: false,
      message,
    });
    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason: null,
      externalListingId: null,
      externalListingUrl: null,
    };
  }
}
