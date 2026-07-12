import { z } from 'zod';

/**
 * Deterministic finance assumptions. These are development defaults per
 * VentureOS master spec section 19. They are NOT legal or financial advice.
 * All values are configurable per workspace via FinancialAssumption records;
 * these are only the seeded starting point.
 */
export const FinancialAssumptionsSchema = z.object({
  productPriceEur: z.number().positive().default(14.99),
  marketplaceFeeRate: z.number().min(0).max(1).default(0.065),
  paymentProcessingFeeRate: z.number().min(0).max(1).default(0.04),
  listingFeeEur: z.number().nonnegative().default(0.2),
  refundRate: z.number().min(0).max(1).default(0.03),
  discountRate: z.number().min(0).max(1).default(0),
  vatRate: z.number().min(0).max(1).default(0),
  aiGenerationCostEur: z.number().nonnegative().default(5),
  monthlyOverheadAllocationEur: z.number().nonnegative().default(20),
  forecastPeriodDays: z.number().int().positive().default(90),
  targetContributionMarginRate: z.number().min(0).max(1).default(0.6),
  minimumProfitConfidence: z.number().min(0).max(100).default(70),
});
export type FinancialAssumptions = z.infer<typeof FinancialAssumptionsSchema>;

export const DEFAULT_FINANCIAL_ASSUMPTIONS: FinancialAssumptions =
  FinancialAssumptionsSchema.parse({});
