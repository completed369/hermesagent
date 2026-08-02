import {
  dispatchWithWorkspaceCapability,
  enforceWorkspaceCapability,
  prisma,
} from '@ventureos/database';
import { hashObject, hashProductListingBundle } from '@ventureos/security';
import type { StorageProvider } from '@ventureos/integrations';
import { isApprovalValidForExecution } from '@ventureos/contracts';
import {
  generateProductAssets,
  targetAssetKinds,
  type ProductGenerationInput,
} from './mock-product-generator.js';
import { runQualityChecks, persistQualityChecks } from './qa-checker.js';
import { generateListing } from './listing-generator.js';
import { runSeoEvaluation } from './seo-evaluator.js';

export class ProductNotFoundError extends Error {}
export class ProductGenerationBlockedError extends Error {}
export class ListingGenerationBlockedError extends Error {}

export interface GenerateProductParams {
  workspaceId: string;
  ventureProposalId: string;
  storageProvider: StorageProvider;
}

export interface GenerateProductResult {
  productId: string;
  productVersionId: string;
  qaPassed: boolean;
}

async function getApprovedVentureProposal(workspaceId: string, ventureProposalId: string) {
  const proposal = await prisma.ventureProposal.findFirst({
    where: { id: ventureProposalId, workspaceId },
    include: {
      opportunity: true,
      versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 },
    },
  });
  if (!proposal) throw new ProductNotFoundError('Venture proposal not found');

  const latestVersion = proposal.versions[0];
  if (!latestVersion) throw new ProductNotFoundError('Venture proposal has no versions');

  const approvalRequest = await prisma.approvalRequest.findFirst({
    where: {
      ventureProposalId: proposal.id,
      kind: 'VENTURE_PROPOSAL',
      state: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS'] },
    },
    orderBy: { createdAt: 'desc' as const },
  });
  if (!approvalRequest) {
    throw new ProductGenerationBlockedError(
      'Venture proposal has no current founder approval; product generation is blocked.',
    );
  }

  const decision = await prisma.approvalDecision.findFirst({
    where: {
      approvalRequestId: approvalRequest.id,
      decision: { in: ['APPROVE', 'APPROVE_WITH_CONDITIONS'] },
    },
    orderBy: { decidedAt: 'desc' as const },
  });
  const validity = decision
    ? isApprovalValidForExecution(
        {
          approvedArtifactVersionId: decision.approvedArtifactVersionId,
          approvedPackageHash: decision.approvedPackageHash,
          expiresAt: decision.expiresAt.toISOString(),
        },
        {
          artifactVersionId: latestVersion.id,
          packageHash: hashObject(latestVersion.snapshot),
        },
      )
    : { valid: false };
  if (!validity.valid) {
    throw new ProductGenerationBlockedError(
      'Venture proposal approval is missing, stale, or expired; product generation is blocked.',
    );
  }

  return { proposal, latestVersion };
}

/**
 * Generates (or regenerates) a Product for a VentureProposal. Fails closed
 * (ProductGenerationBlockedError) unless a persisted approving decision is
 * current, unexpired, and bound to the latest proposal version and snapshot.
 * The binding is revalidated again at the final provider boundary.
 */
