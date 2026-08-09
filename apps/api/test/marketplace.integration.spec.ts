import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { decideApprovalRequest } from '@ventureos/agent-runtime';
import { hashProductListingBundle } from '@ventureos/security';
import {
  prepareListingForPublication,
  requestPublicationApproval,
  publishListing,
  MarketplaceBlockedError,
} from '@ventureos/marketplace-connectors';
import { MarketplaceService } from '../src/modules/marketplace/marketplace.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { entitleTestWorkspace } from './helpers/entitled-workspace';

/**
 * Hits a real (dockerized) Postgres, exactly like
 * product-and-listing.integration.spec.ts -- run with
 * `pnpm --filter @ventureos/api test:integration`. Exercises the full Phase 6
 * flow end to end (prepare -> PUBLICATION approval -> publish) plus the three
 * things that were still only code-reviewed, not test-verified, going into
 * this suite: idempotent/fail-closed reconciliation behaviour (task #69),
 * the audit trail (task #70), and the mock/real UI's data source
 * (marketplace.service.ts's STATUS_INCLUDE).
 */
describe('Marketplace Pilot: prepare -> PUBLICATION approval -> publish (integration)', () => {
  const auditService = new AuditService();
  const marketplaceService = new MarketplaceService(auditService);

  let workspace: { id: string };
  let noApprovalWorkspace: { id: string };
  let disabledWorkspace: { id: string };
  let actor: { id: string };
  let mainListingVersionId: string;

  /**
   * Creates the minimal persisted state at the Phase 6 boundary. The upstream
   * product-generation, QA, listing-generation, and PRODUCT_LISTING
   * hash-binding paths are exercised end-to-end in
   * product-and-listing.integration.spec.ts; this suite starts at marketplace
   * preparation and keeps each marketplace security scenario isolated.
   */
  async function createMarketplaceScenario(
    workspaceId: string,
    suffix: string,
    productListingApproved: boolean,
  ) {
    const opportunityId = randomUUID();
    const proposalId = randomUUID();
    const proposalVersionId = randomUUID();
    const productId = randomUUID();
    const productVersionId = randomUUID();
    const listingId = randomUUID();
    const listingVersionId = randomUUID();
    const productPackageId = randomUUID();
    const productListingApprovalId = randomUUID();
    const listing = {
      title: `Marketplace Test Listing ${suffix}`,
      description: 'Synthetic marketplace integration fixture',
      tags: ['marketplace', 'test'],
      category: 'Digital Prints & Templates',
      currency: 'EUR',
      priceEur: 9.99,
    };
    const packageHash = hashProductListingBundle({
      assetVersionIds: [],
      listing,
      images: [],
      files: [],
    });
    const approvalExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.opportunity.create({
        data: {
          id: opportunityId,
          workspaceId,
          title: `Marketplace Test Opportunity ${suffix}`,
          description: 'Created by marketplace.integration.spec.ts',
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
      }),
      prisma.ventureProposal.create({
        data: { id: proposalId, workspaceId, opportunityId, status: 'APPROVED' },
      }),
      prisma.ventureProposalVersion.create({
        data: {
          id: proposalVersionId,
          ventureProposalId: proposalId,
          opportunityId,
          versionNumber: 1,
          snapshot: { note: `marketplace-${suffix}` },
        },
      }),
      prisma.product.create({
        data: {
          id: productId,
          workspaceId,
          ventureProposalId: proposalId,
          title: `Marketplace Test Product ${suffix}`,
          status: 'QA_PASSED',
        },
      }),
      prisma.productVersion.create({
        data: { id: productVersionId, productId, versionNumber: 1 },
      }),
      prisma.listing.create({
        data: {
          id: listingId,
          workspaceId,
          productId,
          productVersionId,
          marketplace: 'etsy',
          status: 'SEO_EVALUATED',
        },
      }),
      prisma.listingVersion.create({
        data: {
          id: listingVersionId,
          listingId,
          versionNumber: 1,
          ...listing,
        },
      }),
      prisma.productPackage.create({
        data: {
          id: productPackageId,
          productVersionId,
          listingVersionId,
          packageHash,
          assetVersionIds: [],
        },
      }),
      prisma.approvalRequest.create({
        data: {
          id: productListingApprovalId,
          workspaceId,
          ventureProposalId: proposalId,
          ventureProposalVersionId: proposalVersionId,
          kind: 'PRODUCT_LISTING',
          productPackageId,
          listingVersionId,
          requestedAction: `Approve marketplace fixture ${suffix}`,
          explanation: 'Synthetic approved Phase 4 boundary for marketplace integration tests.',
          affectedResources: [`Product:${productId}`, `ListingVersion:${listingVersionId}`],
          packageHash,
          estimatedCostEur: 0,
          maxAuthorizedCostEur: 0,
          reversible: true,
          risks: [],
          evidenceIds: [],
          state: productListingApproved ? 'APPROVED' : 'PENDING',
          requestedBy: actor.id,
          expiresAt: approvalExpiresAt,
        },
      }),
      ...(productListingApproved
        ? [
            prisma.approvalDecision.create({
              data: {
                approvalRequestId: productListingApprovalId,
                founderIdentity: actor.id,
                decidedAt: new Date(),
                decision: 'APPROVE',
                conditions: [],
                approvedArtifactVersionId: productPackageId,
                approvedPackageHash: packageHash,
                expiresAt: approvalExpiresAt,
                auditSignature: `marketplace-test-${productListingApprovalId}`,
              },
            }),
          ]
        : []),
    ]);

    return {
      listingVersionId,
      productListingApprovalId,
    };
  }

  async function cleanupWorkspaces(workspaceIds: string[]) {
    const planKeys = workspaceIds.map((workspaceId) => `INTEGRATION_TEST_${workspaceId}`);

    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.publicationAttempt.deleteMany({
      where: {
        listingVersion: { listing: { workspaceId: { in: workspaceIds } } },
      },
    });
    await prisma.approvalDecision.deleteMany({
      where: { approvalRequest: { workspaceId: { in: workspaceIds } } },
    });
    await prisma.approvalRequest.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.marketplaceAccount.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.listingImage.deleteMany({
      where: {
        listingVersion: { listing: { workspaceId: { in: workspaceIds } } },
      },
    });
    await prisma.listingFile.deleteMany({
      where: {
        listingVersion: { listing: { workspaceId: { in: workspaceIds } } },
      },
    });
    await prisma.priceProposal.deleteMany({
      where: {
        listingVersion: { listing: { workspaceId: { in: workspaceIds } } },
      },
    });
    await prisma.sEOEvaluation.deleteMany({
      where: {
        listingVersion: { listing: { workspaceId: { in: workspaceIds } } },
      },
    });
    await prisma.listingVersion.deleteMany({
      where: { listing: { workspaceId: { in: workspaceIds } } },
    });
    await prisma.listing.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.qualityCheckResult.deleteMany({
      where: {
        qualityCheck: { productVersion: { product: { workspaceId: { in: workspaceIds } } } },
      },
    });
    await prisma.qualityCheck.deleteMany({
      where: { productVersion: { product: { workspaceId: { in: workspaceIds } } } },
    });
    await prisma.licenceRecord.deleteMany({
      where: { productVersion: { product: { workspaceId: { in: workspaceIds } } } },
    });
    await prisma.productAssetVersion.deleteMany({
      where: {
        productAsset: { productVersion: { product: { workspaceId: { in: workspaceIds } } } },
      },
    });
    await prisma.productAsset.deleteMany({
      where: { productVersion: { product: { workspaceId: { in: workspaceIds } } } },
    });
    await prisma.productBrief.deleteMany({
      where: { productVersion: { product: { workspaceId: { in: workspaceIds } } } },
    });
    await prisma.productVersion.deleteMany({
      where: { product: { workspaceId: { in: workspaceIds } } },
    });
    await prisma.product.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.ventureProposalVersion.deleteMany({
      where: { ventureProposal: { workspaceId: { in: workspaceIds } } },
    });
    await prisma.ventureProposal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.opportunity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.integration.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.securityEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.plan.deleteMany({ where: { key: { in: planKeys } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }

  beforeAll(async () => {
    workspace = { id: randomUUID() };
    noApprovalWorkspace = { id: randomUUID() };
    disabledWorkspace = { id: randomUUID() };
    await prisma.workspace.createMany({
      data: [
        {
          id: workspace.id,
          name: `Marketplace Test Workspace ${randomUUID()}`,
          slug: `test-mkt-${randomUUID()}`,
        },
        {
          id: noApprovalWorkspace.id,
          name: `Marketplace Test Workspace (no approval) ${randomUUID()}`,
          slug: `test-mkt-noappr-${randomUUID()}`,
        },
        {
          id: disabledWorkspace.id,
          name: `Marketplace Test Workspace (disabled) ${randomUUID()}`,
          slug: `test-mkt-disabled-${randomUUID()}`,
        },
      ],
    });
    await Promise.all([
      entitleTestWorkspace(workspace.id),
      entitleTestWorkspace(noApprovalWorkspace.id),
      entitleTestWorkspace(disabledWorkspace.id),
    ]);
    actor = await prisma.user.create({
      data: {
        email: `marketplace-integration-actor-${randomUUID()}@ventureos.local`,
        displayName: 'Marketplace Integration Test Actor',
      },
    });
  });

  afterAll(async () => {
    await cleanupWorkspaces([workspace.id, noApprovalWorkspace.id, disabledWorkspace.id]);
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  describe('Stage 1: prepareListingForPublication', () => {
    it('persists a BLOCKED_NO_APPROVAL attempt when the PRODUCT_LISTING approval has not been decided', async () => {
      const { listingVersionId } = await createMarketplaceScenario(
        noApprovalWorkspace.id,
        'no-approval',
        false,
      );

      const result = await prepareListingForPublication({
        workspaceId: noApprovalWorkspace.id,
        listingVersionId,
      });

      expect(result.status).toBe('BLOCKED_NO_APPROVAL');
      expect(result.blockedReason).toBeTruthy();
      expect(result.externalListingId).toBeNull();
    });

    let firstExternalListingId: string;

    it('reaches READY_FOR_PUBLISH once the PRODUCT_LISTING approval is granted', async () => {
      const scenario = await createMarketplaceScenario(workspace.id, 'main', true);
      mainListingVersionId = scenario.listingVersionId;

      const approvedRequest = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: scenario.productListingApprovalId },
      });
      expect(approvedRequest).toMatchObject({
        workspaceId: workspace.id,
        kind: 'PRODUCT_LISTING',
        state: 'APPROVED',
        affectedResources: expect.arrayContaining([`ListingVersion:${scenario.listingVersionId}`]),
      });

      const result = await prepareListingForPublication({
        workspaceId: workspace.id,
        listingVersionId: mainListingVersionId,
      });

      expect(result.status).toBe('READY_FOR_PUBLISH');
      expect(result.externalListingId).toMatch(/^mock-etsy-listing-/);
      firstExternalListingId = result.externalListingId!;

      const account = await prisma.marketplaceAccount.findFirst({
        where: { workspaceId: workspace.id, marketplace: 'etsy' },
      });
      expect(account?.mode).toBe('MOCK');
    });

    it('is idempotent: re-preparing the same listing version replays the cached draft rather than creating a second one on the marketplace', async () => {
      const result = await prepareListingForPublication({
        workspaceId: workspace.id,
        listingVersionId: mainListingVersionId,
      });

      expect(result.status).toBe('READY_FOR_PUBLISH');
      // Same externalListingId as the first prepare call -- the underlying
      // withIdempotency call replayed the cached SUCCEEDED response instead
      // of calling fetchMockCreateDraftListing again.
      expect(result.externalListingId).toBe(firstExternalListingId);

      const draftKeys = await prisma.idempotencyKey.findMany({
        where: { workspaceId: workspace.id, key: `draft:${mainListingVersionId}` },
      });
      expect(draftKeys).toHaveLength(1);
      expect(draftKeys[0].status).toBe('SUCCEEDED');

      // Two PublicationAttempt rows now exist (prepare always records one),
      // both READY_FOR_PUBLISH -- never a silent no-op, per the fail-closed
      // logging discipline used everywhere else in this project.
      const attempts = await prisma.publicationAttempt.findMany({
        where: { listingVersionId: mainListingVersionId, status: 'READY_FOR_PUBLISH' },
      });
      expect(attempts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Fail-closed gating', () => {
    it('persists a BLOCKED_DISABLED attempt and never calls the mock marketplace when the account is disabled', async () => {
      const { listingVersionId } = await createMarketplaceScenario(
        disabledWorkspace.id,
        'disabled',
        true,
      );

      // Manually provision a disabled MOCK account for this workspace before
      // preparation runs, simulating a founder having flipped the kill
      // switch -- resolveMarketplaceAccount() must reuse this row (matched
      // on workspaceId+marketplace) rather than creating a fresh enabled one.
      const integration = await prisma.integration.upsert({
        where: { workspaceId_provider: { workspaceId: disabledWorkspace.id, provider: 'etsy' } },
        update: {},
        create: {
          workspaceId: disabledWorkspace.id,
          provider: 'etsy',
          mode: 'MOCK',
          writeEnabled: false,
        },
      });
      await prisma.marketplaceAccount.create({
        data: {
          workspaceId: disabledWorkspace.id,
          integrationId: integration.id,
          marketplace: 'etsy',
          mode: 'MOCK',
          disabled: true,
          disabledReason: 'Test: founder kill switch',
          connectedAt: new Date(),
        },
      });

      const result = await prepareListingForPublication({
        workspaceId: disabledWorkspace.id,
        listingVersionId,
      });

      expect(result.status).toBe('BLOCKED_DISABLED');
      expect(result.blockedReason).toBe('Test: founder kill switch');
      expect(result.externalListingId).toBeNull();

      // No draft was ever attempted -- confirms the fail-closed check runs
      // strictly before any (mock) external write, not just before the
      // persisted result is returned.
      const draftKeys = await prisma.idempotencyKey.findMany({
        where: { workspaceId: disabledWorkspace.id, key: `draft:${listingVersionId}` },
      });
      expect(draftKeys).toHaveLength(0);
    });
  });

  describe('Stage 1.5 + Stage 2: PUBLICATION approval + publish', () => {
    let listingVersionId: string;
    let approvalRequestId: string;

    beforeAll(async () => {
      listingVersionId = mainListingVersionId;
    });

    it('refuses to raise a PUBLICATION approval before a READY_FOR_PUBLISH attempt exists', async () => {
      const { listingVersionId: freshId } = await createMarketplaceScenario(
        workspace.id,
        'publish-flow-unprepared',
        true,
      );
      await expect(
        requestPublicationApproval({
          workspaceId: workspace.id,
          listingVersionId: freshId,
          requestedBy: actor.id,
        }),
      ).rejects.toThrow(MarketplaceBlockedError);
    });

    it('creates a distinct PUBLICATION approval request, idempotently', async () => {
      const first = await requestPublicationApproval({
        workspaceId: workspace.id,
        listingVersionId,
        requestedBy: actor.id,
      });
      approvalRequestId = first.approvalRequestId;

      const approvalRequest = await prisma.approvalRequest.findUnique({
        where: { id: approvalRequestId },
      });
      expect(approvalRequest?.kind).toBe('PUBLICATION');
      expect(approvalRequest?.state).toBe('PENDING');
      expect(approvalRequest?.listingVersionId).toBe(listingVersionId);

      // Calling again while still pending returns the SAME request rather
      // than raising a second one.
      const second = await requestPublicationApproval({
        workspaceId: workspace.id,
        listingVersionId,
        requestedBy: actor.id,
      });
      expect(second.approvalRequestId).toBe(approvalRequestId);
    });

    it('refuses to publish before the PUBLICATION approval is decided', async () => {
      await expect(
        publishListing({ workspaceId: workspace.id, listingVersionId, approvalRequestId }),
      ).rejects.toThrow(MarketplaceBlockedError);
    });

    it('publishes once the PUBLICATION approval is granted, recording the mock listing URL and executionSuccess on the ApprovalRequest', async () => {
      await decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      });

      const result = await publishListing({
        workspaceId: workspace.id,
        listingVersionId,
        approvalRequestId,
      });

      expect(result.status).toBe('PUBLISHED');
      expect(result.externalListingUrl).toMatch(/^https:\/\/mock\.etsy\.example\/listing\//);

      const approvalRequest = await prisma.approvalRequest.findUnique({
        where: { id: approvalRequestId },
      });
      expect(approvalRequest?.executionSuccess).toBe(true);
      expect(approvalRequest?.executedAt).toBeTruthy();
    });

    it('re-validates the approval hash at execution time: content drift after approval blocks publish and expires the approval', async () => {
      const scenario = await createMarketplaceScenario(workspace.id, 'publish-flow-drift', true);
      await prepareListingForPublication({
        workspaceId: workspace.id,
        listingVersionId: scenario.listingVersionId,
      });
      const { approvalRequestId: driftApprovalId } = await requestPublicationApproval({
        workspaceId: workspace.id,
        listingVersionId: scenario.listingVersionId,
        requestedBy: actor.id,
      });
      await decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId: driftApprovalId,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      });

      // Simulate the listing being edited after the founder approved it --
      // exactly the drift signal isApprovalValidForExecution is built to
      // catch (same pattern as Phase 4's regeneration test).
      await prisma.listingVersion.update({
        where: { id: scenario.listingVersionId },
        data: { title: 'Drifted title after approval' },
      });

      await expect(
        publishListing({
          workspaceId: workspace.id,
          listingVersionId: scenario.listingVersionId,
          approvalRequestId: driftApprovalId,
        }),
      ).rejects.toThrow(MarketplaceBlockedError);

      const reloaded = await prisma.approvalRequest.findUnique({
        where: { id: driftApprovalId },
      });
      expect(reloaded?.state).toBe('EXPIRED');
    });
  });

  describe('audit trail (task #70)', () => {
    it('records a distinct, queryable audit event for prepare, request-approval, and publish', async () => {
      const scenario = await createMarketplaceScenario(workspace.id, 'audit-flow', true);

      await marketplaceService.prepare(workspace.id, scenario.listingVersionId, actor.id);
      const prepareEvents = await prisma.auditEvent.findMany({
        where: {
          workspaceId: workspace.id,
          entityId: scenario.listingVersionId,
          action: 'PUBLICATION_PREPARED',
        },
      });
      expect(prepareEvents).toHaveLength(1);
      expect(prepareEvents[0].actorId).toBe(actor.id);
      expect(prepareEvents[0].integrityHash).toBeTruthy();

      const { approvalRequestId: auditApprovalId } = await marketplaceService.requestApproval(
        workspace.id,
        scenario.listingVersionId,
        actor.id,
      );
      const requestEvents = await prisma.auditEvent.findMany({
        where: {
          workspaceId: workspace.id,
          entityId: scenario.listingVersionId,
          action: 'PUBLICATION_APPROVAL_REQUESTED',
        },
      });
      expect(requestEvents).toHaveLength(1);

      await decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId: auditApprovalId,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      });

      await marketplaceService.publish(
        workspace.id,
        scenario.listingVersionId,
        auditApprovalId,
        actor.id,
      );
      const publishEvents = await prisma.auditEvent.findMany({
        where: {
          workspaceId: workspace.id,
          entityId: scenario.listingVersionId,
          action: 'PUBLICATION_PUBLISHED',
        },
      });
      expect(publishEvents).toHaveLength(1);
      expect(publishEvents[0].approvalReference).toBe(auditApprovalId);
    });

    it('scopes marketplace status lookups to the requesting workspace only', async () => {
      const scenario = await createMarketplaceScenario(workspace.id, 'scoping', true);
      await expect(
        marketplaceService.getStatus(noApprovalWorkspace.id, scenario.listingVersionId),
      ).rejects.toThrow();
      const status = await marketplaceService.getStatus(workspace.id, scenario.listingVersionId);
      expect(status.id).toBe(scenario.listingVersionId);
    });
  });
});
