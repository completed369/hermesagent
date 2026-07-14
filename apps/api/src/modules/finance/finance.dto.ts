import { z } from 'zod';

export const upsertFinancialAssumptionSchema = z.object({
  productPriceEur: z.number().positive().optional(),
  marketplaceFeeRate: z.number().min(0).max(1).optional(),
  paymentProcessingFeeRate: z.number().min(0).max(1).optional(),
  listingFeeEur: z.number().nonnegative().optional(),
  refundRate: z.number().min(0).max(1).optional(),
  discountRate: z.number().min(0).max(1).optional(),
  vatRate: z.number().min(0).max(1).optional(),
  aiGenerationCostEur: z.number().nonnegative().optional(),
  monthlyOverheadAllocationEur: z.number().nonnegative().optional(),
  forecastPeriodDays: z.number().int().positive().optional(),
  targetContributionMarginRate: z.number().min(0).max(1).optional(),
  minimumProfitConfidence: z.number().min(0).max(100).optional(),
});

export const generateForecastSchema = z.object({
  baseUnitsSold: z.number().int().nonnegative(),
  scenarioMultipliers: z
    .object({ low: z.number().positive(), high: z.number().positive() })
    .optional(),
});

export const createExpenseSchema = z.object({
  category: z.enum([
    'AI_GENERATION',
    'MARKETPLACE_FEE',
    'RESEARCH',
    'ADVERTISING',
    'OVERHEAD',
    'OTHER',
  ]),
  amountEur: z.number().positive(),
  description: z.string().min(1),
  incurredAt: z.string().datetime(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const createRevenueEntrySchema = z.object({
  listingVersionId: z.string().uuid().optional(),
  unitsSold: z.number().int().nonnegative(),
  grossRevenueEur: z.number().nonnegative(),
  marketplaceFeeEur: z.number().nonnegative().default(0),
  paymentProcessingFeeEur: z.number().nonnegative().default(0),
  listingFeeEur: z.number().nonnegative().default(0),
  vatEur: z.number().nonnegative().default(0),
  refundsEur: z.number().nonnegative().default(0),
  occurredAt: z.string().datetime(),
});
export type CreateRevenueEntryInput = z.infer<typeof createRevenueEntrySchema>;

export const createBudgetSchema = z.object({
  ventureProposalId: z.string().uuid().optional(),
  name: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  totalLimitEur: z.number().positive(),
  allocations: z
    .array(
      z.object({
        category: z.enum([
          'AI_MODEL_USAGE',
          'RESEARCH',
          'ADVERTISING',
          'PRODUCT_GENERATION',
          'OTHER',
        ]),
        limitEur: z.number().positive(),
      }),
    )
    .default([]),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const createExperimentSchema = z.object({
  listingVersionId: z.string().uuid().optional(),
  name: z.string().min(1),
  hypothesis: z.string().min(1),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        isControl: z.boolean().optional(),
      }),
    )
    .min(1),
  metrics: z
    .array(
      z.object({
        name: z.enum([
          'IMPRESSIONS',
          'CLICKS',
          'CTR',
          'CONVERSIONS',
          'CONVERSION_RATE',
          'REFUND_RATE',
          'REVENUE_EUR',
          'OTHER',
        ]),
        targetValue: z.number().optional(),
        unit: z.string().optional(),
      }),
    )
    .min(1),
});
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;

export const recordExperimentResultSchema = z.object({
  experimentVariantId: z.string().uuid(),
  experimentMetricId: z.string().uuid(),
  value: z.number(),
  sampleSize: z.number().int().positive().optional(),
});
export type RecordExperimentResultInput = z.infer<typeof recordExperimentResultSchema>;

export const decideExperimentSchema = z.object({
  decision: z.enum(['SCALE', 'KILL', 'ITERATE', 'HOLD']),
  rationale: z.string().min(1),
  approvalRequestId: z.string().uuid().optional(),
});
export type DecideExperimentInput = z.infer<typeof decideExperimentSchema>;