export async function generateProduct(
  params: GenerateProductParams,
): Promise<GenerateProductResult> {
  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'PRODUCT_GENERATION',
    stage: 'DISPATCH',
    providerMode: 'mock',
  });
  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'STORAGE_UPLOAD',
    stage: 'DISPATCH',
    providerMode: params.storageProvider.mode,
  });

  const { proposal, latestVersion } = await getApprovedVentureProposal(
    params.workspaceId,
    params.ventureProposalId,
  );

  const product = await prisma.product.upsert({
    where: { ventureProposalId: proposal.id },
    update: { status: 'GENERATING' },
    create: {
      workspaceId: params.workspaceId,
      ventureProposalId: proposal.id,
      title: proposal.opportunity.title,
      status: 'GENERATING',
    },
  });

  const existingVersions = await prisma.productVersion.count({ where: { productId: product.id } });
  const productVersion = await prisma.productVersion.create({
    data: { productId: product.id, versionNumber: existingVersions + 1 },
  });

  const productType = proposal.opportunity.suggestedProductType ?? 'DIGITAL_TEMPLATE_BUNDLE';
  await prisma.productBrief.create({
    data: {
      productVersionId: productVersion.id,
      productType,
      targetAssetKinds: targetAssetKinds(),
      sourceSnapshot: latestVersion.snapshot as object,
    },
  });

  const genInput: ProductGenerationInput = {
    workspaceId: params.workspaceId,
    productVersionId: productVersion.id,
    opportunityTitle: proposal.opportunity.title,
    productType,
    suggestedMarketplace: proposal.opportunity.suggestedMarketplace,
  };
  const { assetVersionIds } = await dispatchWithWorkspaceCapability(
    {
      workspaceId: params.workspaceId,
      capability: 'PRODUCT_GENERATION',
      stage: 'DISPATCH',
      providerMode: 'mock',
      beforeFinalCheck: async () => {
        await getApprovedVentureProposal(params.workspaceId, params.ventureProposalId);
      },
    },
    () => generateProductAssets(genInput, params.storageProvider),
  );

  await prisma.product.update({ where: { id: product.id }, data: { status: 'GENERATED' } });

  const qaResult = await runQualityChecks(params.workspaceId, productVersion.id);
  await persistQualityChecks(params.workspaceId, productVersion.id, qaResult);

  await prisma.product.update({
    where: { id: product.id },
    data: { status: qaResult.overallPassed ? 'QA_PASSED' : 'QA_FAILED' },
  });

  const packageHash = hashObject({ assetVersionIds: [...assetVersionIds].sort() });
  await prisma.productPackage.create({
    data: {
      productVersionId: productVersion.id,
      packageHash,
      assetVersionIds,
    },
  });

  return {
    productId: product.id,
    productVersionId: productVersion.id,
    qaPassed: qaResult.overallPassed,
  };
}

export interface GenerateListingAndApprovalParams {
  workspaceId: string;
  productId: string;
  requestedBy: string;
  expiresInHours?: number;
  /** Temporal workflowId, so ApprovalsService can signal this workflow back
   * on founder decision (same pattern as Phase 3's founderDecision signal). */
  workflowId?: string;
}

export interface GenerateListingAndApprovalResult {
  listingId: string;
  listingVersionId: string;
  seoScore: number;
  approvalRequestId: string;
}

/**
 * Generates the mock Etsy listing for the CURRENT ProductVersion (blocked
 * unless QA already passed), runs SEO evaluation, records an always-blocked
 * PublicationAttempt (Phase 4 never actually publishes -- real marketplace
 * integration is Phase 6, gated on founder approval), bundles the listing
 * into a new hashed ProductPackage, and creates the second founder
 * ApprovalRequest (kind PRODUCT_LISTING).
 */
