import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { MockStorageProvider } from '@ventureos/integrations';
import {
  createApprovalRequest,
  decideApprovalRequest,
  ApprovalInvalidForExecutionError,
} from '@ventureos/agent-runtime';
import {
  generateProduct,
  generateListingAndApprovalRequest,
  ProductGenerationBlockedError,
  ListingGenerationBlockedError,
} from '@ventureos/product-studio';
import { entitleTestWorkspace } from './helpers/entitled-workspace';

/**
 * Hits a real (dockerized) Postgres, exactly like
 * board-and-approval.integration.spec.ts. Calls the plain product-studio
 * functions directly (never through Temporal -- same approach Phase 3 used
 * for runBoardReview/createApprovalRequest/decideApprovalRequest) so this
 * suite exercises the real fail-closed gates, real MinIO-shaped uploads (via
 * MockStorageProvider so no live MinIO is required), real QA persistence,
 * and the PRODUCT_LISTING branch of decideApprovalRequest's hash-binding
 * re-validation.
 */
describe('Product generation + listing + second approval gate (integration)', () => {
  const storageProvider = new MockStorageProvider();
  let workspace: { id: string };
  let actor: { id: string };
  let approvedProposal: { id: string };
  let unapprovedProposal: { id: string };

  async function createOpportunityAndProposal(suffix: string) {
    const opp = await prisma.opportunity.create({
      data: {
        workspaceId: workspace.id,
        title: `Product Test Opportunity ${suffix}`,
        description: 'Created by product-and-listing.integration.spec.ts',
        status: 'PROMOTED',
        suggestedProductType: 'DIGITAL_TEMPLATE_BUNDLE',
        suggestedMarketplace: 'etsy',
        latestOpportunityScore: 90,
        latestProfitConfidence: 85,
        isSpeculative: false,
        estimatedCostEur: 50,
        estimatedRevenueEur: 900,
        estimatedProfitEur: 850,
        risks: [],
      },
    });
    const proposal = await prisma.ventureProposal.create({
      data: { workspaceId: workspace.id, opportunityId: opp.id, status: 'DRAFT' },
    });
    await prisma.ventureProposalVersion.create({
      data: {
        ventureProposalId: proposal.id,
        opportunityId: opp.id,
        versionNumber: 1,
        snapshot: { note: 'v' + randomUUID() },
      },
    });
    return { opp, proposal };
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: { name: `Test Workspace ${randomUUID()}`, slug: `test-product-${randomUUID()}` },
    });
    await entitleTestWorkspace(workspace.id);
    actor = await prisma.user.create({
      data: {
        email: `product-integration-actor-${randomUUID()}@ventureos.local`,
        displayName: 'Product Integration Test Actor',
      },
    });

    const approved = await createOpportunityAndProposal('approved');
    approvedProposal = approved.proposal;

    // Pass the Phase 3 gate for this proposal so generateProduct is allowed.
    const request = await createApprovalRequest({
      workspaceId: workspace.id,
      ventureProposalId: approvedProposal.id,
      requestedBy: actor.id,
    });
    await decideApprovalRequest({
      workspaceId: workspace.id,
      approvalRequestId: request.id,
      founderIdentity: actor.id,
      decision: 'APPROVE',
    });

    const unapproved = await createOpportunityAndProposal('unapproved');
    unapprovedProposal = unapproved.proposal;
  });

  afterAll(async () => {
    const proposalIds = [approvedProposal.id, unapprovedProposal.id];
    const planKey = `INTEGRATION_TEST_${workspace.id}`;
    const listingVersionScope = {
      listing: { product: { ventureProposalId: { in: proposalIds } } },
    };
    const productVersionScope = {
      product: { ventureProposalId: { in: proposalIds } },
    };

    // Layer 1: independent leaves. Each relation points only to a parent that
    // remains present until a later layer.
    await Promise.all([
      prisma.publicationAttempt.deleteMany({
        where: {
          listingVersion: { listing: { product: { ventureProposalId: { in: proposalIds } } } },
        },
      }),
      prisma.sEOEvaluation.deleteMany({
        where: {
          listingVersion: { listing: { product: { ventureProposalId: { in: proposalIds } } } },
        },
      }),
      prisma.priceProposal.deleteMany({
        where: {
          listingVersion: { listing: { product: { ventureProposalId: { in: proposalIds } } } },
        },
      }),
      prisma.listingImage.deleteMany({
        where: {
          listingVersion: { listing: { product: { ventureProposalId: { in: proposalIds } } } },
        },
      }),
      prisma.listingFile.deleteMany({
        where: {
          listingVersion: { listing: { product: { ventureProposalId: { in: proposalIds } } } },
        },
      }),
      prisma.approvalDecision.deleteMany({
        where: { approvalRequest: { ventureProposalId: { in: proposalIds } } },
      }),
      prisma.licenceRecord.deleteMany({ where: { productVersion: productVersionScope } }),
      prisma.qualityCheckResult.deleteMany({
        where: {
          qualityCheck: {
            productVersion: { product: { ventureProposalId: { in: proposalIds } } },
          },
        },
      }),
    ]);

    // Layer 2: direct parents of the approval and QA leaves.
    await Promise.all([
      prisma.approvalRequest.deleteMany({
        where: { workspaceId: workspace.id, ventureProposalId: { in: proposalIds } },
      }),
      prisma.qualityCheck.deleteMany({ where: { productVersion: productVersionScope } }),
    ]);

    // ProductPackage references ListingVersion with onDelete: SetNull, so
    // remove packages first rather than racing the two sides of that FK.
    await prisma.productPackage.deleteMany({ where: { productVersion: productVersionScope } });

    // Layer 3: listing versions and asset versions are now independent: all
    // attachment rows, licences, approvals, packages, and QA rows are absent.
    await Promise.all([
      prisma.listingVersion.deleteMany({ where: listingVersionScope }),
      prisma.productAssetVersion.deleteMany({
        where: { productAsset: { productVersion: productVersionScope } },
      }),
    ]);

    // Layer 4: independent direct children of ProductVersion.
    await Promise.all([
      prisma.listing.deleteMany({
        where: {
          workspaceId: workspace.id,
          product: { ventureProposalId: { in: proposalIds } },
        },
      }),
      prisma.productAsset.deleteMany({ where: { productVersion: productVersionScope } }),
      prisma.productBrief.deleteMany({ where: { productVersion: productVersionScope } }),
    ]);

    await prisma.productVersion.deleteMany({
      where: { product: { ventureProposalId: { in: proposalIds } } },
    });
    await prisma.product.deleteMany({
      where: { workspaceId: workspace.id, ventureProposalId: { in: proposalIds } },
    });
    await prisma.ventureProposalVersion.deleteMany({
      where: { ventureProposalId: { in: proposalIds } },
    });
    await prisma.ventureProposal.deleteMany({
      where: { workspaceId: workspace.id, id: { in: proposalIds } },
    });
    await prisma.opportunity.deleteMany({ where: { workspaceId: workspace.id } });

    // Fold cleanupEntitledTestWorkspace's three queries into the suite cleanup
    // so independent workspace leaves are deleted together.
    await Promise.all([
      prisma.securityEvent.deleteMany({ where: { workspaceId: workspace.id } }),
      prisma.subscription.deleteMany({ where: { workspaceId: workspace.id } }),
    ]);
    await Promise.all([
      prisma.plan.deleteMany({ where: { key: planKey } }),
      prisma.user.deleteMany({ where: { id: actor.id } }),
    ]);
    await prisma.workspace.deleteMany({ where: { id: workspace.id } });
    await prisma.$disconnect();
  });

  it('blocks product generation when the venture proposal has no founder-approved Phase 3 ApprovalRequest', async () => {
    await expect(
      generateProduct({
        workspaceId: workspace.id,
        ventureProposalId: unapprovedProposal.id,
        storageProvider,
      }),
    ).rejects.toThrow(ProductGenerationBlockedError);
  });

  it('generates real assets, passes QA, and reaches QA_PASSED once the Phase 3 gate is satisfied', async () => {
    const result = await generateProduct({
      workspaceId: workspace.id,
      ventureProposalId: approvedProposal.id,
      storageProvider,
    });
    expect(result.qaPassed).toBe(true);

    const product = await prisma.product.findUnique({ where: { id: result.productId } });
    expect(product?.status).toBe('QA_PASSED');

    const assets = await prisma.productAsset.findMany({
      where: { productVersionId: result.productVersionId },
    });
    // 6 distinct kinds, with PREVIEW_IMAGE appearing twice (7 asset rows total).
    expect(assets).toHaveLength(7);

    const licenceRecords = await prisma.licenceRecord.findMany({
      where: { productVersionId: result.productVersionId },
    });
    expect(licenceRecords).toHaveLength(1);
  });

  it('blocks listing generation unless the product status is QA_PASSED', async () => {
    // A product that exists but hasn't reached QA_PASSED (simulating a
    // regeneration still in progress) must not be allowed to generate a
    // listing -- this is Gate 3 from the master spec workflow, enforced
    // server-side regardless of what the UI shows.
    const product = await prisma.product.findFirst({
      where: { ventureProposalId: approvedProposal.id },
    });
    if (!product) throw new Error('test setup: product not found');
    await prisma.product.update({ where: { id: product.id }, data: { status: 'GENERATED' } });
    try {
      await expect(
        generateListingAndApprovalRequest({
          workspaceId: workspace.id,
          productId: product.id,
          requestedBy: actor.id,
        }),
      ).rejects.toThrow(ListingGenerationBlockedError);
    } finally {
      await prisma.product.update({ where: { id: product.id }, data: { status: 'QA_PASSED' } });
    }
  });

  it('generates a listing, records an always-blocked PublicationAttempt, and creates a PRODUCT_LISTING approval request', async () => {
    const product = await prisma.product.findFirst({
      where: { ventureProposalId: approvedProposal.id },
    });
    if (!product) throw new Error('test setup: product not found');

    const result = await generateListingAndApprovalRequest({
      workspaceId: workspace.id,
      productId: product.id,
      requestedBy: actor.id,
    });
    expect(result.approvalRequestId).toBeTruthy();
    expect(result.seoScore).toBeGreaterThanOrEqual(0);

    const approvalRequest = await prisma.approvalRequest.findUnique({
      where: { id: result.approvalRequestId },
    });
    expect(approvalRequest?.kind).toBe('PRODUCT_LISTING');
    expect(approvalRequest?.state).toBe('PENDING');

    // Non-publication must be a checkable fact, not an assumption (master
    // spec): real marketplace integration is Phase 6, gated on founder
    // approval, and Phase 4 must never publish.
    const publicationAttempt = await prisma.publicationAttempt.findFirst({
      where: { listingVersionId: result.listingVersionId },
    });
    expect(publicationAttempt?.status).toBe('BLOCKED_NO_LIVE_INTEGRATION');
    expect(publicationAttempt?.blockedReason).toBeTruthy();
  });

  it('invalidates a pending PRODUCT_LISTING approval request when the listing is regenerated before the founder decides, and approves the fresh one', async () => {
    const product = await prisma.product.findFirst({
      where: { ventureProposalId: approvedProposal.id },
    });
    if (!product) throw new Error('test setup: product not found');

    // A still-pending PRODUCT_LISTING request exists from the previous test.
    // Regenerating the listing now creates a newer ProductPackage bound to a
    // new ListingVersion -- exactly the drift signal
    // isApprovalValidForExecution is built to catch.
    const stalePending = await prisma.approvalRequest.findFirst({
      where: {
        ventureProposalId: approvedProposal.id,
        kind: 'PRODUCT_LISTING',
        state: 'PENDING',
      },
      orderBy: { createdAt: 'desc' as const },
    });
    if (!stalePending) throw new Error('test setup: expected a pending PRODUCT_LISTING request');

    const regenerated = await generateListingAndApprovalRequest({
      workspaceId: workspace.id,
      productId: product.id,
      requestedBy: actor.id,
    });

    await expect(
      decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId: stalePending.id,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      }),
    ).rejects.toThrow(ApprovalInvalidForExecutionError);

    const reloadedStale = await prisma.approvalRequest.findUnique({
      where: { id: stalePending.id },
    });
    expect(reloadedStale?.state).toBe('EXPIRED');

    const { approvalRequest, decision } = await decideApprovalRequest({
      workspaceId: workspace.id,
      approvalRequestId: regenerated.approvalRequestId,
      founderIdentity: actor.id,
      decision: 'APPROVE',
    });
    expect(approvalRequest.state).toBe('APPROVED');
    expect(decision.decision).toBe('APPROVE');
  });
});
