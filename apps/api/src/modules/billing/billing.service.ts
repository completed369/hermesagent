import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import {
  changePlan,
  cancelSubscription,
  activateSubscription,
  issueLicenseKey,
  revokeLicenseKey,
  validateLicenseKey,
  PlanNotFoundError,
  SubscriptionNotFoundError,
  LicenseKeyNotFoundError,
  LicenseKeyInvalidError,
} from '@ventureos/billing';
import { AuditService } from '../audit/audit.service';

/**
 * Wraps `@ventureos/billing`'s pure subscription/license logic with
 * workspace-scoped reads, audit logging, and NestJS HTTP error translation --
 * the same layering every other Phase 8-adjacent module (finance, research,
 * marketplace) uses. `@ventureos/billing`'s functions never import NestJS;
 * this service is the only place their errors are translated to HTTP
 * exceptions.
 */
@Injectable()
export class BillingService {
  constructor(private readonly auditService: AuditService) {}

  private translateError(err: unknown): Error {
    if (err instanceof SubscriptionNotFoundError || err instanceof PlanNotFoundError) {
      return new NotFoundException(err.message);
    }
    if (err instanceof LicenseKeyNotFoundError) {
      return new NotFoundException(err.message);
    }
    if (err instanceof LicenseKeyInvalidError) {
      return new ConflictException(err.message);
    }
    return err instanceof Error ? err : new Error('Unknown billing error');
  }

  async getSummary(workspaceId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { workspaceId },
      include: { plan: true, invoices: { orderBy: { issuedAt: 'desc' }, take: 12 } },
    });
    if (!subscription) {
      throw new NotFoundException('Workspace has no subscription record');
    }

    const [ventureCount, memberCount, marketplaceAccountCount, plans] = await Promise.all([
      prisma.ventureProposal.count({ where: { workspaceId } }),
      prisma.workspaceMember.count({ where: { workspaceId } }),
      prisma.marketplaceAccount.count({ where: { workspaceId } }),
      prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthlyEur: 'asc' } }),
    ]);

    return {
      subscription,
      usage: {
        ventures: { used: ventureCount, limit: subscription.plan.maxVentures },
        members: { used: memberCount, limit: subscription.plan.maxWorkspaceMembers },
        marketplaceAccounts: {
          used: marketplaceAccountCount,
          limit: subscription.plan.maxMarketplaceAccounts,
        },
      },
      availablePlans: plans,
    };
  }

  async changePlan(workspaceId: string, planKey: string, actorId: string) {
    try {
      const updated = await changePlan(workspaceId, planKey);
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'SUBSCRIPTION_PLAN_CHANGED',
        entityType: 'Subscription',
        entityId: updated.id,
        after: { planKey } as unknown as Record<string, unknown>,
      });
      return updated;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async cancel(workspaceId: string, actorId: string) {
    try {
      const updated = await cancelSubscription(workspaceId);
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'SUBSCRIPTION_CANCELED',
        entityType: 'Subscription',
        entityId: updated.id,
      });
      return updated;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async reactivate(workspaceId: string, actorId: string) {
    try {
      const updated = await activateSubscription(workspaceId);
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'SUBSCRIPTION_ACTIVATED',
        entityType: 'Subscription',
        entityId: updated.id,
      });
      return updated;
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async listLicenseKeys(workspaceId: string) {
    return prisma.licenseKey.findMany({ where: { workspaceId }, orderBy: { issuedAt: 'desc' } });
  }

  async issueLicenseKey(workspaceId: string, expiresInDays: number | undefined, actorId: string) {
    const key = await issueLicenseKey(workspaceId, expiresInDays);
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'LICENSE_KEY_ISSUED',
      entityType: 'LicenseKey',
      entityId: key.id,
      after: { key: key.key, expiresAt: key.expiresAt } as unknown as Record<string, unknown>,
    });
    return key;
  }

  async revokeLicenseKey(workspaceId: string, id: string, actorId: string) {
    const existing = await prisma.licenseKey.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('License key not found');
    }
    const revoked = await revokeLicenseKey(id);
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'LICENSE_KEY_REVOKED',
      entityType: 'LicenseKey',
      entityId: id,
    });
    return revoked;
  }

  /** Validates a license key without requiring an authenticated session --
   * used by a self-hosted install's own startup check against this
   * reference instance, not by the dashboard UI. Deliberately does not leak
   * which workspace a key belongs to beyond what `validateLicenseKey`
   * already returns. */
  async validateLicenseKeyPublic(key: string) {
    try {
      const licenseKey = await validateLicenseKey(key);
      return { valid: true, status: licenseKey.status, expiresAt: licenseKey.expiresAt };
    } catch (err) {
      throw this.translateError(err);
    }
  }
}
