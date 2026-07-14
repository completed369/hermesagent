import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, DEFAULT_TRIAL_LENGTH_DAYS } from '../plans';

describe('DEFAULT_PLANS', () => {
  it('defines exactly the four resellable tiers with unique keys', () => {
    const keys = DEFAULT_PLANS.map((p) => p.key);
    expect(keys).toEqual(['TRIAL', 'STARTER', 'GROWTH', 'AGENCY']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has strictly increasing venture/member/marketplace-account limits as price increases', () => {
    for (let i = 1; i < DEFAULT_PLANS.length; i++) {
      const prev = DEFAULT_PLANS[i - 1]!;
      const curr = DEFAULT_PLANS[i]!;
      expect(curr.priceMonthlyEur).toBeGreaterThanOrEqual(prev.priceMonthlyEur);
      expect(curr.maxVentures).toBeGreaterThanOrEqual(prev.maxVentures);
      expect(curr.maxWorkspaceMembers).toBeGreaterThanOrEqual(prev.maxWorkspaceMembers);
      expect(curr.maxMarketplaceAccounts).toBeGreaterThanOrEqual(prev.maxMarketplaceAccounts);
    }
  });

  it('TRIAL plan is free and limited to a single venture', () => {
    const trial = DEFAULT_PLANS.find((p) => p.key === 'TRIAL')!;
    expect(trial.priceMonthlyEur).toBe(0);
    expect(trial.maxVentures).toBe(1);
  });

  it('only GROWTH and AGENCY include white_label', () => {
    for (const plan of DEFAULT_PLANS) {
      const hasWhiteLabel = plan.features.includes('white_label');
      expect(hasWhiteLabel).toBe(plan.key === 'GROWTH' || plan.key === 'AGENCY');
    }
  });

  it('DEFAULT_TRIAL_LENGTH_DAYS is a sane positive number', () => {
    expect(DEFAULT_TRIAL_LENGTH_DAYS).toBeGreaterThan(0);
    expect(DEFAULT_TRIAL_LENGTH_DAYS).toBeLessThanOrEqual(30);
  });
});
