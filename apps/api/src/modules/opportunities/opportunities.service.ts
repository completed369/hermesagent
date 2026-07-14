import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { AuditService } from '../audit/audit.service';

const OPPORTUNITY_INCLUDE = {
  targetCustomers: true,
  channels: { orderBy: { priority: 'asc' as const } },
  scores: { orderBy: { calculatedAt: 'desc' as const } },
  evidenceClaims: { include: { evidenceArtifact: true } },
  proposal: true,
};

/**
 * Every mutation here is a founder-authority state change (master spec
 * section 15/25): reject/archive/promote must always go through
 * AuditService.record(), never bypass it, so the workspace's append-only
 * audit trail stays complete.
 */
@Injectable()
export class OpportunitiesService {
  constructor(private readonly auditService: AuditService) {}

  async list(workspaceId: string) {
    return prisma.opportunity.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: OPPORTUNITY_INCLUDE,
    });
  }

  async getById(workspaceId: string, id: string) {
    const opportunity = await prisma.opportunity.findFirst({
      where: { id, workspaceId },
      include: OPPORTUNITY_INCLUDE,
    });
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found');
    }
    return opportunity;
  }

  private async loadForMutation(workspaceId: string, id: string) {
    const opportunity = await prisma.opportunity.findFirst({ where: { id, workspaceId } });
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found');
    }
    return opportunity;
  }

  async reject(workspaceId: string, id: string, reason: string, actorId: string) {
    const before = await this.loadForMutation(workspaceId, id);
    const after = await prisma.opportunity.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason, rejectedAt: new Date() },
    });
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'OPPORTUNITY_REJECTED',
      entityType: 'Opportunity',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  async archive(workspaceId: string, id: string, actorId: string) {
    const before = await this.loadForMutation(workspaceId, id);
    const after = await prisma.opportunity.update({
      where: { id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'OPPORTUNITY_ARCHIVED',
      entityType: 'Opportunity',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  async promote(workspaceId: string, id: string, actorId: string) {
    const before = await this.loadForMutation(workspaceId, id);
    if (before.status === 'PROMOTED') {
      throw new ForbiddenException('Opportunity is already promoted');
    }

    const { after, proposal } = await prisma.$transaction(async (tx) => {
      const updated = await tx.opportunity.update({
        where: { id },
        data: { status: 'PROMOTED', promotedAt: new Date() },
      });

      const existingProposal = await tx.ventureProposal.findUnique({
        where: { opportunityId: id },
      });
      const proposalRecord =
        existingProposal ??
        (await tx.ventureProposal.create({
          data: { workspaceId, opportunityId: id, status: 'DRAFT' },
        }));

      const versionCount = await tx.ventureProposalVersion.count({
        where: { ventureProposalId: proposalRecord.id },
      });
      // snapshot must be plain JSON -- Prisma's Json columns reject class
      // instances (e.g. Decimal) even though they stringify fine on their own.
      const snapshot = JSON.parse(JSON.stringify(updated));
      await tx.ventureProposalVersion.create({
        data: {
          ventureProposalId: proposalRecord.id,
          opportunityId: id,
          versionNumber: versionCount + 1,
          snapshot,
        },
      });

      return { after: updated, proposal: proposalRecord };
    });

    await this.auditService.record(workspaceId, {
      actorId,
      action: 'OPPORTUNITY_PROMOTED',
      entityType: 'Opportunity',
      entityId: id,
      before,
      after,
    });

    return { opportunity: after, proposal };
  }
}
