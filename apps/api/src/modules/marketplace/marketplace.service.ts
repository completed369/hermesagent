import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CapabilityPolicyDeniedError, prisma, Prisma } from '@ventureos/database';
import { loadEnv } from '@ventureos/config';
import { getTemporalClient } from '@ventureos/workflows';
import {
  prepareListingForPublication,
  requestPublicationApproval,
  publishListing,
  publicationPreparationAuditAction,
  MarketplaceBlockedError,
} from '@ventureos/marketplace-connectors';
import { AuditService } from '../audit/audit.service';
import { enforceCapabilityAdmission } from '../../common/policy/capability-admission';

const STATUS_INCLUDE = {
  listing: true,
  publicationAttempts: {
    orderBy: { attemptedAt: 'desc' },
    include: { marketplaceAccount: true },
  },
  approvalRequests: {
    where: { kind: 'PUBLICATION' },
    orderBy: { createdAt: 'desc' },
    include: { decisions: { orderBy: { decidedAt: 'desc' } } },
  },
} satisfies Prisma.ListingVersionInclude;

/**
 * Phase 6 API surface: prepares a (mock) draft listing on the marketplace,
 * raises the second/distinct PUBLICATION approval, and executes the (mock)
 * publish once that approval is granted. The actual fail-closed gating,
 * idempotency, and hash re-validation all live in
 * @ventureos/marketplace-connectors -- this service only translates its
 * results/errors into HTTP responses and records the audit trail (master
 * spec: every external-write-adjacent action must be audit-logged).
 */
@Injectable()
export class MarketplaceService {
  constructor(private readonly auditService: AuditService) {}

  private async getScopedListingVersion(workspaceId: string, listingVersionId: string) {
    // Phase 8 tenant-isolation audit: filter by workspace in the query
    // itself (via the listing relation) rather than fetching first and
    // discarding a mismatch after the fact -- defense in depth, even though
    // the prior post-fetch check already failed closed and never returned
    // cross-workspace data.
    const listingVersion = await prisma.listingVersion.findFirst({
      where: { id: listingVersionId, listing: { workspaceId } },
      include: STATUS_INCLUDE,
    });
    if (!listingVersion) {
      throw new NotFoundException('Listing version not found');
    }
    return listingVersion;
  }

  async getStatus(workspaceId: string, listingVersionId: string) {
    return this.getScopedListingVersion(workspaceId, listingVersionId);
  }

  /**
   * Primary automated path (task #71): starts the durable
   * `marketplacePublicationWorkflow` (apps/worker), which orchestrates
   * prepare -> raise PUBLICATION approval -> signal-wait for the founder's
   * decision -> publish, entirely inside the workflow -- never inline in
   * this HTTP request, mirroring ProductsService.startGeneration exactly.
   * The synchronous prepare/requestApproval/publish endpoints below remain
   * for manual reconciliation (retrying a single stuck step without
   * re-running the whole workflow).
   */
  async startWorkflow(workspaceId: string, listingVersionId: string, actorId: string) {
    await enforceCapabilityAdmission(workspaceId, 'MARKETPLACE_DRAFT');
    const listingVersion = await this.getScopedListingVersion(workspaceId, listingVersionId);
    const existingAccount = await prisma.marketplaceAccount.findFirst({
      where: { workspaceId, marketplace: listingVersion.listing.marketplace },
      select: { id: true },
    });
    if (!existingAccount) {
      await enforceCapabilityAdmission(workspaceId, 'MARKETPLACE_CONNECTION');
    }

    const env = loadEnv();
    const client = await getTemporalClient();
    const workflowId = `marketplace-publication-${listingVersionId}-${randomUUID()}`;
    const handle = await client.start('marketplacePublicationWorkflow', {
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [{ workspaceId, listingVersionId, actorId }],
    });

    await this.auditService.record(workspaceId, {
      actorId,
      action: 'PUBLICATION_WORKFLOW_STARTED',
      entityType: 'ListingVersion',
      entityId: listingVersionId,
      workflowId,
    });

    return { workflowId, temporalRunId: handle.firstExecutionRunId };
  }

  async prepare(workspaceId: string, listingVersionId: string, actorId: string) {
    await enforceCapabilityAdmission(workspaceId, 'MARKETPLACE_DRAFT');
    await this.getScopedListingVersion(workspaceId, listingVersionId);
    try {
      const result = await prepareListingForPublication({ workspaceId, listingVersionId });
      await this.auditService.record(workspaceId, {
        actorId,
        action: publicationPreparationAuditAction(result.status),
        entityType: 'ListingVersion',
        entityId: listingVersionId,
        after: result as unknown as Record<string, unknown>,
      });
      return result;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async requestApproval(workspaceId: string, listingVersionId: string, actorId: string) {
    await enforceCapabilityAdmission(workspaceId, 'MARKETPLACE_DRAFT');
    await this.getScopedListingVersion(workspaceId, listingVersionId);
    try {
      const result = await requestPublicationApproval({
        workspaceId,
        listingVersionId,
        requestedBy: actorId,
      });
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'PUBLICATION_APPROVAL_REQUESTED',
        entityType: 'ListingVersion',
        entityId: listingVersionId,
        after: result as unknown as Record<string, unknown>,
      });
      return result;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async publish(
    workspaceId: string,
    listingVersionId: string,
    approvalRequestId: string,
    actorId: string,
  ) {
    await enforceCapabilityAdmission(workspaceId, 'MARKETPLACE_PUBLICATION');
    await this.getScopedListingVersion(workspaceId, listingVersionId);
    try {
      const result = await publishListing({ workspaceId, listingVersionId, approvalRequestId });
      await this.auditService.record(workspaceId, {
        actorId,
        action: result.replayed
          ? 'PUBLICATION_REPLAYED'
          : result.status === 'PUBLISHED'
            ? 'PUBLICATION_PUBLISHED'
            : 'PUBLICATION_FAILED',
        entityType: 'ListingVersion',
        entityId: listingVersionId,
        after: result as unknown as Record<string, unknown>,
        approvalReference: approvalRequestId,
      });
      return result;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private translateError(err: unknown): Error {
    if (err instanceof CapabilityPolicyDeniedError) {
      return new ForbiddenException('Operation is not available');
    }
    if (err instanceof MarketplaceBlockedError) {
      if (err.message.toLowerCase().includes('not found')) {
        return new NotFoundException(err.message);
      }
      return new ConflictException(err.message);
    }
    return err instanceof Error ? err : new Error('Unknown marketplace error');
  }
}
