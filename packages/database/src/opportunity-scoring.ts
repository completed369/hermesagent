import { Prisma } from '@prisma/client';
import {
  calculateOpportunityScore,
  calculateProfitConfidenceScore,
  type OpportunityFactors,
  type ProfitConfidenceFactors,
} from '@ventureos/scoring-engine';
import {
  calculateOpportunityEvidenceQuality,
  OPPORTUNITY_EVIDENCE_QUALITY_WEIGHTS,
} from '@ventureos/policy-engine';
import { prisma } from './client.js';

export type ProfitConfidenceProvidedFactors = Omit<
  ProfitConfidenceFactors,
  'evidenceQuality' | 'dataFreshness'
>;

export interface RescoreOpportunityParams {
  workspaceId: string;
  opportunityId: string;
  opportunityFactors: OpportunityFactors;
  profitConfidenceFactors: ProfitConfidenceProvidedFactors;
  now?: Date;
}

export class OpportunityScoringNotFoundError extends Error {
  override readonly name = 'OpportunityScoringNotFoundError';
}

export class OpportunityEvidenceUnavailableError extends Error {
  override readonly name = 'OpportunityEvidenceUnavailableError';
}

/**
 * Transaction-scoped implementation used by both standalone rescoring and
 * fresh-opportunity creation. Client callers provide normalized
 * Opportunity/Profit factor inputs, but evidenceQuality and dataFreshness are
 * always derived from linked EvidenceArtifact rows and cannot be overridden.
 */
export async function rescoreOpportunityInTransaction(
  tx: Prisma.TransactionClient,
  params: RescoreOpportunityParams,
) {
  const calculatedAt = params.now ?? new Date();

  // Serialize score-history/denormalized-score updates for this opportunity.
  // EvidenceArtifact rows are append-only through the current product/API
  // surface, so reading them after this lock produces a stable input set for
  // the transaction's authoritative score write.
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "opportunities" WHERE "id" = ${params.opportunityId}::uuid AND "workspaceId" = ${params.workspaceId}::uuid FOR UPDATE`,
  );

  const opportunity = await tx.opportunity.findFirst({
    where: { id: params.opportunityId, workspaceId: params.workspaceId },
    select: { id: true },
  });
  if (!opportunity) {
    throw new OpportunityScoringNotFoundError('Opportunity not found');
  }

  const artifacts = await tx.evidenceArtifact.findMany({
    where: {
      workspaceId: params.workspaceId,
      claims: { some: { opportunityId: params.opportunityId } },
    },
    select: {
      id: true,
      reliabilityScore: true,
      freshnessScore: true,
      relevanceScore: true,
      expiryDate: true,
    },
    orderBy: { id: 'asc' },
  });

  const evidenceQuality = calculateOpportunityEvidenceQuality(artifacts, calculatedAt);
  if (evidenceQuality.score === null || evidenceQuality.dataFreshnessScore === null) {
    throw new OpportunityEvidenceUnavailableError(
      'At least one linked evidence artifact is required before scoring',
    );
  }

  const opportunityScore = calculateOpportunityScore(params.opportunityFactors, calculatedAt);
  const effectiveProfitFactors: ProfitConfidenceFactors = {
    ...params.profitConfidenceFactors,
    evidenceQuality: evidenceQuality.score,
    dataFreshness: evidenceQuality.dataFreshnessScore,
  };
  const profitConfidence = calculateProfitConfidenceScore(
    effectiveProfitFactors,
    opportunityScore.score,
    calculatedAt,
  );
  const evidenceFactorRecord = JSON.parse(
    JSON.stringify({
      weights: OPPORTUNITY_EVIDENCE_QUALITY_WEIGHTS,
      artifactCount: evidenceQuality.artifactCount,
      artifactScores: evidenceQuality.artifactScores,
      dataFreshnessScore: evidenceQuality.dataFreshnessScore,
    }),
  ) as Prisma.InputJsonValue;

  await tx.opportunityScore.create({
    data: {
      opportunityId: params.opportunityId,
      scoreType: 'EVIDENCE_QUALITY',
      formulaVersion: evidenceQuality.formulaVersion,
      score: evidenceQuality.score,
      factors: evidenceFactorRecord,
      calculatedAt,
    },
  });

  await tx.opportunityScore.create({
    data: {
      opportunityId: params.opportunityId,
      scoreType: 'OPPORTUNITY',
      formulaVersion: opportunityScore.formulaVersion,
      score: opportunityScore.score,
      factors: params.opportunityFactors,
      factorContributions: opportunityScore.factorContributions,
      calculatedAt,
    },
  });

  await tx.opportunityScore.create({
    data: {
      opportunityId: params.opportunityId,
      scoreType: 'PROFIT_CONFIDENCE',
      formulaVersion: profitConfidence.formulaVersion,
      score: profitConfidence.score,
      factors: effectiveProfitFactors,
      isSpeculative: profitConfidence.isSpeculative,
      calculatedAt,
    },
  });

  await tx.opportunity.update({
    where: { id: params.opportunityId },
    data: {
      latestOpportunityScore: opportunityScore.score,
      latestProfitConfidence: profitConfidence.score,
      isSpeculative: profitConfidence.isSpeculative,
    },
  });

  return {
    evidenceQuality,
    opportunityScore,
    profitConfidence,
    effectiveProfitFactors,
  };
}

/** Recompute and persist current scores as one standalone transaction. */
export async function rescoreOpportunity(params: RescoreOpportunityParams) {
  return prisma.$transaction((tx) => rescoreOpportunityInTransaction(tx, params));
}
