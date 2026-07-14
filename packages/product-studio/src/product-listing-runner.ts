import { prisma } from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import type { StorageProvider } from '@ventureos/integrations';
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

/**
 * Generates (or regenerates) a Product for a VentureProposal. Fails closed
 * (ProductGenerationBlockedError) if the proposal has no founder-approved
 * (APPROVED / APPROVED_WITH_CONDITIONS) Phase 3 ApprovalRequest -- product
 * generation must never run before that gate, matching the master spec's
 * workflow ordering.
 */
export async function generateProduct(
  params: GenerateProductParams,
): Promise<GenerateProductResult> {
  const proposal = await prisma.ventureProposal.findFirst({
    where: { id: params.ventureProposalId, workspaceId: params.workspaceId },
    include: {
      opportunity: true,
      versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 },
    },
  });
  if (!proposal) throw new ProductNotFoundError('Venture proposal not found');

  const approved = await prisma.approvalRequest.findFirst({
    where: {
      ventureProposalId: proposal.id,
      kind: 'VENTURE_PROPOSAL',
      state: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS'] },
    },
    orderBy: { createdAt: 'desc' as const },
  });
  if (!approved) {
    throw new ProductGenerationBlockedError(
      'Venture proposal has no founder-approved ApprovalRequest; product generation is blocked until the Phase 3 approval gate is passed.',
    );
  }

  const latestVersion = proposal.versions[0];
  if (!latestVersion) throw new ProductNotFoundError('Venture proposal has no versions');

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
  const { assetVersionIds } = await generateProductAssets(genInput, params.storageProvider);

  await prisma.product.update({ where: { id: product.id }, data: { status: 'GENERATED' } });

  const qaResult = await runQualityChecks(productVersion.id);
  await persistQualityChecks(productVersion.id, qaResult);

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

  const seo = await runSeoEvaluation(listingVersion.id);
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

  const bundleHash = hashObject({
    assetVersionIds: [...latestPackage.assetVersionIds].sort(),
    listing: {
      title: listingVersion.title,
      description: listingVersion.description,
      tags: [...listingVersion.tags].sort(),
      priceEur: listingVersion.priceEur.toString(),
    },
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
