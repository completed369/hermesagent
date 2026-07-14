import { describe, expect, it } from 'vitest';
import { DEFAULT_FINANCIAL_ASSUMPTIONS, FinancialAssumptionsSchema } from '../assumptions';

describe('FinancialAssumptionsSchema defaults', () => {
  it('parses an empty object into the documented development defaults', () => {
    const parsed = FinancialAssumptionsSchema.parse({});
    expect(parsed).toEqual(DEFAULT_FINANCIAL_ASSUMPTIONS);
    expect(parsed.productPriceEur).toBe(14.99);
    expect(parsed.marketplaceFeeRate).toBe(0.065);
    expect(parsed.paymentProcessingFeeRate).toBe(0.04);
    expect(parsed.listingFeeEur).toBe(0.2);
    expect(parsed.refundRate).toBe(0.03);
    expect(parsed.discountRate).toBe(0);
    expect(parsed.vatRate).toBe(0);
    expect(parsed.aiGenerationCostEur).toBe(5);
    expect(parsed.monthlyOverheadAllocationEur).toBe(20);
    expect(parsed.forecastPeriodDays).toBe(90);
    expect(parsed.targetContributionMarginRate).toBe(0.6);
    expect(parsed.minimumProfitConfidence).toBe(70);
  });

  it('is a pure function -- parsing {} twice yields deeply-equal, independently-usable objects', () => {
    const a = FinancialAssumptionsSchema.parse({});
    const b = FinancialAssumptionsSchema.parse({});
    expect(a).toEqual(b);
  });

  it('allows overriding individual fields while keeping the rest at their defaults', () => {
    const parsed = FinancialAssumptionsSchema.parse({ productPriceEur: 29.99 });
    expect(parsed.productPriceEur).toBe(29.99);
    expect(parsed.marketplaceFeeRate).toBe(DEFAULT_FINANCIAL_ASSUMPTIONS.marketplaceFeeRate);
  });
});

describe('FinancialAssumptionsSchema validation (fail-closed on bad input)', () => {
  it('rejects a non-positive productPriceEur', () => {
    expect(() => FinancialAssumptionsSchema.parse({ productPriceEur: 0 })).toThrow();
    expect(() => FinancialAssumptionsSchema.parse({ productPriceEur: -5 })).toThrow();
  });

  it('rejects rate fields outside [0, 1]', () => {
    expect(() => FinancialAssumptionsSchema.parse({ marketplaceFeeRate: 1.5 })).toThrow();
    expect(() => FinancialAssumptionsSchema.parse({ marketplaceFeeRate: -0.1 })).toThrow();
    expect(() => FinancialAssumptionsSchema.parse({ refundRate: 1.01 })).toThrow();
    expect(() =>
      FinancialAssumptionsSchema.parse({ targetContributionMarginRate: -0.01 }),
    ).toThrow();
  });

  it('rejects a negative aiGenerationCostEur / monthlyOverheadAllocationEur', () => {
    expect(() => FinancialAssumptionsSchema.parse({ aiGenerationCostEur: -1 })).toThrow();
    expect(() => FinancialAssumptionsSchema.parse({ monthlyOverheadAllocationEur: -1 })).toThrow();
  });

  it('rejects a non-integer or non-positive forecastPeriodDays', () => {
    expect(() => FinancialAssumptionsSchema.parse({ forecastPeriodDays: 0 })).toThrow();
    expect(() => FinancialAssumptionsSchema.parse({ forecastPeriodDays: 30.5 })).toThrow();
  });

  it('rejects minimumProfitConfidence outside [0, 100]', () => {
    expect(() => FinancialAssumptionsSchema.parse({ minimumProfitConfidence: 101 })).toThrow();
    expect(() => FinancialAssumptionsSchema.parse({ minimumProfitConfidence: -1 })).toThrow();
  });
});
