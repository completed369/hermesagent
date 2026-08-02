import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import {
  runBoardReview,
  createApprovalRequest,
  decideApprovalRequest,
  ApprovalAlreadyDecidedError,
  ApprovalInvalidForExecutionError,
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

    const { approvalRequest } = await decideApprovalRequest({
      workspaceId: workspace.id,
      approvalRequestId: request.id,
      founderIdentity: actor.id,
      decision: 'REVOKE',
      comment: 'Changed our mind',
    });

    expect(approvalRequest.state).toBe('REVOKED');
    expect(approvalRequest.revokedBy).toBe(actor.id);
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
  });
});
