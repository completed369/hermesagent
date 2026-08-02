import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { BoardService } from './board.service';
import type { AuditService } from '../audit/audit.service';

vi.mock('@ventureos/database', () => ({
  CapabilityPolicyDeniedError: class CapabilityPolicyDeniedError extends Error {},
  enforceWorkspaceCapability: vi.fn().mockResolvedValue(undefined),
  prisma: {
    ventureProposal: { findFirst: vi.fn() },
    boardReview: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock('@ventureos/config', () => ({
  loadEnv: vi.fn().mockReturnValue({ TEMPORAL_TASK_QUEUE: 'ventureos-test-queue' }),
}));

vi.mock('@ventureos/workflows', () => ({
  getTemporalClient: vi.fn(),
}));

import { getTemporalClient } from '@ventureos/workflows';

const WORKSPACE_ID = 'workspace-1';
const PROPOSAL_ID = 'proposal-1';
const ACTOR_ID = 'actor-1';

describe('BoardService', () => {
  let auditService: { record: ReturnType<typeof vi.fn> };
  let service: BoardService;

  beforeEach(() => {
    vi.clearAllMocks();
    auditService = { record: vi.fn().mockResolvedValue(undefined) };
    service = new BoardService(auditService as unknown as AuditService);
  });

  describe('startReview', () => {
    it('throws NotFoundException when the venture proposal does not exist in the workspace', async () => {
      vi.mocked(prisma.ventureProposal.findFirst).mockResolvedValue(null);
      await expect(service.startReview(WORKSPACE_ID, PROPOSAL_ID, ACTOR_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(getTemporalClient).not.toHaveBeenCalled();
    });

    it('starts the boardApprovalWorkflow and records an audit event with the workflowId', async () => {
      vi.mocked(prisma.ventureProposal.findFirst).mockResolvedValue({
        id: PROPOSAL_ID,
        workspaceId: WORKSPACE_ID,
      } as never);
      const start = vi.fn().mockResolvedValue({ firstExecutionRunId: 'run-1' });
      vi.mocked(getTemporalClient).mockResolvedValue({ start } as never);

      const result = await service.startReview(WORKSPACE_ID, PROPOSAL_ID, ACTOR_ID);

      expect(start).toHaveBeenCalledWith(
        'boardApprovalWorkflow',
        expect.objectContaining({
          taskQueue: 'ventureos-test-queue',
          args: [{ workspaceId: WORKSPACE_ID, ventureProposalId: PROPOSAL_ID, actorId: ACTOR_ID }],
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        WORKSPACE_ID,
        expect.objectContaining({
          actorId: ACTOR_ID,
          action: 'BOARD_REVIEW_STARTED',
          entityType: 'VentureProposal',
          entityId: PROPOSAL_ID,
        }),
      );
      expect(result.temporalRunId).toBe('run-1');
      expect(typeof result.workflowId).toBe('string');
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when missing from the workspace', async () => {
      vi.mocked(prisma.boardReview.findFirst).mockResolvedValue(null);
      await expect(service.getById(WORKSPACE_ID, 'review-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listForProposal', () => {
    it('scopes the query to workspace + proposal', async () => {
      vi.mocked(prisma.boardReview.findMany).mockResolvedValue([]);
      await service.listForProposal(WORKSPACE_ID, PROPOSAL_ID);
      expect(prisma.boardReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: WORKSPACE_ID, ventureProposalId: PROPOSAL_ID },
        }),
      );
    });
  });
});
