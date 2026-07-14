import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { ApprovalsService } from './approvals.service';
import type { AuditService } from '../audit/audit.service';

vi.mock('@ventureos/database', () => ({
  prisma: {
    approvalRequest: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@ventureos/workflows', () => ({
  getTemporalClient: vi.fn(),
}));

vi.mock('@ventureos/agent-runtime', async () => {
  const actual = await vi.importActual<typeof import('@ventureos/agent-runtime')>(
    '@ventureos/agent-runtime',
  );
  return {
    ...actual,
    decideApprovalRequest: vi.fn(),
  };
});

import { getTemporalClient } from '@ventureos/workflows';
import {
  decideApprovalRequest,
  ApprovalNotFoundError,
  ApprovalAlreadyDecidedError,
  ApprovalInvalidForExecutionError,
} from '@ventureos/agent-runtime';

const WORKSPACE_ID = 'workspace-1';
const REQUEST_ID = 'approval-1';
const FOUNDER_ID = 'founder-1';

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    workspaceId: WORKSPACE_ID,
    state: 'PENDING',
    workflowId: null,
    ...overrides,
  };
}

describe('ApprovalsService', () => {
  let auditService: { record: ReturnType<typeof vi.fn> };
  let service: ApprovalsService;

  beforeEach(() => {
    vi.clearAllMocks();
    auditService = { record: vi.fn().mockResolvedValue(undefined) };
    service = new ApprovalsService(auditService as unknown as AuditService);
  });

  describe('list', () => {
    it('scopes the query to the given workspace', async () => {
      vi.mocked(prisma.approvalRequest.findMany).mockResolvedValue([]);
      await service.list(WORKSPACE_ID);
      expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: WORKSPACE_ID } }),
      );
    });

    it('additionally filters by ventureProposalId when provided', async () => {
      vi.mocked(prisma.approvalRequest.findMany).mockResolvedValue([]);
      await service.list(WORKSPACE_ID, 'proposal-1');
      expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: WORKSPACE_ID, ventureProposalId: 'proposal-1' },
        }),
      );
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when missing from the workspace', async () => {
      vi.mocked(prisma.approvalRequest.findFirst).mockResolvedValue(null);
      await expect(service.getById(WORKSPACE_ID, REQUEST_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('decide', () => {
    it('throws NotFoundException when the approval request does not exist in the workspace', async () => {
      vi.mocked(prisma.approvalRequest.findFirst).mockResolvedValue(null);
      await expect(
        service.decide(
          WORKSPACE_ID,
          REQUEST_ID,
          { decision: 'APPROVE', conditions: [] },
          FOUNDER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(decideApprovalRequest).not.toHaveBeenCalled();
    });

    it('records an audit event and returns the result on success, without signaling when no workflowId is set', async () => {
      const before = makeRequest();
      const after = makeRequest({ state: 'APPROVED' });
      vi.mocked(prisma.approvalRequest.findFirst).mockResolvedValue(before as never);
      vi.mocked(decideApprovalRequest).mockResolvedValue({
        approvalRequest: after,
        decision: { id: 'decision-1' },
      } as never);

      const result = await service.decide(
        WORKSPACE_ID,
        REQUEST_ID,
        { decision: 'APPROVE', conditions: [] },
        FOUNDER_ID,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        WORKSPACE_ID,
        expect.objectContaining({
          actorId: FOUNDER_ID,
          action: 'APPROVAL_DECIDED',
          entityType: 'ApprovalRequest',
          entityId: REQUEST_ID,
          before,
          after,
          approvalReference: 'decision-1',
        }),
      );
      expect(getTemporalClient).not.toHaveBeenCalled();
      expect(result).toEqual({ approvalRequest: after, decision: { id: 'decision-1' } });
    });

    it('signals the waiting workflow when the request has a workflowId', async () => {
      const before = makeRequest({ workflowId: 'wf-123' });
      const after = makeRequest({ state: 'APPROVED', workflowId: 'wf-123' });
      vi.mocked(prisma.approvalRequest.findFirst).mockResolvedValue(before as never);
      vi.mocked(decideApprovalRequest).mockResolvedValue({
        approvalRequest: after,
        decision: { id: 'decision-1' },
      } as never);
      const signal = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getTemporalClient).mockResolvedValue({
        getHandle: vi.fn().mockReturnValue({ signal }),
      } as never);

      await service.decide(
        WORKSPACE_ID,
        REQUEST_ID,
        { decision: 'APPROVE', conditions: [] },
        FOUNDER_ID,
      );

      expect(signal).toHaveBeenCalledWith('founderDecision', { approvalRequestId: REQUEST_ID });
    });

    it('does not fail the request if signaling the workflow throws', async () => {
      const before = makeRequest({ workflowId: 'wf-123' });
      const after = makeRequest({ state: 'APPROVED', workflowId: 'wf-123' });
      vi.mocked(prisma.approvalRequest.findFirst).mockResolvedValue(before as never);
      vi.mocked(decideApprovalRequest).mockResolvedValue({
        approvalRequest: after,
        decision: { id: 'decision-1' },
      } as never);
      vi.mocked(getTemporalClient).mockRejectedValue(new Error('worker unreachable'));

      const result = await service.decide(
        WORKSPACE_ID,
        REQUEST_ID,
        { decision: 'APPROVE', conditions: [] },
        FOUNDER_ID,
      );
      expect(result.approvalRequest).toBe(after);
    });

    it('maps ApprovalAlreadyDecidedError to ConflictException', async () => {
      vi.mocked(prisma.approvalRequest.findFirst).mockResolvedValue(makeRequest() as never);
      vi.mocked(decideApprovalRequest).mockRejectedValue(
        new ApprovalAlreadyDecidedError('already decided'),
      );
      await expect(
        service.decide(
          WORKSPACE_ID,
          REQUEST_ID,
          { decision: 'APPROVE', conditions: [] },
          FOUNDER_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('maps ApprovalInvalidForExecutionError to ConflictException with the reason', async () => {
      vi.mocked(prisma.approvalRequest.findFirst).mockResolvedValue(makeRequest() as never);
      vi.mocked(decideApprovalRequest).mockRejectedValue(
        new ApprovalInvalidForExecutionError('ARTIFACT_VERSION_MISMATCH'),
      );
      await expect(
        service.decide(
          WORKSPACE_ID,
          REQUEST_ID,
          { decision: 'APPROVE', conditions: [] },
          FOUNDER_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('maps ApprovalNotFoundError (raised inside decideApprovalRequest) to NotFoundException', async () => {
      vi.mocked(prisma.approvalRequest.findFirst).mockResolvedValue(makeRequest() as never);
      vi.mocked(decideApprovalRequest).mockRejectedValue(new ApprovalNotFoundError('gone'));
      await expect(
        service.decide(
          WORKSPACE_ID,
          REQUEST_ID,
          { decision: 'APPROVE', conditions: [] },
          FOUNDER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
