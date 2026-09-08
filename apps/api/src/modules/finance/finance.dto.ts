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

const signedBigIntMaximum = 9_223_372_036_854_775_807n;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

function canonicalNonNegativeBigIntSchema(field: string) {
  return z
    .string()
    .regex(/^(0|[1-9]\d{0,18})$/, `${field} must be a canonical non-negative integer string`)
    .transform((value) => BigInt(value))
    .refine((value) => value <= signedBigIntMaximum, `${field} exceeds BIGINT range`);
}

export const revenueRunIdSchema = z.string().uuid();
export const revenueRunFactIdSchema = z.string().uuid();

export const createRevenueRunPlanSchema = z
  .object({
    opportunityId: z.string().uuid(),
    ventureProposalId: z.string().uuid(),
    approvalRequestId: z.string().uuid().optional(),
    experimentId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    expectedRevenueMinorUnits: canonicalNonNegativeBigIntSchema('expectedRevenueMinorUnits'),
    expectedCostMinorUnits: canonicalNonNegativeBigIntSchema('expectedCostMinorUnits'),
    downsideMinorUnits: canonicalNonNegativeBigIntSchema('downsideMinorUnits'),
    confidenceBps: z.number().int().min(0).max(10_000),
    timeToCashDays: z.number().int().min(0).max(36_500),
    forecastEvidenceHash: sha256Schema,
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.trim() === value, 'idempotencyKey must be trimmed'),
  })
  .superRefine((value, ctx) => {
    if (value.runId && !value.taskId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runId'],
        message: 'runId requires the exact taskId',
      });
    }
  });
export type CreateRevenueRunPlanInput = z.infer<typeof createRevenueRunPlanSchema>;

export const recordRevenueRunCostReconciliationSchema = z.object({
  overlapMinorUnits: canonicalNonNegativeBigIntSchema('overlapMinorUnits'),
  basisReference: z
    .string()
    .min(1)
    .max(500)
    .refine((value) => value.trim() === value, 'basisReference must be trimmed'),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value.trim() === value, 'idempotencyKey must be trimmed'),
});
export type RecordRevenueRunCostReconciliationInput = z.infer<
  typeof recordRevenueRunCostReconciliationSchema
>;

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
          'SUPPORT_CONTACTS',
          'SUPPORT_MINUTES',
          'QUALITY_INCIDENTS',
          'OTHER',
        ]),
        targetValue: z.number().optional(),
        unit: z.string().optional(),
      }),
    )
    .min(1),
});
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;

export const commercialObservationEvidenceModeSchema = z.enum(['REAL', 'MOCK']);
export const commercialObservationSourceTypeSchema = z.enum([
  'MARKETPLACE_EXPORT',
  'CUSTOMER_SUPPORT',
  'FOUNDER_OBSERVED',
  'MANUAL_IMPORT',
  'SYNTHETIC',
]);

export const recordExperimentResultSchema = z
  .object({
    experimentVariantId: z.string().uuid(),
    experimentMetricId: z.string().uuid(),
    value: z.number(),
    sampleSize: z.number().int().positive().optional(),
    evidenceMode: commercialObservationEvidenceModeSchema.default('MOCK'),
    sourceType: commercialObservationSourceTypeSchema.default('SYNTHETIC'),
    sourceRef: z.string().trim().min(1).max(1000).optional(),
    observedAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.evidenceMode !== 'REAL') return;
    if (value.sourceType === 'SYNTHETIC') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceType'],
        message: 'REAL commercial evidence cannot use the SYNTHETIC source type',
      });
    }
    if (!value.sourceRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceRef'],
        message: 'REAL commercial evidence requires a source reference',
      });
    }
    if (!value.observedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['observedAt'],
        message: 'REAL commercial evidence requires an observedAt timestamp',
      });
    }
  });
export type RecordExperimentResultInput = z.infer<typeof recordExperimentResultSchema>;

export const decideExperimentSchema = z.object({
  decision: z.enum(['SCALE', 'KILL', 'ITERATE', 'HOLD']),
  rationale: z.string().min(1),
  approvalRequestId: z.string().uuid().optional(),
});
export type DecideExperimentInput = z.infer<typeof decideExperimentSchema>;
