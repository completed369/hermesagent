import { prisma } from '@ventureos/database';

type TestSubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';

export async function entitleTestWorkspace(
  workspaceId: string,
  options: {
    status?: TestSubscriptionStatus;
    trialEndsAt?: Date | null;
    features?: string[];
    planActive?: boolean;
    maxMarketplaceAccounts?: number;
    maxVentures?: number;
  } = {},
): Promise<void> {
  // Direct package-boundary integration tests must declare the authoritative
  // mock providers explicitly; production code intentionally fails closed
  // when these process-level selections are absent.
  process.env.AI_PROVIDER = 'mock';
  process.env.STORAGE_PROVIDER = 'mock';
  process.env.MARKETPLACE_ETSY_MODE = 'mock';

  const testPlanKey = `INTEGRATION_TEST_${workspaceId}`;
  const plan = await prisma.plan.upsert({
    where: { key: testPlanKey },
    update: {
      isActive: options.planActive ?? true,
      features: options.features ?? [
        'opportunities',
        'board',
        'products',
        'ventures',
        'finance',
        'white_label',
        'license_export',
      ],
      maxMarketplaceAccounts: options.maxMarketplaceAccounts ?? 100,
      maxVentures: options.maxVentures ?? 100,
    },
    create: {
      key: testPlanKey,
      name: 'Integration Test Entitled',
      priceMonthlyEur: 0,
      maxVentures: options.maxVentures ?? 100,
      maxMarketplaceAccounts: options.maxMarketplaceAccounts ?? 100,
      maxWorkspaceMembers: 100,
      features: options.features ?? [
        'opportunities',
        'board',
        'products',
        'ventures',
        'finance',
        'white_label',
        'license_export',
      ],
      isActive: options.planActive ?? true,
    },
  });

  await prisma.subscription.upsert({
    where: { workspaceId },
    update: {
      planId: plan.id,
      status: options.status ?? 'ACTIVE',
      trialEndsAt: options.trialEndsAt ?? null,
    },
    create: {
      workspaceId,
      planId: plan.id,
      status: options.status ?? 'ACTIVE',
      trialEndsAt: options.trialEndsAt ?? null,
    },
  });
}

export async function cleanupEntitledTestWorkspace(workspaceId: string): Promise<void> {
  await prisma.securityEvent.deleteMany({ where: { workspaceId } });
  await prisma.subscription.deleteMany({ where: { workspaceId } });
  await prisma.plan.deleteMany({ where: { key: `INTEGRATION_TEST_${workspaceId}` } });
}
