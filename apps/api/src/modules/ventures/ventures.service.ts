import { Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';

/**
 * Phase 8 deliverable #1: "multiple ventures per workspace" was already
 * structurally true (each Opportunity promotion creates its own
 * VentureProposal, and every Board/Product/Finance table is already
 * workspace-scoped, not "current venture"-scoped) -- what was missing was a
 * single place to see every concurrent venture at once instead of only
 * reaching one via its own Opportunity/Board Room/Finance Centre page. This
 * service is purely a read-side aggregation over data every other module
 * already owns; it introduces no new venture-tracking mechanism.
 */
@Injectable()
export class VenturesService {
  async list(workspaceId: string) {
    return prisma.ventureProposal.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        opportunity: {
          select: {
            title: true,
            status: true,
            latestOpportunityScore: true,
            latestProfitConfidence: true,
            isSpeculative: true,
          },
        },
        product: { select: { id: true, status: true } },
      },
    });
  }
}
