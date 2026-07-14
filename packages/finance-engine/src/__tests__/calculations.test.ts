import { describe, expect, it } from 'vitest';
import { DEFAULT_FINANCIAL_ASSUMPTIONS } from '../assumptions';
import {
  calculateBreakEven,
  calculateScenarios,
  calculateUnitEconomics,
  roundToCents,
} from '../calculations';

describe('roundToCents', () => {
  it('rounds correctly avoiding float drift', () => {
    expect(roundToCents(1.005)).toBeCloseTo(1.01, 2);
    expect(roundToCents(14.9949)).toBeCloseTo(14.99, 2);
  });
});

describe('calculateUnitEconomics', () => {
  it('matches the seeded default assumptions deterministically', () => {
    const result = calculateUnitEconomics(DEFAULT_FINANCIAL_ASSUMPTIONS);
    // price 14.99, marketplace fee 6.5%, payment 4%, listing 0.20, refund 3%
    expect(result.productPriceEur).toBeCloseTo(14.99, 2);
    expect(result.marketplaceFeeEur).toBeCloseTo(0.97, 2);
    expect(result.paymentProcessingFeeEur).toBeCloseTo(0.6, 2);
    expect(result.listingFeeEur).toBeCloseTo(0.2, 2);
    expect(result.refundAllowanceEur).toBeCloseTo(0.45, 2);
    expect(result.netRevenueEur).toBeCloseTo(12.77, 2);
    expect(result.contributionMarginEur).toBeCloseTo(12.77, 2);
  });

  it('is a pure function (same input -> same output)', () => {
    const a = calculateUnitEconomics(DEFAULT_FINANCIAL_ASSUMPTIONS);
    const b = calculateUnitEconomics(DEFAULT_FINANCIAL_ASSUMPTIONS);
    expect(a).toEqual(b);
  });
});

describe('calculateBreakEven', () => {
  it('computes break-even units from fixed costs / contribution margin', () => {
    const result = calculateBreakEven(DEFAULT_FINANCIAL_ASSUMPTIONS);
    // fixed = 5 + 20 = 25; margin ~12.77 => ceil(25/12.77) = 2
    expect(result.fixedCostsEur).toBeCloseTo(25, 2);
    expect(result.breakEvenUnits).toBe(2);
  });

  it('returns Infinity when contribution margin is not positive', () => {
    const result = calculateBreakEven({
      ...DEFAULT_FINANCIAL_ASSUMPTIONS,
      marketplaceFeeRate: 0.9,
      paymentProcessingFeeRate: 0.5,
    });
    expect(result.breakEvenUnits).toBe(Infinity);
  });
});

describe('calculateScenarios', () => {
  it('produces low/base/high with low <= base <= high net profit', () => {
    const [low, base, high] = calculateScenarios(DEFAULT_FINANCIAL_ASSUMPTIONS, 100);
    expect(low.unitsSold).toBeLessThan(base.unitsSold);
    expect(base.unitsSold).toBeLessThan(high.unitsSold);
    expect(low.netProfitEur).toBeLessThanOrEqual(base.netProfitEur);
    expect(base.netProfitEur).toBeLessThanOrEqual(high.netProfitEur);
  });

  it('never produces negative unit counts', () => {
    const [low] = calculateScenarios(DEFAULT_FINANCIAL_ASSUMPTIONS, 1, { low: 0, high: 2 });
    expect(low.unitsSold).toBe(0);
    expect(low.grossRevenueEur).toBe(0);
  });
});
