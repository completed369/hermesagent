import { z } from 'zod';

/**
 * Profit Confidence Score v1 - kept intentionally SEPARATE from the
 * Opportunity Score (master spec section 18). A high opportunity score with
 * low profit confidence must be labelled speculative by the UI layer.
 */
export const PROFIT_CONFIDENCE_FORMULA_VERSION = 'profit-confidence-v1';

export const ProfitConfidenceFactorWeights = {
  evidenceQuality: 15,
  sampleSize: 10,
  costCertainty: 15,
  marketplaceFeeCertainty: 10,
  comparableProductQuality: 10,
  forecastRangeWidth: 10,
  historicalModelAccuracy: 10,
  channelMaturity: 10,
  assumptionSensitivity: 5,
  dataFreshness: 5,
} as const;

export type ProfitConfidenceFactorKey = keyof typeof ProfitConfidenceFactorWeights;

const TOTAL = Object.values(ProfitConfidenceFactorWeights).reduce((a, b) => a + b, 0);
if (TOTAL !== 100) {
  throw new Error(`ProfitConfidenceFactorWeights must sum to 100, got ${TOTAL}`);
}

export const ProfitConfidenceFactorsSchema = z.object({
  evidenceQuality: z.number().min(0).max(100),
  sampleSize: z.number().min(0).max(100),
  costCertainty: z.number().min(0).max(100),
  marketplaceFeeCertainty: z.number().min(0).max(100),
  comparableProductQuality: z.number().min(0).max(100),
  forecastRangeWidth: z.number().min(0).max(100),
  historicalModelAccuracy: z.number().min(0).max(100),
  channelMaturity: z.number().min(0).max(100),
  assumptionSensitivity: z.number().min(0).max(100),
  dataFreshness: z.number().min(0).max(100),
});
export type ProfitConfidenceFactors = z.infer<typeof ProfitConfidenceFactorsSchema>;

export interface ProfitConfidenceResult {
  formulaVersion: string;
  score: number;
  isSpeculative: boolean;
  calculatedAt: string;
}

export function calculateProfitConfidenceScore(
  factors: ProfitConfidenceFactors,
  opportunityScore: number,
  now: Date = new Date(),
): ProfitConfidenceResult {
  const parsed = ProfitConfidenceFactorsSchema.parse(factors);
  let score = 0;
  for (const key of Object.keys(ProfitConfidenceFactorWeights) as ProfitConfidenceFactorKey[]) {
    score += (parsed[key] * ProfitConfidenceFactorWeights[key]) / 100;
  }
  score = Math.round(score * 100) / 100;
  // Speculative when opportunity looks strong but profit confidence is weak.
  const isSpeculative = opportunityScore >= 70 && score < 70;
  return {
    formulaVersion: PROFIT_CONFIDENCE_FORMULA_VERSION,
    score,
    isSpeculative,
    calculatedAt: now.toISOString(),
  };
}