export async function generateListingAndApprovalRequest(
  params: GenerateListingAndApprovalParams,
): Promise<GenerateListingAndApprovalResult> {
  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'PRODUCT_GENERATION',
    stage: 'DISPATCH',
    providerMode: 'mock',
  });

  const product = await prisma.product.findFirst({
    where: { id: params.productId, workspaceId: params.workspaceId },
    include: {
      ventureProposal: { include: { opportunity: true } },
      versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 },
    },
  });
  if (!product) throw new ProductNotFoundError('Product not found');
  if (product.status !== 'QA_PASSED') {
    throw new ListingGenerationBlockedError(
      `Listing generation is blocked: product status is ${product.status}, expected QA_PASSED.`,
    );
  }

  const productVersion = product.versions[0];
  if (!productVersion) throw new ProductNotFoundError('Product has no versions');

  const opportunity = product.ventureProposal.opportunity;
  const { listing, listingVersion } = await generateListing({
    workspaceId: params.workspaceId,
    productId: product.id,
    productVersionId: productVersion.id,
    opportunityTitle: opportunity.title,
    opportunityDescription: opportunity.description,
    suggestedProductType: opportunity.suggestedProductType,
    estimatedRevenueEur: opportunity.estimatedRevenueEur
      ? Number(opportunity.estimatedRevenueEur)
      : null,
  });

  const seo = await runSeoEvaluation(params.workspaceId, listingVersion.id);
  await prisma.listing.update({ where: { id: listing.id }, data: { status: 'SEO_EVALUATED' } });

  // Phase 4 explicitly never publishes -- record the blocked attempt as a
  // checkable fact, not an assumption (master spec: real marketplace
  // integration only exists from Phase 6 onward, gated on founder approval).
  await prisma.publicationAttempt.create({
    data: {
      listingVersionId: listingVersion.id,
      marketplace: listing.marketplace,
      status: 'BLOCKED_NO_LIVE_INTEGRATION',
      blockedReason:
        'Real marketplace integration is Phase 6 scope, gated on explicit founder approval of a live account. No publication may occur in Phase 4.',
    },
  });

  const latestPackage = await prisma.productPackage.findFirst({
    where: { productVersionId: productVersion.id },
    orderBy: { createdAt: 'desc' as const },
  });
  if (!latestPackage) {
    throw new ProductNotFoundError('Product has no package; run product generation first');
  }

  const listingPackageSnapshot = await prisma.listingVersion.findUnique({
    where: { id: listingVersion.id },
    select: {
      title: true,
      description: true,
      tags: true,
      category: true,
      currency: true,
      priceEur: true,
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
  });
  if (!listingPackageSnapshot) {
    throw new ProductNotFoundError('Listing version is unavailable for packaging');
  }

  const bundleHash = hashProductListingBundle({
    assetVersionIds: latestPackage.assetVersionIds,
    listing: listingPackageSnapshot,
    images: listingPackageSnapshot.images,
    files: listingPackageSnapshot.files,
  });
  const bundlePackage = await prisma.productPackage.create({
    data: {
      productVersionId: productVersion.id,
      listingVersionId: listingVersion.id,
      packageHash: bundleHash,
      assetVersionIds: latestPackage.assetVersionIds,
    },
  });

  const ventureProposal = product.ventureProposal;
  const proposalVersion = await prisma.ventureProposalVersion.findFirst({
    where: { ventureProposalId: ventureProposal.id },
    orderBy: { versionNumber: 'desc' as const },
  });
  if (!proposalVersion) throw new ProductNotFoundError('Venture proposal has no versions');

  const expiresAt = new Date(Date.now() + (params.expiresInHours ?? 168) * 60 * 60 * 1000);
  const approvalRequest = await prisma.approvalRequest.create({
    data: {
      workspaceId: params.workspaceId,
      ventureProposalId: ventureProposal.id,
      ventureProposalVersionId: proposalVersion.id,
      kind: 'PRODUCT_LISTING',
      productPackageId: bundlePackage.id,
      requestedAction: `Approve product + listing bundle for "${opportunity.title}" (${listing.marketplace}, draft-only)`,
      explanation:
        'Product generated and QA-passed; listing drafted and SEO-evaluated. Founder approval is required before any further action -- no publication has occurred and none will occur until Phase 6.',
      affectedResources: [
        `Product:${product.id}`,
        `Listing:${listing.id}`,
        `ListingVersion:${listingVersion.id}`,
      ],
      packageHash: bundleHash,
      estimatedCostEur: opportunity.estimatedCostEur ?? 0,
      maxAuthorizedCostEur: opportunity.estimatedCostEur ?? 0,
      reversible: true,
      risks: opportunity.risks,
      evidenceIds: [],
      state: 'PENDING',
      requestedBy: params.requestedBy,
      workflowId: params.workflowId,
      expiresAt,
    },
  });

  return {
    listingId: listing.id,
    listingVersionId: listingVersion.id,
    seoScore: seo.score,
    approvalRequestId: approvalRequest.id,
  };
}
