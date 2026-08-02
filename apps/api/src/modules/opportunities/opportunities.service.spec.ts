import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { OpportunitiesService } from './opportunities.service';
import type { AuditService } from '../audit/audit.service';

vi.mock('@ventureos/database', () => ({
  CapabilityPolicyDeniedError: class CapabilityPolicyDeniedError extends Error {},
  enforceWorkspaceCapability: vi.fn().mockResolvedValue(undefined),
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
  prisma: {
    opportunity: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const WORKSPACE_ID = 'workspace-1';
const OPPORTUNITY_ID = 'opportunity-1';
const ACTOR_ID = 'actor-1';

function makeOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: OPPORTUNITY_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Social Media Content Planning Kit',
    status: 'NEW',
    ...overrides,
  };
}

describe('OpportunitiesService', () => {
  let auditService: { record: ReturnType<typeof vi.fn> };
  let service: OpportunitiesService;

  beforeEach(() => {
    vi.clearAllMocks();
    auditService = { record: vi.fn().mockResolvedValue(undefined) };
    service = new OpportunitiesService(auditService as unknown as AuditService);
  });

  describe('list', () => {
    it('scopes the query to the given workspace', async () => {
      vi.mocked(prisma.opportunity.findMany).mockResolvedValue([]);
      await service.list(WORKSPACE_ID);
      expect(prisma.opportunity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: WORKSPACE_ID } }),
      );
    });
  });

  describe('getById', () => {
    it('returns the opportunity when it exists in the workspace', async () => {
      const opportunity = makeOpportunity();
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity as never);
      const result = await service.getById(WORKSPACE_ID, OPPORTUNITY_ID);
      expect(result).toBe(opportunity);
      expect(prisma.opportunity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OPPORTUNITY_ID, workspaceId: WORKSPACE_ID } }),
      );
    });

    it('throws NotFoundException when the opportunity does not exist in the workspace', async () => {
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(null);
      await expect(service.getById(WORKSPACE_ID, OPPORTUNITY_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('never leaks an opportunity belonging to a different workspace', async () => {
      // findFirst is workspace-scoped in the where clause, so a cross-workspace
      // id simply returns null from Prisma -- assert the service surfaces that
      // as NotFound rather than fetching by id alone.
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(null);
      await expect(service.getById('other-workspace', OPPORTUNITY_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.opportunity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OPPORTUNITY_ID, workspaceId: 'other-workspace' } }),
      );
    });
  });

  describe('reject', () => {
    it('updates status, records the reason, and writes an audit event', async () => {
      const before = makeOpportunity({ status: 'NEW' });
      const after = makeOpportunity({ status: 'REJECTED', rejectionReason: 'Too saturated' });
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(before as never);
      vi.mocked(prisma.opportunity.update).mockResolvedValue(after as never);

      const result = await service.reject(WORKSPACE_ID, OPPORTUNITY_ID, 'Too saturated', ACTOR_ID);

      expect(prisma.opportunity.update).toHaveBeenCalledWith({
        where: { id: OPPORTUNITY_ID },
        data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Too saturated' }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        WORKSPACE_ID,
        expect.objectContaining({
          actorId: ACTOR_ID,
          action: 'OPPORTUNITY_REJECTED',
          entityType: 'Opportunity',
          entityId: OPPORTUNITY_ID,
          before,
          after,
        }),
      );
      expect(result).toBe(after);
    });

    it('throws NotFoundException instead of rejecting an opportunity from another workspace', async () => {
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(null);
      await expect(
        service.reject(WORKSPACE_ID, OPPORTUNITY_ID, 'reason', ACTOR_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.opportunity.update).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('updates status and writes an audit event', async () => {
      const before = makeOpportunity({ status: 'NEW' });
      const after = makeOpportunity({ status: 'ARCHIVED' });
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(before as never);
      vi.mocked(prisma.opportunity.update).mockResolvedValue(after as never);

      const result = await service.archive(WORKSPACE_ID, OPPORTUNITY_ID, ACTOR_ID);

      expect(prisma.opportunity.update).toHaveBeenCalledWith({
        where: { id: OPPORTUNITY_ID },
        data: expect.objectContaining({ status: 'ARCHIVED' }),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        WORKSPACE_ID,
        expect.objectContaining({ action: 'OPPORTUNITY_ARCHIVED', before, after }),
      );
      expect(result).toBe(after);
    });
  });

  describe('promote', () => {
    it('rejects promoting an opportunity that is already promoted', async () => {
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(
        makeOpportunity({ status: 'PROMOTED' }) as never,
      );
      await expect(service.promote(WORKSPACE_ID, OPPORTUNITY_ID, ACTOR_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates a new VentureProposal + first version when none exists, and records an audit event', async () => {
      const before = makeOpportunity({ status: 'NEW' });
      const after = makeOpportunity({ status: 'PROMOTED' });
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(before as never);

      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        opportunity: { update: vi.fn().mockResolvedValue(after) },
        ventureProposal: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'proposal-1', opportunityId: OPPORTUNITY_ID }),
        },
        ventureProposalVersion: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue({ id: 'version-1', versionNumber: 1 }),
        },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)(tx),
      );

      const result = await service.promote(WORKSPACE_ID, OPPORTUNITY_ID, ACTOR_ID);

      expect(tx.$queryRaw).toHaveBeenCalledWith(
        expect.objectContaining({ values: [WORKSPACE_ID] }),
      );
      expect(tx.ventureProposal.create).toHaveBeenCalledWith({
        data: { workspaceId: WORKSPACE_ID, opportunityId: OPPORTUNITY_ID, status: 'DRAFT' },
      });
      expect(tx.ventureProposalVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ventureProposalId: 'proposal-1', versionNumber: 1 }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        WORKSPACE_ID,
        expect.objectContaining({ action: 'OPPORTUNITY_PROMOTED', before, after }),
      );
      expect(result).toEqual({
        opportunity: after,
        proposal: { id: 'proposal-1', opportunityId: OPPORTUNITY_ID },
      });
    });

    it('reuses an existing VentureProposal and increments the version number', async () => {
      const before = makeOpportunity({ status: 'UNDER_REVIEW' });
      const after = makeOpportunity({ status: 'PROMOTED' });
      vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(before as never);

      const existingProposal = { id: 'proposal-1', opportunityId: OPPORTUNITY_ID };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        opportunity: { update: vi.fn().mockResolvedValue(after) },
        ventureProposal: {
          findUnique: vi.fn().mockResolvedValue(existingProposal),
          create: vi.fn(),
        },
        ventureProposalVersion: {
          count: vi.fn().mockResolvedValue(2),
          create: vi.fn().mockResolvedValue({ id: 'version-3', versionNumber: 3 }),
        },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)(tx),
      );

      await service.promote(WORKSPACE_ID, OPPORTUNITY_ID, ACTOR_ID);

      expect(tx.ventureProposal.create).not.toHaveBeenCalled();
      expect(tx.ventureProposalVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ventureProposalId: 'proposal-1', versionNumber: 3 }),
        }),
      );
    });
  });
});
