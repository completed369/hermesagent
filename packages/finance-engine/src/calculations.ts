import type { FinancialAssumptions } from './assumptions';

export interface UnitEconomics {
  productPriceEur: number;
  marketplaceFeeEur: number;
  paymentProcessingFeeEur: number;
  listingFeeEur: number;
  vatEur: number;
  refundAllowanceEur: number;
  grossRevenueEur: number;
  netRevenueEur: number;
  variableCostEur: number;
  contributionMarginEur: number;
  contributionMarginRate: number;
}

/** Round to the nearest cent using banker-safe rounding to avoid float drift. */
export function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes deterministic per-unit economics for a single sale.
 * This is the ONLY source of truth for arithmetic; agents may interpret
 * these numbers in prose but must never recompute them via free-text reasoning.
 */
export function calculateUnitEconomics(a: FinancialAssumptions): UnitEconomics {
  const price = a.productPriceEur * (1 - a.discountRate);
  const marketplaceFee = price * a.marketplaceFeeRate;
  const paymentFee = price * a.paymentProcessingFeeRate;
  const vat = price * a.vatRate;
  const refundAllowance = price * a.refundRate;
  const grossRevenue = price;
  const netRevenue = price - marketplaceFee - paymentFee - a.listingFeeEur - vat - refundAllowance;
  const variableCost = marketplaceFee + paymentFee + a.listingFeeEur + vat + refundAllowance;
  const contributionMargin = grossRevenue - variableCost;

  return {
    productPriceEur: roundToCents(price),
    marketplaceFeeEur: roundToCents(marketplaceFee),
    paymentProcessingFeeEur: roundToCents(paymentFee),
    listingFeeEur: roundToCents(a.listingFeeEur),
    vatEur: roundToCents(vat),
    refundAllowanceEur: roundToCents(refundAllowance),
    grossRevenueEur: roundToCents(grossRevenue),
    netRevenueEur: roundToCents(netRevenue),
    variableCostEur: roundToCents(variableCost),
    contributionMarginEur: roundToCents(contributionMargin),
    contributionMarginRate: grossRevenue > 0 ? roundToCents((contributionMargin / grossRevenue) * 100) / 100 : 0,
  };
}

export interface BreakEvenResult {
  breakEvenUnits: number;
  breakEvenRevenueEur: number;
  fixedCostsEur: number;
}

/**
 * Break-even units = fixed costs / contribution margin per unit.
 * Fixed costs = one-off AI/generation cost + monthly overhead allocation.
 */
export function calculateBreakEven(a: FinancialAssumptions): BreakEvenResult {
  const unit = calculateUnitEconomics(a);
  const fixedCosts = a.aiGenerationCostEur + a.monthlyOverheadAllocationEur;
  if (unit.contributionMarginEur <= 0) {
    return { breakEvenUnits: Infinity, breakEvenRevenueEur: Infinity, fixedCostsEur: roundToCents(fixedCosts) };
  }
  const units = Math.ceil(fixedCosts / unit.contributionMarginEur);
  return {
    breakEvenUnits: units,
    breakEvenRevenueEur: roundToCents(units * unit.grossRevenueEur),
    fixedCostsEur: roundToCents(fixedCosts),
  };
}

export interface ScenarioProjection {
  scenario: 'LOW' | 'BASE' | 'HIGH';
  unitsSold: number;
  grossRevenueEur: number;
  netRevenueEur: number;
  totalVariableCostEur: number;
  fixedCostsEur: number;
  grossProfitEur: number;
  netProfitEur: number;
}

/**
 * Produces low/base/high scenarios from a single unit-sold estimate for the
 * base case, using configurable multipliers (defaults: 0.5x / 1x / 1.75x).
 */
export function calculateScenarios(
  a: FinancialAssumptions,
  baseUnitsSold: number,
  multipliers: { low: number; high: number } = { low: 0.5, high: 1.75 },
): ScenarioProjection[] {
  const unit = calculateUnitEconomics(a);
  const fixedCosts = a.aiGenerationCostEur + a.monthlyOverheadAllocationEur;

  const build = (scenario: ScenarioProjection['scenario'], units: number): ScenarioProjection => {
    const roundedUnits = Math.max(0, Math.round(units));
    const grossRevenue = roundedUnits * unit.grossRevenueEur;
    const netRevenue = roundedUnits * unit.netRevenueEur;
    const totalVariableCost = roundedUnits * unit.variableCostEur;
    const grossProfit = grossRevenue - totalVariableCost;
    const netProfit = netRevenue - fixedCosts;
    return {
      scenario,
      unitsSold: roundedUnits,
      grossRevenueEur: roundToCents(grossRevenue),
      netRevenueEur: roundToCents(netRevenue),
      totalVariableCostEur: roundToCents(totalVariableCost),
      fixedCostsEur: roundToCents(fixedCosts),
      grossProfitEur: roundToCents(grossProfit),
      netProfitEur: roundToCents(netProfit),
    };
  };

  return [
    build('LOW', baseUnitsSold * multipliers.low),
    build('BASE', baseUnitsSold),
    build('HIGH', baseUnitsSold * multipliers.high),
  ];
}
