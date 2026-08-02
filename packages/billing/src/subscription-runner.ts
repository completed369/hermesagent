import { prisma, Prisma } from '@ventureos/database';
import {
  PlanNotFoundError,
  SubscriptionAlreadyExistsError,
  SubscriptionNotFoundError,
} from './errors.js';
import { DEFAULT_TRIAL_LENGTH_DAYS } from './plans.js';

/** Explicit return type for subscription-with-plan reads/writes below --
 * without this annotation, `tsc`'s declaration-emit needs to name the
 * inferred Prisma payload type itself, which reaches into
 * `@prisma/client`'s generated runtime internals and fails with TS2742
 * ("cannot be named without a reference to ... this is likely not
 * portable"). Naming the type explicitly avoids that. */
type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{ include: { plan: true } }>;
type SubscriptionClient = Pick<Prisma.TransactionClient, 'plan' | 'subscription'>;

/**
 * Starts a new workspace's subscription on the TRIAL plan. Called once, at
 * workspace-creation time (see the new customer-registration flow) --
 * `Subscription.workspaceId` is `@unique`, so calling this twice for the same
 * workspace throws `SubscriptionAlreadyExistsError` rather than silently
 * creating a second, conflicting row.
 *
 * `billingMode` is always `'MOCK'`: no real payment processor is connected
 * in this phase (see docs/DECISIONS.md ADR-010), so no amount is ever
 * actually charged for the trial or any later plan change.
 */
export async function startTrialSubscription(
  workspaceId: string,
  client: SubscriptionClient = prisma,
): Promise<SubscriptionWithPlan> {
  const existing = await client.subscription.findUnique({ where: { workspaceId } });
  if (existing) {
    throw new SubscriptionAlreadyExistsError(
      `Workspace ${workspaceId} already has a subscription (${existing.id}).`,
    );
  }

  const trialPlan = await client.plan.findUnique({ where: { key: 'TRIAL' } });
  if (!trialPlan) {
    throw new PlanNotFoundError('TRIAL plan is not seeded.');
  }

  const now = new Date();
  const trialEndsAt = new Date(now);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + DEFAULT_TRIAL_LENGTH_DAYS);

  return client.subscription.create({
    data: {
      workspaceId,
      planId: trialPlan.id,
      status: 'TRIALING',
      billingMode: 'MOCK',
      trialEndsAt,
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
    },
    include: { plan: true },
  });
}

/**
 * Changes a workspace's plan (upgrade or downgrade). Does not retroactively
 * shrink usage already on the books (e.g. an existing venture over the new
 * plan's limit is not deleted) -- it only blocks *new* usage going forward,
 * enforced the next time `assertWithinVentureLimit`/etc. is called. This
 * mirrors how real billing systems handle downgrades (no silent data loss).
 */
export async function changePlan(
  workspaceId: string,
  newPlanKey: string,
): Promise<SubscriptionWithPlan> {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!subscription) {
    throw new SubscriptionNotFoundError(`Workspace ${workspaceId} has no subscription record.`);
  }

  const newPlan = await prisma.plan.findUnique({ where: { key: newPlanKey } });
  if (!newPlan) {
    throw new PlanNotFoundError(`Plan '${newPlanKey}' is not seeded.`);
  }

  return prisma.subscription.update({
    where: { workspaceId },
    data: { planId: newPlan.id },
    include: { plan: true },
  });
}

/** Moves a TRIALING or PAST_DUE subscription to ACTIVE and opens a fresh
 * monthly billing period, recording one mock (always-PAID) invoice for it.
 * No real charge is ever attempted -- `billingMode` stays `'MOCK'`. */
export async function activateSubscription(workspaceId: string): Promise<SubscriptionWithPlan> {
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "subscriptions" WHERE "workspaceId" = ${workspaceId}::uuid FOR UPDATE`,
    );
    const subscription = await tx.subscription.findUnique({
      where: { workspaceId },
      include: { plan: true },
    });
    if (!subscription) {
      throw new SubscriptionNotFoundError(`Workspace ${workspaceId} has no subscription record.`);
    }
    if (subscription.status !== 'TRIALING' && subscription.status !== 'PAST_DUE') {
      throw new SubscriptionNotFoundError(
        `Subscription cannot be activated from ${subscription.status}.`,
      );
    }

    const transitioned = await tx.subscription.updateMany({
      where: { workspaceId, status: { in: ['TRIALING', 'PAST_DUE'] } },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
    if (transitioned.count !== 1) {
      throw new SubscriptionNotFoundError('Subscription state changed before activation.');
    }

    await tx.subscriptionInvoice.create({
      data: {
        subscriptionId: subscription.id,
        amountEur: subscription.plan.priceMonthlyEur,
        status: 'PAID',
        periodStart,
        periodEnd,
      },
    });

    return tx.subscription.findUniqueOrThrow({
      where: { workspaceId },
      include: { plan: true },
    });
  });
}

/** Cancels a subscription. The workspace and its data are never deleted --
 * cancellation only blocks new usage (via the plan-guard functions, since a
 * CANCELED subscription's plan limits still apply for read access, but the
 * caller is expected to check `status` before allowing new writes). */
export async function cancelSubscription(workspaceId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!subscription) {
    throw new SubscriptionNotFoundError(`Workspace ${workspaceId} has no subscription record.`);
  }
  if (subscription.status === 'CANCELED') {
    throw new SubscriptionNotFoundError('Subscription is already canceled.');
  }

  const transitioned = await prisma.subscription.updateMany({
    where: { workspaceId, status: { not: 'CANCELED' } },
    data: { status: 'CANCELED', canceledAt: new Date() },
  });
  if (transitioned.count !== 1) {
    throw new SubscriptionNotFoundError('Subscription state changed before cancellation.');
  }
  return prisma.subscription.findUniqueOrThrow({ where: { workspaceId } });
}
