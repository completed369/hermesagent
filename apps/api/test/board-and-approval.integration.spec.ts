import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import {
  runBoardReview,
  createApprovalRequest,
  decideApprovalRequest,
  captureApprovalDecisionMemory,
  ApprovalAlreadyDecidedError,
  ApprovalInvalidForExecutionError,
  PrismaMemoryStore,
  type MemoryStore,
} from '@ventureos/agent-runtime';
import { cleanupEntitledTestWorkspace, entitleTestWorkspace } from './helpers/entitled-workspace';

/**
 * Hits a real (dockerized) Postgres, exactly like opportunities.integration.spec.ts.
 * ASSUMES `pnpm db:seed` has already been run at least once against this
 * database so the 8 voting AgentDefinition rows exist -- runBoardReview
 * fails closed (throws) if a mock agent output can't be attributed to a
 * real seeded AgentDefinition, by design (never silently persists an
 * unattributed vote).
 */
describe('Board review + approval decision (integration)', () => {
  let workspace: { id: string };
  let actor: { id: string };
  let opportunity: { id: string };
  let proposal: { id: string };

  async function createProposalVersion(
    snapshot: Record<string, unknown> = { note: 'v' + randomUUID() },
  ) {
    const versionCount = await prisma.ventureProposalVersion.count({
      where: { ventureProposalId: proposal.id },
    });
    return prisma.ventureProposalVersion.create({
      data: {
        ventureProposalId: proposal.id,
        opportunityId: opportunity.id,
        versionNumber: versionCount + 1,
        snapshot,
      },
    });
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: { name: `Test Workspace ${randomUUID()}`, slug: `test-board-${randomUUID()}` },
    });
    await entitleTestWorkspace(workspace.id);
    actor = await prisma.user.create({
      data: {
        email: `board-integration-actor-${randomUUID()}@ventureos.local`,
        displayName: 'Board Integration Test Actor',
      },
    });
    opportunity = await prisma.opportunity.create({
      data: {
        workspaceId: workspace.id,
        title: `Board Test Opportunity ${randomUUID()}`,
        description: 'Created by board-and-approval.integration.spec.ts',
        status: 'PROMOTED',
        latestOpportunityScore: 90,
        latestProfitConfidence: 85,
        isSpeculative: false,
        estimatedCostEur: 50,
        estimatedRevenueEur: 900,
        estimatedProfitEur: 850,
        risks: [],
      },
    });
    proposal = await prisma.ventureProposal.create({
      data: { workspaceId: workspace.id, opportunityId: opportunity.id, status: 'DRAFT' },
    });
    await createProposalVersion();
  });

  afterAll(async () => {
    if (!workspace?.id || !proposal?.id || !opportunity?.id || !actor?.id) {
      await prisma.$disconnect();
      return;
    }
    await prisma.memoryEntry.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.approvalDecision.deleteMany({
      where: { approvalRequest: { ventureProposalId: proposal.id } },
    });
    await prisma.approvalRequest.deleteMany({ where: { ventureProposalId: proposal.id } });
    await prisma.boardVeto.deleteMany({
      where: { boardReview: { ventureProposalId: proposal.id } },
    });
    await prisma.decisionSummary.deleteMany({
      where: { boardReview: { ventureProposalId: proposal.id } },
    });
    await prisma.boardVote.deleteMany({
      where: { boardReview: { ventureProposalId: proposal.id } },
    });
    await prisma.boardReview.deleteMany({ where: { ventureProposalId: proposal.id } });
    await prisma.ventureProposalVersion.deleteMany({ where: { ventureProposalId: proposal.id } });
    await prisma.ventureProposal.deleteMany({ where: { id: proposal.id } });
    await prisma.opportunity.deleteMany({ where: { id: opportunity.id } });
    await cleanupEntitledTestWorkspace(workspace.id);
    await prisma.workspace.deleteMany({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  it('runs all 8 mock board agents, persists votes, and computes a real vote result', async () => {
    const result = await runBoardReview({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.votingResult).not.toBeNull();

    const votes = await prisma.boardVote.findMany({
      where: { boardReviewId: result.boardReviewId },
    });
    expect(votes).toHaveLength(8);

    const summary = await prisma.decisionSummary.findUnique({
      where: { boardReviewId: result.boardReviewId },
    });
    expect(summary).not.toBeNull();
    expect(summary?.recommendation).toBe('APPROVE');

    const memory = await new PrismaMemoryStore().query({
      workspaceId: workspace.id,
      kinds: ['EPISODE'],
      subject: `venture-proposal:${proposal.id}`,
      keys: [`board-review:${result.boardReviewId}`],
    });
    expect(memory).toHaveLength(1);
    expect(memory[0]).toMatchObject({
      workspaceId: workspace.id,
      kind: 'EPISODE',
      sourceRef: `decision-summary:${summary?.id}`,
      sensitivity: 'INTERNAL',
    });
    expect(memory[0]?.payload).toMatchObject({
      boardReviewId: result.boardReviewId,
      ventureProposalId: proposal.id,
      decisionSummaryId: summary?.id,
      blocked: false,
      meetsThreshold: true,
      recommendation: 'APPROVE',
    });
  });

  it('does not rewrite a completed board review when advisory memory capture fails', async () => {
    const failingMemoryStore: MemoryStore = {
      put: async () => {
        throw new Error('memory unavailable');
      },
      query: async () => [],
      revoke: async () => {
        throw new Error('not used');
      },
      supersede: async () => {
        throw new Error('not used');
      },
    };

    const result = await runBoardReview({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
      memoryStore: failingMemoryStore,
    });
    expect(result.status).toBe('COMPLETED');

    const review = await prisma.boardReview.findUnique({ where: { id: result.boardReviewId } });
    expect(review?.status).toBe('COMPLETED');
    expect(review?.failureReason).toBeNull();

    const memory = await new PrismaMemoryStore().query({
      workspaceId: workspace.id,
      kinds: ['EPISODE'],
      subject: `venture-proposal:${proposal.id}`,
      keys: [`board-review:${result.boardReviewId}`],
    });
    expect(memory).toEqual([]);
  });

  it('creates an approval request whose packageHash matches the current version snapshot', async () => {
    const latestVersion = await prisma.ventureProposalVersion.findFirst({
      where: { ventureProposalId: proposal.id },
      orderBy: { versionNumber: 'desc' },
    });
    const request = await createApprovalRequest({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
      requestedBy: actor.id,
    });
    expect(request.state).toBe('PENDING');
    expect(request.packageHash).toBe(hashObject(latestVersion!.snapshot));
    expect(request.ventureProposalVersionId).toBe(latestVersion!.id);
  });

  it('approves a pending request and persists a real ApprovalDecision', async () => {
    const request = await createApprovalRequest({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
      requestedBy: actor.id,
    });

    const { approvalRequest, decision } = await decideApprovalRequest({
      workspaceId: workspace.id,
      approvalRequestId: request.id,
      founderIdentity: actor.id,
      decision: 'APPROVE',
    });

    expect(approvalRequest.state).toBe('APPROVED');
    expect(decision.decision).toBe('APPROVE');
    expect(decision.approvedPackageHash).toBe(request.packageHash);

    const memory = await new PrismaMemoryStore().query({
      workspaceId: workspace.id,
      kinds: ['DECISION'],
      subject: `venture-proposal:${proposal.id}`,
      keys: [`approval-request:${request.id}`],
    });
    expect(memory).toHaveLength(1);
    expect(memory[0]).toMatchObject({
      workspaceId: workspace.id,
      kind: 'DECISION',
      key: `approval-request:${request.id}`,
      sourceRef: `approval-decision:${decision.id}`,
    });
    expect(memory[0]?.payload).toMatchObject({
      approvalRequestId: request.id,
      approvalDecisionId: decision.id,
      kind: 'VENTURE_PROPOSAL',
      decision: 'APPROVE',
      conditions: [],
      approvedArtifactVersionId: decision.approvedArtifactVersionId,
    });

    // Deciding an already-decided request must fail closed, never silently
    // re-apply or overwrite the prior decision.
    await expect(
      decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId: request.id,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      }),
    ).rejects.toThrow(ApprovalAlreadyDecidedError);
  });

  it('does not roll back an authoritative founder decision when advisory memory capture fails', async () => {
    const request = await createApprovalRequest({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
      requestedBy: actor.id,
    });
    const failingMemoryStore: MemoryStore = {
      put: async () => {
        throw new Error('memory unavailable');
      },
      query: async () => {
        throw new Error('memory unavailable');
      },
      revoke: async () => {
        throw new Error('not used');
      },
      supersede: async () => {
        throw new Error('not used');
      },
    };

    const { approvalRequest, decision } = await decideApprovalRequest({
      workspaceId: workspace.id,
      approvalRequestId: request.id,
      founderIdentity: actor.id,
      decision: 'APPROVE',
      memoryStore: failingMemoryStore,
    });

    expect(approvalRequest.state).toBe('APPROVED');
    expect(decision.decision).toBe('APPROVE');
    expect(await prisma.approvalDecision.count({ where: { approvalRequestId: request.id } })).toBe(
      1,
    );

    const memory = await new PrismaMemoryStore().query({
      workspaceId: workspace.id,
      kinds: ['DECISION'],
      subject: `venture-proposal:${proposal.id}`,
      keys: [`approval-request:${request.id}`],
    });
    expect(memory).toEqual([]);
  });

  it('allows exactly one concurrent decision for a pending approval request', async () => {
    const request = await createApprovalRequest({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
      requestedBy: actor.id,
    });
    const decide = () =>
      decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId: request.id,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      });

    const settled = await Promise.allSettled([decide(), decide()]);

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.approvalDecision.count({ where: { approvalRequestId: request.id } })).toBe(
      1,
    );
  });

  it('revokes a previously approved request', async () => {
    const request = await createApprovalRequest({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
      requestedBy: actor.id,
    });
    await decideApprovalRequest({
      workspaceId: workspace.id,
      approvalRequestId: request.id,
      founderIdentity: actor.id,
      decision: 'APPROVE',
    });

    const { approvalRequest, decision: revokeDecision } = await decideApprovalRequest({
      workspaceId: workspace.id,
      approvalRequestId: request.id,
      founderIdentity: actor.id,
      decision: 'REVOKE',
      comment: 'Changed our mind',
    });

    expect(approvalRequest.state).toBe('REVOKED');
    expect(approvalRequest.revokedBy).toBe(actor.id);

    const store = new PrismaMemoryStore();
    const active = await store.query({
      workspaceId: workspace.id,
      kinds: ['DECISION'],
      subject: `venture-proposal:${proposal.id}`,
      keys: [`approval-request:${request.id}`],
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.sourceRef).toBe(`approval-decision:${revokeDecision.id}`);
    expect(active[0]?.payload).toMatchObject({ decision: 'REVOKE' });

    const historical = await prisma.memoryEntry.findMany({
      where: {
        workspaceId: workspace.id,
        subject: `venture-proposal:${proposal.id}`,
        key: `approval-request:${request.id}`,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(historical).toHaveLength(2);
    expect(historical[0]?.supersededById).toBe(active[0]?.id);
    expect(historical[1]?.supersededById).toBeNull();

    await expect(
      store.supersede(
        randomUUID(),
        active[0]!.id,
        {
          workspaceId: workspace.id,
          kind: 'DECISION',
          subject: `venture-proposal:${proposal.id}`,
          key: `approval-request:${request.id}`,
          payload: { decision: 'CROSS_WORKSPACE_SHOULD_FAIL' },
          sourceRef: 'approval-decision:cross-workspace',
          confidence: 1,
          sensitivity: 'INTERNAL',
          createdBy: 'test:cross-workspace',
        },
        'test:cross-workspace',
      ),
    ).rejects.toThrow();
  });

  it('serializes concurrent approval memory capture through real PostgreSQL', async () => {
    const request = await createApprovalRequest({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
      requestedBy: actor.id,
    });
    const equalDecidedAt = new Date('2026-08-14T12:00:00.000Z');
    const [approveDecision, revokeDecision] = await Promise.all([
      prisma.approvalDecision.create({
        data: {
          approvalRequestId: request.id,
          founderIdentity: actor.id,
          decidedAt: equalDecidedAt,
          decision: 'APPROVE',
          conditions: [],
          approvedArtifactVersionId: request.ventureProposalVersionId,
          approvedPackageHash: request.packageHash,
          expiresAt: request.expiresAt,
          auditSignature: hashObject({ requestId: request.id, decision: 'APPROVE' }),
        },
      }),
      prisma.approvalDecision.create({
        data: {
          approvalRequestId: request.id,
          founderIdentity: actor.id,
          decidedAt: equalDecidedAt,
          decision: 'REVOKE',
          conditions: [],
          approvedArtifactVersionId: request.ventureProposalVersionId,
          approvedPackageHash: request.packageHash,
          expiresAt: request.expiresAt,
          auditSignature: hashObject({ requestId: request.id, decision: 'REVOKE' }),
        },
      }),
    ]);
    const otherWorkspace = await prisma.workspace.create({
      data: {
        name: `Other Memory Workspace ${randomUUID()}`,
        slug: `other-memory-${randomUUID()}`,
      },
    });
    const store = new PrismaMemoryStore();
    const subject = `venture-proposal:${proposal.id}`;
    const key = `approval-request:${request.id}`;
    const otherWorkspaceMemory = await store.put({
      workspaceId: otherWorkspace.id,
      kind: 'DECISION',
      subject,
      key,
      payload: { decision: 'OTHER_WORKSPACE_UNTOUCHED' },
      sourceRef: 'approval-decision:other-workspace',
      confidence: 1,
      sensitivity: 'INTERNAL',
      createdBy: 'test:other-workspace',
    });

    try {
      await Promise.all([
        captureApprovalDecisionMemory({
          approvalRequest: request,
          approvalDecision: approveDecision,
          store,
        }),
        captureApprovalDecisionMemory({
          approvalRequest: request,
          approvalDecision: revokeDecision,
          store,
        }),
      ]);

      const active = await store.query({
        workspaceId: workspace.id,
        kinds: ['DECISION'],
        subject,
        keys: [key],
      });
      expect(active).toHaveLength(1);
      expect(active[0]?.payload).toMatchObject({ decision: 'REVOKE' });

      const rows = await prisma.memoryEntry.findMany({
        where: { workspaceId: workspace.id, subject, key },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      const activeRows = rows.filter((row) => !row.revokedAt && !row.supersededById);
      expect(activeRows).toHaveLength(1);
      expect(activeRows[0]?.payload).toMatchObject({ decision: 'REVOKE' });
      const approveRow = rows.find(
        (row) => (row.payload as { decision?: string }).decision === 'APPROVE',
      );
      expect(approveRow?.supersededById).toBe(activeRows[0]?.id);
      expect(
        await prisma.approvalDecision.count({ where: { approvalRequestId: request.id } }),
      ).toBe(2);

      const otherWorkspaceRow = await prisma.memoryEntry.findUnique({
        where: { id: otherWorkspaceMemory.id },
      });
      expect(otherWorkspaceRow?.supersededById).toBeNull();
      expect(otherWorkspaceRow?.revokedAt).toBeNull();
      expect(
        await store.query({
          workspaceId: otherWorkspace.id,
          kinds: ['DECISION'],
          subject,
          keys: [key],
        }),
      ).toHaveLength(1);
    } finally {
      await prisma.memoryEntry.deleteMany({ where: { workspaceId: otherWorkspace.id } });
      await prisma.workspace.delete({ where: { id: otherWorkspace.id } });
    }
  });

  it('invalidates a request and blocks the decision when the proposal changed since the request was raised', async () => {
    const request = await createApprovalRequest({
      workspaceId: workspace.id,
      ventureProposalId: proposal.id,
      requestedBy: actor.id,
    });

    // Simulate the proposal being regenerated (a new version created) after
    // the approval request was raised but before the founder decided.
    await createProposalVersion({ note: 'drifted-' + randomUUID() });

    await expect(
      decideApprovalRequest({
        workspaceId: workspace.id,
        approvalRequestId: request.id,
        founderIdentity: actor.id,
        decision: 'APPROVE',
      }),
    ).rejects.toThrow(ApprovalInvalidForExecutionError);

    const reloaded = await prisma.approvalRequest.findUnique({ where: { id: request.id } });
    expect(reloaded?.state).toBe('EXPIRED');

    const memory = await new PrismaMemoryStore().query({
      workspaceId: workspace.id,
      kinds: ['DECISION'],
      subject: `venture-proposal:${proposal.id}`,
      keys: [`approval-request:${request.id}`],
    });
    expect(memory).toEqual([]);
  });
});
