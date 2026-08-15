export const OPPORTUNITY_EVIDENCE_QUALITY_FORMULA_VERSION =
  'opportunity-evidence-quality-v1';
export const OPPORTUNITY_EVIDENCE_QUALITY_MINIMUM = 70;

/**
 * Reliability carries the most weight because Gate 2 must be difficult to
 * satisfy with weak provenance. Relevance is next; freshness is deliberately
 * still represented here while remaining a separate Profit Confidence factor.
 */
export const OPPORTUNITY_EVIDENCE_QUALITY_WEIGHTS = {
  reliability: 50,
  relevance: 30,
  freshness: 20,
} as const;

export interface OpportunityEvidenceArtifactInput {
  id: string;
  reliabilityScore: number;
  freshnessScore: number;
  relevanceScore: number;
  expiryDate?: Date | string | null;
}

export interface OpportunityEvidenceArtifactScore {
  id: string;
  reliabilityScore: number;
  freshnessScore: number;
  relevanceScore: number;
  expired: boolean;
  qualityScore: number;
}

export interface OpportunityEvidenceQualityResult {
  formulaVersion: string;
  score: number | null;
  dataFreshnessScore: number | null;
  artifactCount: number;
  artifactScores: OpportunityEvidenceArtifactScore[];
  meetsMinimum: boolean;
  calculatedAt: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertDimension(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be a finite number between 0 and 100`);
  }
}

function expiryTimestamp(expiryDate: Date | string | null | undefined): number | null {
  if (expiryDate == null) return null;
  const date = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) throw new RangeError('expiryDate must be a valid date');
  return timestamp;
}

/**
 * Calculates one opportunity-level evidence-quality score from unique linked
 * artifacts. Claim count never changes an artifact's weight: repeated claims
 * from the same source cannot inflate the gate. Explicitly expired artifacts
 * remain in the denominator with a quality/freshness contribution of zero,
 * so stale evidence cannot disappear and make the aggregate look stronger.
 *
 * No linked artifacts returns `score: null`; callers must fail closed rather
 * than silently turning missing evidence into a passing numeric value.
 */
export function calculateOpportunityEvidenceQuality(
  artifacts: readonly OpportunityEvidenceArtifactInput[],
  now: Date = new Date(),
): OpportunityEvidenceQualityResult {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError('now must be a valid date');

  const unique = new Map<string, OpportunityEvidenceArtifactInput>();
  for (const artifact of artifacts) {
    if (!artifact.id.trim()) throw new RangeError('artifact id must be non-empty');
    assertDimension('reliabilityScore', artifact.reliabilityScore);
    assertDimension('freshnessScore', artifact.freshnessScore);
    assertDimension('relevanceScore', artifact.relevanceScore);
    if (!unique.has(artifact.id)) unique.set(artifact.id, artifact);
  }

  const artifactScores = [...unique.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((artifact): OpportunityEvidenceArtifactScore => {
      const expiresAt = expiryTimestamp(artifact.expiryDate);
      const expired = expiresAt !== null && expiresAt <= nowMs;
      const qualityScore = expired
        ? 0
        : round2(
            (artifact.reliabilityScore * OPPORTUNITY_EVIDENCE_QUALITY_WEIGHTS.reliability) /
              100 +
              (artifact.relevanceScore * OPPORTUNITY_EVIDENCE_QUALITY_WEIGHTS.relevance) /
                100 +
              (artifact.freshnessScore * OPPORTUNITY_EVIDENCE_QUALITY_WEIGHTS.freshness) /
                100,
          );
      return {
        id: artifact.id,
        reliabilityScore: artifact.reliabilityScore,
        freshnessScore: artifact.freshnessScore,
        relevanceScore: artifact.relevanceScore,
        expired,
        qualityScore,
      };
    });

  if (artifactScores.length === 0) {
    return {
      formulaVersion: OPPORTUNITY_EVIDENCE_QUALITY_FORMULA_VERSION,
      score: null,
      dataFreshnessScore: null,
      artifactCount: 0,
      artifactScores: [],
      meetsMinimum: false,
      calculatedAt: now.toISOString(),
    };
  }

  const score = round2(
    artifactScores.reduce((sum, artifact) => sum + artifact.qualityScore, 0) /
      artifactScores.length,
  );
  const dataFreshnessScore = round2(
    artifactScores.reduce(
      (sum, artifact) => sum + (artifact.expired ? 0 : artifact.freshnessScore),
      0,
    ) / artifactScores.length,
  );

  return {
    formulaVersion: OPPORTUNITY_EVIDENCE_QUALITY_FORMULA_VERSION,
    score,
    dataFreshnessScore,
    artifactCount: artifactScores.length,
    artifactScores,
    meetsMinimum: score >= OPPORTUNITY_EVIDENCE_QUALITY_MINIMUM,
    calculatedAt: now.toISOString(),
  };
}
