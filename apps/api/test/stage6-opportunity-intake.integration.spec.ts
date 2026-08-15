import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { runBoardReview } from '@ventureos/agent-runtime';
import { prisma } from '@ventureos/database';
import { AuditService } from '../src/modules/audit/audit.service';
import { OpportunitiesService } from '../src/modules/opportunities/opportunities.service';
import { cleanupEntitledTestWorkspace, entitleTestWorkspace } from './helpers/entitled-workspace';

describe('Stage 6 fresh opportunity intake (integration)', () => {
  const service = new OpportunitiesService(new AuditService());
  let workspaceA: { id: string };
  let workspaceB: { id: string };
  let actor: { id: string };
  let opportunityId: string | null = null;

  beforeAll(async () => {
    workspaceA = await prisma.workspace.create({
      data: { name: `Stage6 Workspace A ${randomUUID()}`, slug: `stage6-a-${randomUUID()}` },
    });
    workspaceB = await prisma.workspace.create({
      data: { name: `Stage6 Workspace B ${randomUUID()}`, slug: `stage6-b-${randomUUID()}` },
    });
    await entitleTestWorkspace(workspaceA.id);
    actor = await prisma.user.create({
      data: {
        email: `stage6-opportunity-${randomUUID()}@ventureos.local`,
        displayName: 'Stage 6 Integration Actor',
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { workspaceId: workspaceA.id } });
    await prisma.opportunity.deleteMany({ where: { workspaceId: workspaceA.id } });
    await cleanupEntitledTestWorkspace(workspaceA.id);
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA.id, workspaceB.id] } } });
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  it('creates a non-seed opportunity with derived evidence quality and three score histories', async () => {
    const retrievedAt = new Date().toISOString();
    const created = await service.create(
      workspaceA.id,
      {
        title: `Fresh Stage 6 Opportunity ${randomUUID()}`,
        description:
          'A fresh non-seed opportunity created through the supported Stage 6 founder intake path.',
        suggestedProductType: 'Digital Guide',
        suggestedMarketplace: 'etsy',
        estimatedCostEur: 40,
        estimatedRevenueEur: 200,
        timeToLaunchDays: 10,
        risks: ['Needs real customer validation before commercial launch'],
        targetCustomer: {
          persona: 'Independent professionals who need a repeatable planning workflow',
          painPoints: ['Manual planning takes too long'],
          buyingTriggers: ['Starting a new project'],
        },
        channels: [
          {
            channel: 'Organic marketplace search',
            rationale: 'Low-cost validation channel before any paid advertising.',
            priority: 1,
          },
        ],
        evidence: [
          {
            sourceName: 'Official Stage 6 test source',
            sourceType: 'OFFICIAL_API',
            sourceIdentifier: 'stage6-test-source',
            retrievedAt,
            freshnessRequirementHours: 720,
            collectionMethod: 'MANUAL_IMPORT',
            originalExcerpt: 'A current, relevant and high-quality test evidence excerpt.',
            relevanceScore: 90,
            personalDataClassification: 'NONE',
            claimType: 'VERIFIED_FACT',
            statement: 'A verified test fact supports the fresh opportunity.',
          },
        ],
        opportunityFactors: {
          demand: 80,
          trendStrength: 80,
          competitionAttractiveness: 80,
          expectedMargin: 80,
          productDifferentiation: 80,
          productionFeasibility: 80,
          organicMarketingPotential: 80,
          marketplacePolicyRisk: 80,
          intellectualPropertyRisk: 80,
          evidenceConfidence: 80,
          timeToLaunch: 80,
        },
        profitConfidenceFactors: {
          sampleSize: 80,
          costCertainty: 80,
          marketplaceFeeCertainty: 80,
          comparableProductQuality: 80,
          forecastRangeWidth: 80,
          historicalModelAccuracy: 80,
          channelMaturity: 80,
          assumptionSensitivity: 80,
        },
      },
      actor.id,
    );
    opportunityId = created.id;

    expect(created.estimatedProfitEur?.toString()).toBe('160');
    expect(created.latestOpportunityScore?.toString()).toBe('80');
    expect(created.scores).toHaveLength(3);

    const evidenceScore = created.scores.find((score) => score.scoreType === 'EVIDENCE_QUALITY');
    expect(evidenceScore?.formulaVersion).toBe('opportunity-evidence-quality-v1');
    expect(Number(evidenceScore?.score)).toBeGreaterThanOrEqual(90);

    const artifact = created.evidenceClaims[0]?.evidenceArtifact;
    expect(artifact?.reliabilityScore).toBe(90);
    expect(artifact?.freshnessScore).toBe(100);

    await expect(service.getById(workspaceB.id, created.id)).rejects.toThrow(NotFoundException);

    const createdAudit = await prisma.auditEvent.findFirst({
      where: { workspaceId: workspaceA.id, entityId: created.id, action: 'OPPORTUNITY_CREATED' },
    });
    expect(createdAudit?.actorId).toBe(actor.id);
    expect(createdAudit?.integrityHash).toBeTruthy();
  });

  it('rescoring appends reproducible history and preserves server-derived evidence inputs', async () => {
    if (!opportunityId) throw new Error('Fresh opportunity was not created');

    const rescored = await service.rescore(
      workspaceA.id,
      opportunityId,
      {
        opportunityFactors: {
          demand: 70,
          trendStrength: 70,
          competitionAttractiveness: 70,
          expectedMargin: 70,
          productDifferentiation: 70,
          productionFeasibility: 70,
          organicMarketingPotential: 70,
          marketplacePolicyRisk: 70,
          intellectualPropertyRisk: 70,
          evidenceConfidence: 70,
          timeToLaunch: 70,
        },
        profitConfidenceFactors: {
          sampleSize: 70,
          costCertainty: 70,
          marketplaceFeeCertainty: 70,
          comparableProductQuality: 70,
          forecastRangeWidth: 70,
          historicalModelAccuracy: 70,
          channelMaturity: 70,
          assumptionSensitivity: 70,
        },
      },
      actor.id,
    );

    expect(rescored.latestOpportunityScore?.toString()).toBe('70');
    expect(rescored.scores.filter((score) => score.scoreType === 'EVIDENCE_QUALITY')).toHaveLength(
      2,
    );
    expect(rescored.scores.filter((score) => score.scoreType === 'OPPORTUNITY')).toHaveLength(2);
    expect(rescored.scores.filter((score) => score.scoreType === 'PROFIT_CONFIDENCE')).toHaveLength(
      2,
    );

    const latestProfit = rescored.scores.find((score) => score.scoreType === 'PROFIT_CONFIDENCE');
    const factors = latestProfit?.factors as Record<string, number> | undefined;
    expect(factors?.evidenceQuality).toBeGreaterThanOrEqual(90);
    expect(factors?.dataFreshness).toBe(100);

    const rescoreAudit = await prisma.auditEvent.findFirst({
      where: {
        workspaceId: workspaceA.id,
        entityId: opportunityId,
        action: 'OPPORTUNITY_RESCORED',
      },
    });
    expect(rescoreAudit?.integrityHash).toBeTruthy();
  });

  it('feeds persisted evidence quality into board voting and freezes scores after promotion', async () => {
    if (!opportunityId) throw new Error('Fresh opportunity was not created');

    const promoted = await service.promote(workspaceA.id, opportunityId, actor.id);
    const review = await runBoardReview({
      workspaceId: workspaceA.id,
      ventureProposalId: promoted.proposal.id,
    });

    expect(review.status).toBe('COMPLETED');
    expect(review.votingResult).not.toBeNull();
    expect(
      review.votingResult?.blockingReasons.some((reason) =>
        reason.startsWith('Evidence quality '),
      ),
    ).toBe(false);

    await expect(
      service.rescore(
        workspaceA.id,
        opportunityId,
        {
          opportunityFactors: {
            demand: 90,
            trendStrength: 90,
            competitionAttractiveness: 90,
            expectedMargin: 90,
            productDifferentiation: 90,
            productionFeasibility: 90,
            organicMarketingPotential: 90,
            marketplacePolicyRisk: 90,
            intellectualPropertyRisk: 90,
            evidenceConfidence: 90,
            timeToLaunch: 90,
          },
          profitConfidenceFactors: {
            sampleSize: 90,
            costCertainty: 90,
            marketplaceFeeCertainty: 90,
            comparableProductQuality: 90,
            forecastRangeWidth: 90,
            historicalModelAccuracy: 90,
            channelMaturity: 90,
            assumptionSensitivity: 90,
          },
        },
        actor.id,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
