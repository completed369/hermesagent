import {
  CapabilityFinalCheckBlockedError,
  dispatchWithWorkspaceCapability,
  enforceWorkspaceCapability,
  isCapabilityPolicyDeniedError,
  prisma,
  Prisma,
} from '@ventureos/database';
import { hashObject, hashProductListingBundle } from '@ventureos/security';
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

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "subscriptions" WHERE "workspaceId" = ${workspaceId}::uuid FOR UPDATE`,
    );

    const concurrentExisting = await tx.marketplaceAccount.findFirst({
      where: { workspaceId, marketplace },
    });
    if (concurrentExisting) return concurrentExisting;

    await enforceWorkspaceCapability(
      {
        workspaceId,
        capability: 'MARKETPLACE_CONNECTION',
        stage: 'DISPATCH',
        providerMode: 'mock',
        recordAllow: true,
      },
      tx,
    );

    const integration = await tx.integration.upsert({
      where: { workspaceId_provider: { workspaceId, provider: marketplace } },
      update: {},
      create: { workspaceId, provider: marketplace, mode: 'MOCK', writeEnabled: false },
    });

    return tx.marketplaceAccount.create({
      data: {
        workspaceId,
        integrationId: integration.id,
        marketplace,
        mode: 'MOCK',
        connectedAt: new Date(),
      },
    });
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
async function checkFailClosed(
  account: {
    id: string;
    disabled: boolean;
    disabledReason: string | null;
    rateLimitPerDay: number | null;
  },
  client: Pick<Prisma.TransactionClient, 'publicationAttempt'> = prisma,
): Promise<FailClosedCheckResult> {
  if (account.disabled) {
    return {
      blockedReason:
        account.disabledReason ?? 'Marketplace account is disabled (kill switch active).',
    };
  }
  if (account.rateLimitPerDay != null) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todaysAttempts = await client.publicationAttempt.count({
      where: {
        marketplaceAccountId: account.id,
        attemptedAt: { gte: startOfDay },
        status: { in: ['RESERVED', 'READY_FOR_PUBLISH', 'PUBLISHED'] },
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

async function reservePublicationAttempt(params: {
  workspaceId: string;
  listingVersionId: string;
  marketplace: string;
  marketplaceAccountId: string;
  idempotencyKeyId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "marketplace_accounts" WHERE "id" = ${params.marketplaceAccountId}::uuid FOR UPDATE`,
    );
    const account = await tx.marketplaceAccount.findFirst({
      where: {
        id: params.marketplaceAccountId,
        workspaceId: params.workspaceId,
        marketplace: params.marketplace,
        mode: 'MOCK',
      },
    });
    if (!account) throw new Error('Marketplace account is unavailable for reservation');
    const failClosed = await checkFailClosed(account, tx);
    return tx.publicationAttempt.create({
      data: {
        listingVersionId: params.listingVersionId,
        marketplace: params.marketplace,
        marketplaceAccountId: params.marketplaceAccountId,
        idempotencyKeyId: params.idempotencyKeyId,
        status: failClosed.blockedReason
          ? account.disabled
            ? 'BLOCKED_DISABLED'
            : 'BLOCKED_RATE_LIMIT'
          : 'RESERVED',
        blockedReason: failClosed.blockedReason,
      },
    });
  });
}

async function revalidateMarketplaceReplay(
  capability: 'MARKETPLACE_DRAFT' | 'MARKETPLACE_PUBLICATION',
  workspaceId: string,
  localStateCheck: () => Promise<unknown>,
): Promise<void> {
  await dispatchWithWorkspaceCapability(
    {
      workspaceId,
      capability,
      stage: 'DISPATCH',
      beforeDispatch: async () => {
        await localStateCheck();
      },
    },
    () => undefined,
  );
}

interface PrepareDispatchStateParams {
  workspaceId: string;
  listingVersionId: string;
  marketplace: string;
  marketplaceAccountId: string;
  imageId?: string;
  fileId?: string;
}

