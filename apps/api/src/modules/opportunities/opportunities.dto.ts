import { EvidenceClaimType } from '@ventureos/contracts';
import { z } from 'zod';

const scoreDimension = z.number().min(0).max(100);

export const opportunityFactorsSchema = z.object({
  demand: scoreDimension,
  trendStrength: scoreDimension,
  competitionAttractiveness: scoreDimension,
  expectedMargin: scoreDimension,
  productDifferentiation: scoreDimension,
  productionFeasibility: scoreDimension,
  organicMarketingPotential: scoreDimension,
  marketplacePolicyRisk: scoreDimension,
  intellectualPropertyRisk: scoreDimension,
  evidenceConfidence: scoreDimension,
  timeToLaunch: scoreDimension,
});

/** Evidence quality + data freshness are deliberately absent: the server
 * derives both from the linked EvidenceArtifact rows. */
export const profitConfidenceProvidedFactorsSchema = z.object({
  sampleSize: scoreDimension,
  costCertainty: scoreDimension,
  marketplaceFeeCertainty: scoreDimension,
  comparableProductQuality: scoreDimension,
  forecastRangeWidth: scoreDimension,
  historicalModelAccuracy: scoreDimension,
  channelMaturity: scoreDimension,
  assumptionSensitivity: scoreDimension,
});

const intakeEvidenceSchema = z.object({
  sourceName: z.string().trim().min(1).max(500),
  sourceType: z.enum([
    'OFFICIAL_API',
    'PUBLIC_EXPORT',
    'FOUNDER_PROVIDED',
    'PERMITTED_BROWSER_RESEARCH',
    'MANUAL_IMPORT',
  ]),
  sourceIdentifier: z.string().trim().min(1).max(1000).optional(),
  retrievedAt: z.string().datetime(),
  freshnessRequirementHours: z.number().int().positive().max(87_600),
  region: z.string().trim().min(1).max(200).optional(),
  language: z.string().trim().min(2).max(20).default('en'),
  collectionMethod: z.enum(['MANUAL_IMPORT', 'FOUNDER_PROVIDED']),
  originalExcerpt: z.string().trim().min(1).max(20_000).optional(),
  relevanceScore: scoreDimension,
  expiryDate: z.string().datetime().optional(),
  termsOfUseNote: z.string().trim().max(2000).optional(),
  personalDataClassification: z.enum(['NONE', 'PSEUDONYMOUS', 'PERSONAL']).default('NONE'),
  claimType: EvidenceClaimType,
  statement: z.string().trim().min(1).max(5000),
  value: z.unknown().optional(),
});

export const createOpportunitySchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(20).max(10_000),
    suggestedProductType: z.string().trim().min(1).max(200).optional(),
    suggestedMarketplace: z.string().trim().min(1).max(100).optional(),
    estimatedCostEur: z.number().nonnegative().max(10_000_000).optional(),
    estimatedRevenueEur: z.number().nonnegative().max(100_000_000).optional(),
    timeToLaunchDays: z.number().int().positive().max(3650).optional(),
    risks: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
    targetCustomer: z.object({
      persona: z.string().trim().min(3).max(2000),
      painPoints: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
      buyingTriggers: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
    }),
    channels: z
      .array(
        z.object({
          channel: z.string().trim().min(1).max(200),
          rationale: z.string().trim().min(1).max(2000),
          priority: z.number().int().min(0).max(100).default(0),
        }),
      )
      .max(20)
      .default([]),
    evidence: z.array(intakeEvidenceSchema).min(1).max(50),
    opportunityFactors: opportunityFactorsSchema,
    profitConfidenceFactors: profitConfidenceProvidedFactorsSchema,
  })
  .strict();

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

export const rejectOpportunitySchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type RejectOpportunityInput = z.infer<typeof rejectOpportunitySchema>;
