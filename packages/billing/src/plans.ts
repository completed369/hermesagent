/**
 * The four resellable plan tiers (master spec section 3's "resell the
 * platform itself" long-term objective). Seeded by `packages/database/src/seed.ts`;
 * not founder-editable at runtime -- changing prices/limits is a deploy-time
 * decision, same posture as `DEFAULT_FINANCIAL_ASSUMPTIONS` in Phase 1.
 *
 * `priceMonthlyEur` is descriptive only in this phase: no real payment
 * processor is connected (see docs/DECISIONS.md ADR-010), so no amount here
 * is ever actually charged. Plan limits and feature entitlements are enforced
 * by the plan guard and centralized capability policy.
 */
export interface PlanDefinition {
  key: string;
  name: string;
  description: string;
  priceMonthlyEur: number;
  maxVentures: number;
  maxWorkspaceMembers: number;
  maxMarketplaceAccounts: number;
  features: string[];
}

export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    key: 'TRIAL',
    name: 'Trial',
    description: '14-day trial, full feature access, single venture.',
    priceMonthlyEur: 0,
    maxVentures: 1,
    maxWorkspaceMembers: 1,
    maxMarketplaceAccounts: 1,
    features: ['opportunities', 'board', 'products', 'finance'],
  },
  {
    key: 'STARTER',
    name: 'Starter',
    description: 'For a single founder running a handful of ventures.',
    priceMonthlyEur: 29,
    maxVentures: 3,
    maxWorkspaceMembers: 2,
    maxMarketplaceAccounts: 1,
    features: ['opportunities', 'board', 'products', 'finance'],
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    description: 'For a small team running several concurrent ventures.',
    priceMonthlyEur: 99,
    maxVentures: 10,
    maxWorkspaceMembers: 5,
    maxMarketplaceAccounts: 3,
    features: ['opportunities', 'board', 'products', 'finance', 'white_label'],
  },
  {
    key: 'AGENCY',
    name: 'Agency',
    description: 'For an agency reselling VentureOS to its own clients.',
    priceMonthlyEur: 299,
    maxVentures: 50,
    maxWorkspaceMembers: 20,
    maxMarketplaceAccounts: 10,
    features: ['opportunities', 'board', 'products', 'finance', 'white_label', 'license_export'],
  },
];

export const DEFAULT_TRIAL_LENGTH_DAYS = 14;
