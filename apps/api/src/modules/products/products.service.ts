import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma, Prisma } from '@ventureos/database';
import { loadEnv } from '@ventureos/config';
import { getTemporalClient } from '@ventureos/workflows';
import { AuditService } from '../audit/audit.service';

// `satisfies Prisma.XInclude` (rather than a plain object or `as const`)
// keeps each nested literal (e.g. 'desc', `files: true`) checked against
// Prisma's exact generated arg types at every nesting level -- factoring a
// deeply-nested include into a named const otherwise loses that contextual
// typing and produces confusing "not assignable" errors from tsc.
const PRODUCT_VERSION_INCLUDE = {
  brief: true,
  assets: { include: { versions: { orderBy: { attempt: 'desc' }, take: 1 } } },
  qualityChecks: { include: { results: true } },
  licenceRecords: true,
} satisfies Prisma.ProductVersionInclude;

const LISTING_INCLUDE = {
  versions: {
    orderBy: { versionNumber: 'desc' },
    include: {
      images: { orderBy: { position: 'asc' } },
      files: true,
      priceProposals: { orderBy: { createdAt: 'desc' } },
      seoEvaluations: { orderBy: { evaluatedAt: 'desc' } },
      publicationAttempts: { orderBy: { attemptedAt: 'desc' } },
    },
  },
} satisfies Prisma.ListingInclude;

const PRODUCT_INCLUDE = {
  versions: { orderBy: { versionNumber: 'desc' }, include: PRODUCT_VERSION_INCLUDE },
  listings: { include: LISTING_INCLUDE },
} satisfies Prisma.ProductInclude;

/**
 * Starts/lists/reads Product + Listing generation. Like BoardService, the
 * actual generation logic (mock asset generation, QA, listing draft, SEO
 * evaluation, second founder ApprovalRequest) lives in
 * @ventureos/product-studio and runs inside the Temporal
 * `productListingWorkflow` (apps/worker) -- never inline in this HTTP
 * request, since it is a durable, potentially long-running (waits for
 * founder approval) workflow.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly auditService: AuditService) {}

  async startGeneration(workspaceId: string, ventureProposalId: string, actorId: string) {
    const proposal = await prisma.ventureProposal.findFirst({
      where: { id: ventureProposalId, workspaceId },
    });
    if (!proposal) {
      throw new NotFoundException('Venture proposal not found');
    }

    const env = loadEnv();
    const client = await getTemporalClient();
    const workflowId = `product-listing-${ventureProposalId}-${randomUUID()}`;
    const handle = await client.start('productListingWorkflow', {
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [{ workspaceId, ventureProposalId, actorId }],
    });

    await this.auditService.record(workspaceId, {
      actorId,
      action: 'PRODUCT_GENERATION_STARTED',
      entityType: 'VentureProposal',
      entityId: ventureProposalId,
      workflowId,
    });

    return { workflowId, temporalRunId: handle.firstExecutionRunId };
  }

  async listForProposal(workspaceId: string, ventureProposalId: string) {
    return prisma.product.findMany({
      where: { workspaceId, ventureProposalId },
      orderBy: { createdAt: 'desc' },
      include: PRODUCT_INCLUDE,
    });
  }

  /**
   * Workspace-scoped Product Studio index. Returns every product in the
   * caller's workspace (orderBy createdAt desc) using only existing Prisma
   * fields. `opportunity.title` is surfaced via the product's
   * ventureProposal relation (Product.ventureProposal is unique per product).
   */
  async listForWorkspace(workspaceId: string) {
    return prisma.product.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        title: true,
        ventureProposalId: true,
        createdAt: true,
        updatedAt: true,
        ventureProposal: {
          select: {
            opportunity: { select: { title: true } },
          },
        },
      },
    });
  }

  async getById(workspaceId: string, id: string) {
    const product = await prisma.product.findFirst({
      where: { id, workspaceId },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }
}
