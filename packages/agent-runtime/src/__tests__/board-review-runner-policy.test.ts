import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    enforceWorkspaceCapability: vi.fn(),
    dispatchWithWorkspaceCapability: vi.fn(),
    boardReviewCreate: vi.fn(),
    boardReviewUpdate: vi.fn(),
    ventureProposalFindFirst: vi.fn(),
    evidenceClaimFindMany: vi.fn(),
    runAllMockBoardAgents: vi.fn(),
  };
});

vi.mock('@ventureos/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ventureos/database')>();
  return {
    ...actual,
    enforceWorkspaceCapability: mocks.enforceWorkspaceCapability,
    dispatchWithWorkspaceCapability: mocks.dispatchWithWorkspaceCapability,
    prisma: {
      ventureProposal: { findFirst: mocks.ventureProposalFindFirst },
      boardReview: { create: mocks.boardReviewCreate, update: mocks.boardReviewUpdate },
      evidenceClaim: { findMany: mocks.evidenceClaimFindMany },
    },
  };
});
vi.mock('../mock-provider.js', () => ({ runAllMockBoardAgents: mocks.runAllMockBoardAgents }));
vi.mock('../decision-synthesiser.js', () => ({ synthesiseDecision: vi.fn() }));
vi.mock('@ventureos/finance-engine', () => ({ recordModelUsage: vi.fn() }));

import { runBoardReview } from '../board-review-runner.js';
import { CapabilityPolicyDeniedError } from '@ventureos/database';

describe('board review capability denial propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceWorkspaceCapability.mockResolvedValue(undefined);
    mocks.ventureProposalFindFirst.mockResolvedValue({
      id: 'proposal',
      opportunity: { id: 'opportunity' },
      versions: [{ id: 'proposal-version' }],
    });
    mocks.boardReviewCreate.mockResolvedValue({ id: 'board-review' });
    mocks.evidenceClaimFindMany.mockResolvedValue([]);
  });

  it('rethrows a final provider-boundary policy denial after terminating the running review', async () => {
    const denial = new CapabilityPolicyDeniedError({} as never);
    mocks.dispatchWithWorkspaceCapability.mockRejectedValue(denial);

    await expect(
      runBoardReview({ workspaceId: 'workspace', ventureProposalId: 'proposal' }),
    ).rejects.toBe(denial);

    expect(mocks.runAllMockBoardAgents).not.toHaveBeenCalled();
    expect(mocks.boardReviewUpdate).toHaveBeenCalledWith({
      where: { id: 'board-review' },
      data: {
        status: 'FAILED',
        failureReason: 'CAPABILITY_POLICY_DENIED',
        completedAt: expect.any(Date),
      },
    });
  });
});
