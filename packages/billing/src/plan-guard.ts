import { prisma } from '@ventureos/database';
import { PlanLimitExceededError, SubscriptionNotFoundError } from './errors.js';

interface ResolvedPlanLimits {
  subscriptionId: string;
  planKey: string;
  maxVentures: number;
  maxWorkspaceMembers: number;
  maxMarketplaceAccounts: number;
}

/** Loads the workspace's current subscription + plan. Fails closed
 * (`SubscriptionNotFoundError`) if a workspace somehow has no subscription --
 * every workspace gets one at creation time (see `subscription-runner.ts`),
 * so this should only ever be reached by a data-integrity bug, never a real
 * customer path. */
export async function resolvePlanLimits(workspaceId: string): Promise<ResolvedPlanLimits> {
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });

  if (!subscription) {
    throw new SubscriptionNotFoundError(`Workspace ${workspaceId} has no subscription record.`);
  }

  return {
    subscriptionId: subscription.id,
    planKey: subscription.plan.key,
    maxVentures: subscription.plan.maxVentures,
    maxWorkspaceMembers: subscription.plan.maxWorkspaceMembers,
    maxMarketplaceAccounts: subscription.plan.maxMarketplaceAccounts,
  };
}

/** Throws PlanLimitExceededError (fail closed) if creating one more venture
 * (a new VentureProposal, via Opportunity promotion) would exceed the
 * workspace's plan's `maxVentures`. Counts existing `VentureProposal` rows --
 * the Opportunity -> VentureProposal 1:1 relation already supports many
 * concurrent ventures per workspace, this is purely a quota check on top of
 * that existing spine, not a new venture-tracking mechanism. */
export async function assertWithinVentureLimit(workspaceId: string): Promise<void> {
  const limits = await resolvePlanLimits(workspaceId);
  const currentCount = await prisma.ventureProposal.count({ where: { workspaceId } });

  if (currentCount >= limits.maxVentures) {
    throw new PlanLimitExceededError(
      `Workspace already has ${currentCount} venture(s), which meets or exceeds the ${limits.planKey} plan's limit of ${limits.maxVentures}. Upgrade the plan to promote another opportunity.`,
    );
  }
}

/** Throws PlanLimitExceededError if adding one more workspace member would
 * exceed the plan's `maxWorkspaceMembers`. */
export async function assertWithinMemberLimit(workspaceId: string): Promise<void> {
  const limits = await resolvePlanLimits(workspaceId);
  const currentCount = await prisma.workspaceMember.count({ where: { workspaceId } });

  if (currentCount >= limits.maxWorkspaceMembers) {
    throw new PlanLimitExceededError(
      `Workspace already has ${currentCount} member(s), which meets or exceeds the ${limits.planKey} plan's limit of ${limits.maxWorkspaceMembers}. Upgrade the plan to invite another member.`,
    );
  }
}

/** Throws PlanLimitExceededError if connecting one more marketplace account
 * would exceed the plan's `maxMarketplaceAccounts`. */
export async function assertWithinMarketplaceAccountLimit(workspaceId: string): Promise<void> {
  const limits = await resolvePlanLimits(workspaceId);
  const currentCount = await prisma.marketplaceAccount.count({ where: { workspaceId } });

  if (currentCount >= limits.maxMarketplaceAccounts) {
    throw new PlanLimitExceededError(
      `Workspace already has ${currentCount} marketplace account(s), which meets or exceeds the ${limits.planKey} plan's limit of ${limits.maxMarketplaceAccounts}. Upgrade the plan to connect another marketplace account.`,
    );
  }
}
