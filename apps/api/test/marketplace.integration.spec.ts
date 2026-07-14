import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { MockStorageProvider } from '@ventureos/integrations';
import { createApprovalRequest, decideApprovalRequest } from '@ventureos/agent-runtime';
import { generateProduct, generateListingAndApprovalRequest } from '@ventureos/product-studio';
import {
  prepareListingForPublication,
  requestPublicationApproval,
  publishListing,
  withIdempotency,
  MarketplaceBlockedError,
  IdempotencyKeyConflictError,
} from '@ventureos/marketplace-connectors';
import { MarketplaceService } from '../src/modules/marketplace/marketplace.service';
import { AuditService } from '../src/modules/audit/audit.service';

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
  const storageProvider = new MockStorageProvider();
  const auditService = new AuditService();
  const marketplaceService = new MarketplaceService(auditService);

  let workspace: { id: string };
  let noApprovalWorkspace: { id: string };
  let disabledWorkspace: { id: string };
  let actor: { id: string };

  /** Builds a QA_PASSED product + generated listing, optionally deciding the
   * Phase 4 PRODUCT_LISTING approval (APPROVE) so the listing version is
   * ready for Phase 6 preparation -- mirrors
   * product-and-listing.integration.spec.ts's setup exactly. */
  async function buildListingScenario(
    workspaceId: string,
    suffix: string,
    decideApproval: boolean,
  ) {
    const opp = await prisma.opportunity.create({
      data: {
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
    });
    const proposal = await prisma.ventureProposal.create({
      data: { workspaceId, opportunityId: opp.id, status: 'DRAFT' },
    });
    await prisma.ventureProposalVersion.create({
      data: {
        ventureProposalId: proposal.id,
        opportunityId: opp.id,
        versionNumber: 1,
        snapshot: { note: 'v' + randomUUID() },
      },
    });

    const phase3Request = await createApprovalRequest({
      workspaceId,
      ventureProposalId: proposal.id,
      requestedBy: actor.id,
    });
    await decideApprovalRequest({
      workspaceId,
      approvalRequestId: phase3Request.id,
      founderIdentity: actor.id,
      decision: 'APPROVE',
    });

    const productResult = await generateProduct({
      workspaceId,
      ventureProposalId: proposal.id,
      storageProvider,
    });

    const listingResult = await generateListingAndApprovalRequest({
      workspaceId,
      productId: productResult.productId,
      requestedBy: actor.id,
    });

    if (decideApproval) {
      await decideApprovalRequest({
        workspaceId,
        approvalRequestId: listingResult.approvalRequestId,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      });
    }

    return { proposalId: proposal.id, listingVersionId: listingResult.listingVersionId };
  }

  async function cleanupWorkspace(workspaceId: string) {
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.idempotencyKey.deleteMany({ where: { workspaceId } });
    await prisma.publicationAttempt.deleteMany({
      where: { listingVersion: { listing: { product: { ventureProposal: { workspaceId } } } } },
    });
    await prisma.approvalDecision.deleteMany({
      where: { approvalRequest: { workspaceId } },
    });
    await prisma.approvalRequest.deleteMany({ where: { workspaceId } });
    await prisma.marketplaceAccount.deleteMany({ where: { workspaceId } });
    await prisma.listingImage.deleteMany({
      where: { listingVersion: { listing: { product: { ventureProposal: { workspaceId } } } } },
    });
    await prisma.listingFile.deleteMany({
      where: { listingVersion: { listing: { product: { ventureProposal: { workspaceId } } } } },
    });
    await prisma.priceProposal.deleteMany({
      where: { listingVersion: { listing: { product: { ventureProposal: { workspaceId } } } } },
    });
    await prisma.sEOEvaluation.deleteMany({
      where: { listingVersion: { listing: { product: { ventureProposal: { workspaceId } } } } },
    });
    await prisma.listingVersion.deleteMany({
      where: { listing: { product: { ventureProposal: { workspaceId } } } },
    });
    await prisma.listing.deleteMany({ where: { product: { ventureProposal: { workspaceId } } } });
    await prisma.qualityCheckResult.deleteMany({
      where: {
        qualityCheck: { productVersion: { product: { ventureProposal: { workspaceId } } } },
      },
    });
    await prisma.qualityCheck.deleteMany({
      where: { productVersion: { product: { ventureProposal: { workspaceId } } } },
    });
    await prisma.licenceRecord.deleteMany({
      where: { productVersion: { product: { ventureProposal: { workspaceId } } } },
    });
    await prisma.productAssetVersion.deleteMany({
      where: {
        productAsset: { productVersion: { product: { ventureProposal: { workspaceId } } } },
      },
    });
    await prisma.productAsset.deleteMany({
      where: { productVersion: { product: { ventureProposal: { workspaceId } } } },
    });
    await prisma.productBrief.deleteMany({
      where: { productVersion: { product: { ventureProposal: { workspaceId } } } },
    });
    await prisma.productVersion.deleteMany({
      where: { product: { ventureProposal: { workspaceId } } },
    });
    await prisma.product.deleteMany({ where: { ventureProposal: { workspaceId } } });
    await prisma.ventureProposalVersion.deleteMany({ where: { ventureProposal: { workspaceId } } });
    await prisma.ventureProposal.deleteMany({ where: { workspaceId } });
    await prisma.opportunity.deleteMany({ where: { workspaceId } });
    await prisma.integration.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: `Marketplace Test Workspace ${randomUUID()}`,
        slug: `test-mkt-${randomUUID()}`,
      },
    });
    noApprovalWorkspace = await prisma.workspace.create({
      data: {
        name: `Marketplace Test Workspace (no approval) ${randomUUID()}`,
        slug: `test-mkt-noappr-${randomUUID()}`,
      },
    });
    disabledWorkspace = await prisma.workspace.create({
      data: {
        name: `Marketplace Test Workspace (disabled) ${randomUUID()}`,
        slug: `test-mkt-disabled-${randomUUID()}`,
      },
    });
    actor = await prisma.user.create({
      data: {
        email: `marketplace-integration-actor-${randomUUID()}@ventureos.local`,
        displayName: 'Marketplace Integration Test Actor',
      },
    });
  });

  afterAll(async () => {
    await cleanupWorkspace(workspace.id);
    await cleanupWorkspace(noApprovalWorkspace.id);
    await cleanupWorkspace(disabledWorkspace.id);
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  describe('Stage 1: prepareListingForPublication', () => {
    it('persists a BLOCKED_NO_APPROVAL attempt when the PRODUCT_LISTING approval has not been decided', async () => {
      const { listingVersionId } = await buildListingScenario(
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

    let mainListingVersionId: string;
    let firstExternalListingId: string;

    it('reaches READY_FOR_PUBLISH once the PRODUCT_LISTING approval is granted', async () => {
      const scenario = await buildListingScenario(workspace.id, 'main', true);
      mainListingVersionId = scenario.listingVersionId;

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
      const { listingVersionId } = await buildListingScenario(
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

  describe('idempotency guarantees (task #69: reconciliation + error recovery)', () => {
    let account: { id: string };

    beforeAll(async () => {
      const found = await prisma.marketplaceAccount.findFirstOrThrow({
        where: { workspaceId: workspace.id, marketplace: 'etsy' },
      });
      account = found;
    });

    it('refuses to treat a reused key with a different request payload as a retry', async () => {
      const key = `test-conflict-${randomUUID()}`;
      await withIdempotency({
        workspaceId: workspace.id,
        marketplaceAccountId: account.id,
        key,
        operationType: 'TEST_OPERATION',
        requestPayload: { value: 'first' },
        execute: async () => ({ ok: true }),
      });

      await expect(
        withIdempotency({
          workspaceId: workspace.id,
          marketplaceAccountId: account.id,
          key,
          operationType: 'TEST_OPERATION',
          requestPayload: { value: 'second' },
          execute: async () => ({ ok: true }),
        }),
      ).rejects.toThrow(IdempotencyKeyConflictError);
    });

    it('retries a FAILED key in place on a genuine retry, without creating a duplicate row', async () => {
      const key = `test-retry-${randomUUID()}`;
      let attempts = 0;

      await expect(
        withIdempotency({
          workspaceId: workspace.id,
          marketplaceAccountId: account.id,
          key,
          operationType: 'TEST_OPERATION',
          requestPayload: { value: 'retry-me' },
          execute: async () => {
            attempts += 1;
            throw new Error('simulated transient failure');
          },
        }),
      ).rejects.toThrow('simulated transient failure');

      const afterFailure = await prisma.idempotencyKey.findUnique({
        where: { workspaceId_key: { workspaceId: workspace.id, key } },
      });
      expect(afterFailure?.status).toBe('FAILED');

      const retried = await withIdempotency({
        workspaceId: workspace.id,
        marketplaceAccountId: account.id,
        key,
        operationType: 'TEST_OPERATION',
        requestPayload: { value: 'retry-me' },
        execute: async () => {
          attempts += 1;
          return { ok: true, attempts };
        },
      });

      expect(retried.replayed).toBe(false);
      expect(attempts).toBe(2);

      const rows = await prisma.idempotencyKey.findMany({
        where: { workspaceId: workspace.id, key },
      });
      // Exactly one row for this key throughout -- reconciliation reuses it
      // rather than creating a second row for the same external write.
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('SUCCEEDED');
    });
  });

  describe('Stage 1.5 + Stage 2: PUBLICATION approval + publish', () => {
    let listingVersionId: string;
    let approvalRequestId: string;

    beforeAll(async () => {
      const scenario = await buildListingScenario(workspace.id, 'publish-flow', true);
      listingVersionId = scenario.listingVersionId;
      await prepareListingForPublication({ workspaceId: workspace.id, listingVersionId });
    });

    it('refuses to raise a PUBLICATION approval before a READY_FOR_PUBLISH attempt exists', async () => {
      const { listingVersionId: freshId } = await buildListingScenario(
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
      const scenario = await buildListingScenario(workspace.id, 'publish-flow-drift', true);
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
      const scenario = await buildListingScenario(workspace.id, 'audit-flow', true);

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
      const scenario = await buildListingScenario(workspace.id, 'scoping', true);
      await expect(
        marketplaceService.getStatus(noApprovalWorkspace.id, scenario.listingVersionId),
      ).rejects.toThrow();
      const status = await marketplaceService.getStatus(workspace.id, scenario.listingVersionId);
      expect(status.id).toBe(scenario.listingVersionId);
    });
  });
});