/** Best-effort fail-closed local-state revalidation. These reads finish before
 * the provider-shaped operation; no database transaction is held across it. */
async function assertPrepareDispatchState(params: PrepareDispatchStateParams) {
  const [listingVersion, approval, account] = await Promise.all([
    prisma.listingVersion.findFirst({
      where: {
        id: params.listingVersionId,
        listing: { workspaceId: params.workspaceId, marketplace: params.marketplace },
      },
      include: {
        listing: { select: { productVersionId: true } },
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
    }),
    prisma.approvalRequest.findFirst({
      where: {
        workspaceId: params.workspaceId,
        kind: 'PRODUCT_LISTING',
        state: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS'] },
        affectedResources: { has: `ListingVersion:${params.listingVersionId}` },
      },
    }),
    prisma.marketplaceAccount.findFirst({
      where: {
        id: params.marketplaceAccountId,
        workspaceId: params.workspaceId,
        marketplace: params.marketplace,
        mode: 'MOCK',
      },
    }),
  ]);

  if (!listingVersion || !approval || !account || account.disabled || !approval.productPackageId) {
    throw new CapabilityFinalCheckBlockedError(
      'Marketplace draft state is unavailable for dispatch',
    );
  }
  const [latestListingVersion, decision, requestedPackage] = await Promise.all([
    prisma.listingVersion.findFirst({
      where: { listingId: listingVersion.listingId, listing: { workspaceId: params.workspaceId } },
      orderBy: { versionNumber: 'desc' as const },
    }),
    prisma.approvalDecision.findFirst({
      where: {
        approvalRequestId: approval.id,
        decision: { in: ['APPROVE', 'APPROVE_WITH_CONDITIONS'] },
      },
      orderBy: { decidedAt: 'desc' as const },
    }),
    prisma.productPackage.findUnique({ where: { id: approval.productPackageId } }),
  ]);
  if (
    !latestListingVersion ||
    latestListingVersion.id !== listingVersion.id ||
    !decision ||
    !requestedPackage
  ) {
    throw new CapabilityFinalCheckBlockedError(
      'Marketplace draft approval evidence is unavailable for dispatch',
    );
  }
  const latestPackage = await prisma.productPackage.findFirst({
    where: { productVersionId: requestedPackage.productVersionId },
    orderBy: { createdAt: 'desc' as const },
  });
  const currentPackageHash = hashProductListingBundle({
    assetVersionIds: requestedPackage.assetVersionIds,
    listing: listingVersion,
    images: listingVersion.images,
    files: listingVersion.files,
  });
  const validity =
    latestPackage?.id === requestedPackage.id &&
    requestedPackage.listingVersionId === listingVersion.id &&
    requestedPackage.productVersionId === listingVersion.listing.productVersionId
      ? isApprovalValidForExecution(
          {
            approvedArtifactVersionId: decision.approvedArtifactVersionId,
            approvedPackageHash: decision.approvedPackageHash,
            expiresAt: decision.expiresAt.toISOString(),
          },
          { artifactVersionId: requestedPackage.id, packageHash: currentPackageHash },
        )
      : { valid: false };
  if (!validity.valid) {
    throw new CapabilityFinalCheckBlockedError('Marketplace draft approval is no longer valid');
  }

  const imageIndex = params.imageId
    ? listingVersion.images.findIndex((image) => image.id === params.imageId)
    : null;
  const currentFile = params.fileId
    ? listingVersion.files.find((file) => file.id === params.fileId)
    : null;
  if ((params.imageId && imageIndex === -1) || (params.fileId && !currentFile)) {
    throw new CapabilityFinalCheckBlockedError(
      'Marketplace draft asset is no longer attached to the listing version',
    );
  }
  return { listingVersion, imageIndex, currentFile };
}

interface PublishDispatchStateParams {
  workspaceId: string;
  listingVersionId: string;
  approvalRequestId: string;
  preparedAttemptId: string;
  marketplace: string;
  marketplaceAccountId: string;
}

async function assertPublishDispatchState(params: PublishDispatchStateParams) {
  const [preparedAttempt, approval, decision, listingVersion, account] = await Promise.all([
    prisma.publicationAttempt.findFirst({
      where: {
        id: params.preparedAttemptId,
        listingVersionId: params.listingVersionId,
        marketplace: params.marketplace,
        marketplaceAccountId: params.marketplaceAccountId,
        status: 'READY_FOR_PUBLISH',
        listingVersion: { listing: { workspaceId: params.workspaceId } },
      },
    }),
    prisma.approvalRequest.findFirst({
      where: {
        id: params.approvalRequestId,
        workspaceId: params.workspaceId,
        kind: 'PUBLICATION',
        listingVersionId: params.listingVersionId,
        state: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS'] },
      },
    }),
    prisma.approvalDecision.findFirst({
      where: {
        approvalRequestId: params.approvalRequestId,
        decision: { in: ['APPROVE', 'APPROVE_WITH_CONDITIONS'] },
      },
      orderBy: { decidedAt: 'desc' as const },
    }),
    prisma.listingVersion.findFirst({
      where: { id: params.listingVersionId, listing: { workspaceId: params.workspaceId } },
    }),
    prisma.marketplaceAccount.findFirst({
      where: {
        id: params.marketplaceAccountId,
        workspaceId: params.workspaceId,
        marketplace: params.marketplace,
        mode: 'MOCK',
      },
    }),
  ]);

  if (
    !preparedAttempt ||
    !approval ||
    !decision ||
    !listingVersion ||
    !account ||
    account.disabled ||
    !preparedAttempt.externalListingId ||
    !approval.affectedResources.includes(`PublicationAttempt:${preparedAttempt.id}`)
  ) {
    throw new CapabilityFinalCheckBlockedError(
      'Marketplace publication state is unavailable for dispatch',
    );
  }
  const latestListingVersion = await prisma.listingVersion.findFirst({
    where: { listingId: listingVersion.listingId, listing: { workspaceId: params.workspaceId } },
    orderBy: { versionNumber: 'desc' as const },
  });
  if (!latestListingVersion || latestListingVersion.id !== listingVersion.id) {
    throw new CapabilityFinalCheckBlockedError(
      'Marketplace publication listing version is no longer current',
    );
  }

  const currentHash = hashObject({
    title: listingVersion.title,
    description: listingVersion.description,
    tags: listingVersion.tags,
    category: listingVersion.category,
    currency: listingVersion.currency,
    priceEur: listingVersion.priceEur.toString(),
  });
  const validity = isApprovalValidForExecution(
    {
      approvedArtifactVersionId: decision.approvedArtifactVersionId,
      approvedPackageHash: decision.approvedPackageHash,
      expiresAt: decision.expiresAt.toISOString(),
    },
    { artifactVersionId: listingVersion.id, packageHash: currentHash },
  );
  if (!validity.valid) {
    throw new CapabilityFinalCheckBlockedError(
      'Marketplace publication approval is unavailable for dispatch',
    );
  }
  return { preparedAttempt, listingVersion, account };
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
  /** True only when this result recovers an earlier provider success. */
  replayed?: boolean;
}

export function publicationPreparationAuditAction(
  status: PublicationRunResult['status'],
): 'PUBLICATION_PREPARED' | 'PUBLICATION_PREPARATION_BLOCKED' | 'PUBLICATION_PREPARATION_FAILED' {
  if (status === 'READY_FOR_PUBLISH') return 'PUBLICATION_PREPARED';
  if (status === 'FAILED') return 'PUBLICATION_PREPARATION_FAILED';
  return 'PUBLICATION_PREPARATION_BLOCKED';
}

class MarketplaceReplayUnavailableError extends MarketplaceBlockedError {}

class MarketplaceReservationBlockedError extends Error {
  constructor(readonly attempt: Awaited<ReturnType<typeof reservePublicationAttempt>>) {
    super(attempt.blockedReason ?? 'Marketplace publication reservation was blocked');
    this.name = 'MarketplaceReservationBlockedError';
  }
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
  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'MARKETPLACE_DRAFT',
    stage: 'DISPATCH',
  });

  const listingVersion = await prisma.listingVersion.findFirst({
    where: { id: params.listingVersionId, listing: { workspaceId: params.workspaceId } },
    include: {
      listing: true,
      images: true,
      files: true,
    },
  });
  if (!listingVersion) {
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

  const reservedAttempt = await reservePublicationAttempt({
    workspaceId: params.workspaceId,
    listingVersionId: listingVersion.id,
    marketplace: listing.marketplace,
    marketplaceAccountId: account.id,
  });
  if (reservedAttempt.status !== 'RESERVED') {
    return {
      publicationAttemptId: reservedAttempt.id,
      status: reservedAttempt.status,
      blockedReason: reservedAttempt.blockedReason,
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
      beforeReplay: () =>
        revalidateMarketplaceReplay('MARKETPLACE_DRAFT', params.workspaceId, () =>
          assertPrepareDispatchState({
            workspaceId: params.workspaceId,
            listingVersionId: listingVersion.id,
            marketplace: listing.marketplace,
            marketplaceAccountId: account.id,
          }),
        ),
      execute: async () => {
        let currentListingPayload = {
          title: listingVersion.title,
          description: listingVersion.description,
          tags: listingVersion.tags,
          priceEur: listingVersion.priceEur,
        };
        return dispatchWithWorkspaceCapability(
          {
            workspaceId: params.workspaceId,
            capability: 'MARKETPLACE_DRAFT',
            stage: 'DISPATCH',
            beforeDispatch: async () => {
              const state = await assertPrepareDispatchState({
                workspaceId: params.workspaceId,
                listingVersionId: listingVersion.id,
                marketplace: listing.marketplace,
                marketplaceAccountId: account.id,
              });
              currentListingPayload = {
                title: state.listingVersion.title,
                description: state.listingVersion.description,
                tags: state.listingVersion.tags,
                priceEur: state.listingVersion.priceEur,
              };
            },
          },
          () =>
            fetchMockCreateDraftListing({
              title: currentListingPayload.title,
              description: currentListingPayload.description,
              tags: currentListingPayload.tags,
              priceEur: currentListingPayload.priceEur.toString(),
              isDigital: true,
            }),
        );
      },
    });

    for (const [index, image] of listingVersion.images.entries()) {
      await withIdempotency({
        workspaceId: params.workspaceId,
        marketplaceAccountId: account.id,
        key: `image:${image.id}`,
        operationType: 'UPLOAD_LISTING_IMAGE',
        requestPayload: { externalListingId: draft.result.externalListingId, position: index },
        beforeReplay: () =>
          revalidateMarketplaceReplay('MARKETPLACE_DRAFT', params.workspaceId, () =>
            assertPrepareDispatchState({
              workspaceId: params.workspaceId,
              listingVersionId: listingVersion.id,
              marketplace: listing.marketplace,
              marketplaceAccountId: account.id,
              imageId: image.id,
            }),
          ),
        execute: async () => {
          let currentImageIndex = index;
          return dispatchWithWorkspaceCapability(
            {
              workspaceId: params.workspaceId,
              capability: 'MARKETPLACE_DRAFT',
              stage: 'DISPATCH',
              beforeDispatch: async () => {
                const state = await assertPrepareDispatchState({
                  workspaceId: params.workspaceId,
                  listingVersionId: listingVersion.id,
                  marketplace: listing.marketplace,
                  marketplaceAccountId: account.id,
                  imageId: image.id,
                });
                if (state.imageIndex === null) {
                  throw new CapabilityFinalCheckBlockedError('Marketplace image is unavailable');
                }
                currentImageIndex = state.imageIndex;
              },
            },
            () => fetchMockUploadListingImage(draft.result.externalListingId, currentImageIndex),
          );
        },
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
        beforeReplay: () =>
          revalidateMarketplaceReplay('MARKETPLACE_DRAFT', params.workspaceId, () =>
            assertPrepareDispatchState({
              workspaceId: params.workspaceId,
              listingVersionId: listingVersion.id,
              marketplace: listing.marketplace,
              marketplaceAccountId: account.id,
              fileId: file.id,
            }),
          ),
        execute: async () => {
          let currentDisplayName = file.displayName;
          return dispatchWithWorkspaceCapability(
            {
              workspaceId: params.workspaceId,
              capability: 'MARKETPLACE_DRAFT',
              stage: 'DISPATCH',
              beforeDispatch: async () => {
                const state = await assertPrepareDispatchState({
                  workspaceId: params.workspaceId,
                  listingVersionId: listingVersion.id,
                  marketplace: listing.marketplace,
                  marketplaceAccountId: account.id,
                  fileId: file.id,
                });
                if (!state.currentFile) {
                  throw new CapabilityFinalCheckBlockedError('Marketplace file is unavailable');
                }
                currentDisplayName = state.currentFile.displayName;
              },
            },
            () => fetchMockUploadListingFile(draft.result.externalListingId, currentDisplayName),
          );
        },
      });
    }

    const attempt = await prisma.publicationAttempt.update({
      where: { id: reservedAttempt.id },
      data: {
        status: 'READY_FOR_PUBLISH',
        blockedReason: null,
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
    if (isCapabilityPolicyDeniedError(err)) {
      await prisma.publicationAttempt.update({
        where: { id: reservedAttempt.id },
        data: {
          status: 'BLOCKED_POLICY',
          blockedReason: 'Operation is not available',
          completedAt: new Date(),
        },
      });
      throw err;
    }
    const message = 'Marketplace draft operation failed';
    const attempt = await prisma.publicationAttempt.update({
      where: { id: reservedAttempt.id },
      data: {
        status: 'FAILED',
        errorMessage: message,
        completedAt: new Date(),
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
  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'MARKETPLACE_DRAFT',
    stage: 'DISPATCH',
  });

  const listingVersion = await prisma.listingVersion.findFirst({
    where: { id: params.listingVersionId, listing: { workspaceId: params.workspaceId } },
    include: {
      listing: {
        include: { product: { include: { ventureProposal: { include: { opportunity: true } } } } },
      },
    },
  });
  if (!listingVersion) {
    throw new MarketplaceBlockedError('Listing version not found');
  }

  const preparedAttempt = await prisma.publicationAttempt.findFirst({
    where: {
      listingVersionId: params.listingVersionId,
      status: 'READY_FOR_PUBLISH',
      listingVersion: { listing: { workspaceId: params.workspaceId } },
    },
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
  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'MARKETPLACE_PUBLICATION',
    stage: 'DISPATCH',
  });

  const preparedAttempt = await prisma.publicationAttempt.findFirst({
    where: {
      listingVersionId: params.listingVersionId,
      status: 'READY_FOR_PUBLISH',
      listingVersion: { listing: { workspaceId: params.workspaceId } },
    },
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

  const requestedVersion = await prisma.listingVersion.findFirst({
    where: { id: params.listingVersionId, listing: { workspaceId: params.workspaceId } },
  });
  if (!requestedVersion) throw new MarketplaceBlockedError('Listing version not found');
  const latestVersion = await prisma.listingVersion.findFirst({
    where: { listingId: requestedVersion.listingId, listing: { workspaceId: params.workspaceId } },
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

  const account = await prisma.marketplaceAccount.findFirstOrThrow({
    where: {
      id: preparedAttempt.marketplaceAccountId,
      workspaceId: params.workspaceId,
      marketplace: preparedAttempt.marketplace,
    },
  });
  if (account.disabled) {
    const blockedReason =
      account.disabledReason ?? 'Marketplace account is disabled (kill switch active).';
    const attempt = await prisma.publicationAttempt.create({
      data: {
        listingVersionId: params.listingVersionId,
        marketplace: preparedAttempt.marketplace,
        marketplaceAccountId: account.id,
        status: 'BLOCKED_DISABLED',
        blockedReason,
      },
    });
    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason,
      externalListingId: null,
      externalListingUrl: null,
    };
  }

  const executionState: {
    reservedAttempt: Awaited<ReturnType<typeof reservePublicationAttempt>> | null;
  } = { reservedAttempt: null };
  let providerSucceeded = false;

  try {
    const published = await withIdempotency({
      workspaceId: params.workspaceId,
      marketplaceAccountId: account.id,
      key: `publish:${params.listingVersionId}`,
      operationType: 'PUBLISH_LISTING',
      requestPayload: { externalListingId: preparedAttempt.externalListingId },
      beforeReplay: () =>
        revalidateMarketplaceReplay('MARKETPLACE_PUBLICATION', params.workspaceId, () =>
          assertPublishDispatchState({
            workspaceId: params.workspaceId,
            listingVersionId: params.listingVersionId,
            approvalRequestId: params.approvalRequestId,
            preparedAttemptId: preparedAttempt.id,
            marketplace: preparedAttempt.marketplace,
            marketplaceAccountId: account.id,
          }),
        ),
      beforeExecute: async ({ idempotencyKeyId }) => {
        const attempt = await reservePublicationAttempt({
          workspaceId: params.workspaceId,
          listingVersionId: params.listingVersionId,
          marketplace: preparedAttempt.marketplace,
          marketplaceAccountId: account.id,
          idempotencyKeyId,
        });
        if (attempt.status !== 'RESERVED') throw new MarketplaceReservationBlockedError(attempt);
        executionState.reservedAttempt = attempt;
      },
      execute: async () => {
        let currentExternalListingId = preparedAttempt.externalListingId!;
        return dispatchWithWorkspaceCapability(
          {
            workspaceId: params.workspaceId,
            capability: 'MARKETPLACE_PUBLICATION',
            stage: 'DISPATCH',
            beforeDispatch: async () => {
              const state = await assertPublishDispatchState({
                workspaceId: params.workspaceId,
                listingVersionId: params.listingVersionId,
                approvalRequestId: params.approvalRequestId,
                preparedAttemptId: preparedAttempt.id,
                marketplace: preparedAttempt.marketplace,
                marketplaceAccountId: account.id,
              });
              currentExternalListingId = state.preparedAttempt.externalListingId!;
            },
          },
          () => fetchMockPublishListing(currentExternalListingId),
        );
      },
      onExecutionSuccess: () => {
        providerSucceeded = true;
      },
    });
    providerSucceeded = true;

    if (published.replayed) {
      let originalAttempt = await prisma.publicationAttempt.findFirst({
        where: {
          idempotencyKeyId: published.idempotencyKeyId,
          status: 'PUBLISHED',
          listingVersionId: params.listingVersionId,
          marketplaceAccountId: account.id,
          marketplace: preparedAttempt.marketplace,
          listingVersion: { listing: { workspaceId: params.workspaceId } },
          marketplaceAccount: { workspaceId: params.workspaceId },
        },
        orderBy: { completedAt: 'asc' },
      });
      if (!originalAttempt) {
        const reservedAttempt = await prisma.publicationAttempt.findFirst({
          where: {
            idempotencyKeyId: published.idempotencyKeyId,
            status: 'RESERVED',
            listingVersionId: params.listingVersionId,
            marketplaceAccountId: account.id,
            marketplace: preparedAttempt.marketplace,
            listingVersion: { listing: { workspaceId: params.workspaceId } },
            marketplaceAccount: { workspaceId: params.workspaceId },
          },
        });
        if (!reservedAttempt) {
          throw new MarketplaceReplayUnavailableError(
            'Marketplace publication replay is unavailable',
          );
        }
        originalAttempt = await prisma.publicationAttempt.update({
          where: {
            id: reservedAttempt.id,
            status: 'RESERVED',
            idempotencyKeyId: published.idempotencyKeyId,
          },
          data: {
            status: 'PUBLISHED',
            blockedReason: null,
            externalListingId: published.result.externalListingId,
            externalListingUrl: published.result.externalListingUrl,
            idempotencyKeyId: published.idempotencyKeyId,
            completedAt: new Date(),
          },
        });
        await prisma.approvalRequest
          .update({
            where: { id: approvalRequest.id },
            data: {
              executedAt: new Date(),
              executionSuccess: true,
              executionResult: {
                externalListingId: published.result.externalListingId,
                externalListingUrl: published.result.externalListingUrl,
              },
            },
          })
          .catch(() => undefined);
      }
      await prisma.publicationAttempt.create({
        data: {
          listingVersionId: params.listingVersionId,
          marketplace: preparedAttempt.marketplace,
          marketplaceAccountId: account.id,
          status: 'IDEMPOTENT_REPLAY',
          blockedReason: null,
          externalListingId: originalAttempt.externalListingId,
          externalListingUrl: originalAttempt.externalListingUrl,
          idempotencyKeyId: published.idempotencyKeyId,
          completedAt: new Date(),
        },
      });
      return {
        publicationAttemptId: originalAttempt.id,
        status: originalAttempt.status,
        blockedReason: originalAttempt.blockedReason,
        externalListingId: originalAttempt.externalListingId,
        externalListingUrl: originalAttempt.externalListingUrl,
        replayed: true,
      };
    }

    const reservedAttempt = executionState.reservedAttempt;
    if (!reservedAttempt) throw new Error('Marketplace publication reservation is unavailable');
    const attempt = await prisma.publicationAttempt.update({
      where: {
        id: reservedAttempt.id,
        status: 'RESERVED',
        idempotencyKeyId: published.idempotencyKeyId,
      },
      data: {
        status: 'PUBLISHED',
        blockedReason: null,
        externalListingId: published.result.externalListingId,
        externalListingUrl: published.result.externalListingUrl,
        idempotencyKeyId: published.idempotencyKeyId,
        completedAt: new Date(),
      },
    });

    await prisma.approvalRequest
      .update({
        where: { id: approvalRequest.id },
        data: {
          executedAt: new Date(),
          executionSuccess: true,
          executionResult: {
            externalListingId: published.result.externalListingId,
            externalListingUrl: published.result.externalListingUrl,
          },
        },
      })
      .catch(() => undefined);

    await Promise.resolve(
      writeMarketplaceHealth(params.workspaceId, preparedAttempt.marketplace, account.mode, {
        healthy: true,
        message: `Published (mock): ${published.result.externalListingUrl}`,
      }),
    ).catch(() => undefined);

    return {
      publicationAttemptId: attempt.id,
      status: attempt.status,
      blockedReason: null,
      externalListingId: published.result.externalListingId,
      externalListingUrl: published.result.externalListingUrl,
    };
  } catch (err) {
    if (err instanceof MarketplaceReplayUnavailableError) throw err;
    if (providerSucceeded) throw err;
    if (err instanceof MarketplaceReservationBlockedError) {
      return {
        publicationAttemptId: err.attempt.id,
        status: err.attempt.status,
        blockedReason: err.attempt.blockedReason,
        externalListingId: null,
        externalListingUrl: null,
      };
    }
    if (isCapabilityPolicyDeniedError(err)) {
      const reservedAttempt = executionState.reservedAttempt;
      if (!reservedAttempt) throw err;
      await prisma.publicationAttempt.update({
        where: { id: reservedAttempt.id },
        data: {
          status: 'BLOCKED_POLICY',
          blockedReason: 'Operation is not available',
          completedAt: new Date(),
        },
      });
      throw err;
    }
    const reservedAttempt = executionState.reservedAttempt;
    if (!reservedAttempt) throw err;
    const message = 'Marketplace publication operation failed';
    const attempt = await prisma.publicationAttempt.update({
      where: { id: reservedAttempt.id },
      data: {
        status: 'FAILED',
        errorMessage: message,
        completedAt: new Date(),
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
