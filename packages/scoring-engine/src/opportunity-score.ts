import { z } from 'zod';

/**
 * Opportunity Score formula v1 (master spec section 17).
 * All ten factors are normalised 0-100 BEFORE weighting; risk-type factors
 * (competition, policy risk, IP risk) must already be inverted by the caller
 * so that higher = better for every factor here.
 */
export const OPPORTUNITY_SCORE_FORMULA_VERSION = 'opportunity-score-v1';

export const OpportunityFactorWeights = {
  demand: 15,
  trendStrength: 10,
  competitionAttractiveness: 10,
  expectedMargin: 15,
  productDifferentiation: 10,
  productionFeasibility: 10,
  organicMarketingPotential: 10,
  marketplacePolicyRisk: 5,
  intellectualPropertyRisk: 5,
  evidenceConfidence: 5,
  timeToLaunch: 5,
} as const;

export type OpportunityFactorKey = keyof typeof OpportunityFactorWeights;

const TOTAL_WEIGHT = Object.values(OpportunityFactorWeights).reduce((a, b) => a + b, 0);
if (TOTAL_WEIGHT !== 100) {
  throw new Error(`OpportunityFactorWeights must sum to 100, got ${TOTAL_WEIGHT}`);
}

export const OpportunityFactorsSchema = z.object({
  demand: z.number().min(0).max(100),
  trendStrength: z.number().min(0).max(100),
  competitionAttractiveness: z.number().min(0).max(100),
  expectedMargin: z.number().min(0).max(100),
  productDifferentiation: z.number().min(0).max(100),
  productionFeasibility: z.number().min(0).max(100),
  organicMarketingPotential: z.number().min(0).max(100),
  marketplacePolicyRisk: z.number().min(0).max(100),
  intellectualPropertyRisk: z.number().min(0).max(100),
  evidenceConfidence: z.number().min(0).max(100),
  timeToLaunch: z.number().min(0).max(100),
});
export type OpportunityFactors = z.infer<typeof OpportunityFactorsSchema>;

export interface OpportunityScoreResult {
  formulaVersion: string;
  score: number;
  factorContributions: Record<OpportunityFactorKey, number>;
  calculatedAt: string;
}

/**
 * Deterministic, reproducible weighted sum. Agents may propose raw factor
 * inputs, but the final numeric score MUST always be computed here — never
 * invented via free-text reasoning.
 */
export function calculateOpportunityScore(
  factors: OpportunityFactors,
  now: Date = new Date(),
): OpportunityScoreResult {
  const parsed = OpportunityFactorsSchema.parse(factors);
  const factorContributions = {} as Record<OpportunityFactorKey, number>;
  let score = 0;
  for (const key of Object.keys(OpportunityFactorWeights) as OpportunityFactorKey[]) {
    const weight = OpportunityFactorWeights[key];
    const contribution = (parsed[key] * weight) / 100;
    factorContributions[key] = Math.round(contribution * 100) / 100;
    score += contribution;
  }
  return {
    formulaVersion: OPPORTUNITY_SCORE_FORMULA_VERSION,
    score: Math.round(score * 100) / 100,
    factorContributions,
    calculatedAt: now.toISOString(),
  };
}
