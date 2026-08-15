import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  enforceWorkspaceCapability,
  OpportunityEvidenceUnavailableError,
  OpportunityScoringNotFoundError,
  prisma,
  Prisma,
  rescoreOpportunity,
  rescoreOpportunityInTransaction,
} from '@ventureos/database';
import { computeFreshnessScore, computeReliabilityScore } from '@ventureos/research-connectors';
import { hashContent } from '@ventureos/security';
import type { CreateOpportunityInput, RescoreOpportunityInput } from './opportunities.dto';
import { AuditService } from '../audit/audit.service';
import {
  enforceCapabilityAdmission,
  rethrowCapabilityPolicyDenial,
} from '../../common/policy/capability-admission';

const OPPORTUNITY_INCLUDE = {
  targetCustomers: true,
  channels: { orderBy: { priority: 'asc' as const } },
  scores: { orderBy: { calculatedAt: 'desc' as const } },
  evidenceClaims: { include: { evidenceArtifact: true } },
  proposal: true,
};

/**
 * Every mutation here is a founder-authority state change: create, rescore,
 * reject, archive and promote all write the append-only AuditEvent trail.
 */
@Injectable()
export class OpportunitiesService {
  constructor(private readonly auditService: AuditService) {}

  async list(workspaceId: string) {
    return prisma.opportunity.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: OPPORTUNITY_INCLUDE,
    });
  }

  async getById(workspaceId: string, id: string) {
    const opportunity = await prisma.opportunity.findFirst({
      where: { id, workspaceId },
      include: OPPORTUNITY_INCLUDE,
    });
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found');
    }
    return opportunity;
  }

  async create(workspaceId: string, input: CreateOpportunityInput, actorId: string) {
    const now = new Date();
    let created: {
      opportunityId: string;
      scoring: Awaited<ReturnType<typeof rescoreOpportunityInTransaction>>;
    };

    try {
      created = await prisma.$transaction(async (tx) => {
        const estimatedProfitEur =
          input.estimatedRevenueEur !== undefined && input.estimatedCostEur !== undefined
            ? input.estimatedRevenueEur - input.estimatedCostEur
            : undefined;

        const opportunity = await tx.opportunity.create({
          data: {
            workspaceId,
            title: input.title,
            description: input.description,
            suggestedProductType: input.suggestedProductType,
            suggestedMarketplace: input.suggestedMarketplace,
            estimatedCostEur: input.estimatedCostEur,
            estimatedRevenueEur: input.estimatedRevenueEur,
            estimatedProfitEur,
            timeToLaunchDays: input.timeToLaunchDays,
            risks: input.risks,
            targetCustomers: {
              create: {
                persona: input.targetCustomer.persona,
                painPoints: input.targetCustomer.painPoints,
                buyingTriggers: input.targetCustomer.buyingTriggers,
              },
            },
            channels: {
              create: input.channels.map((channel) => ({
                channel: channel.channel,
                rationale: channel.rationale,
                priority: channel.priority,
              })),
            },
          },
        });

        for (const evidence of input.evidence) {
          const retrievedAt = new Date(evidence.retrievedAt);
          const reliabilityScore = computeReliabilityScore({
            sourceType: evidence.sourceType,
            promptInjectionFlagged: false,
            disabled: false,
          });
          const freshnessScore = computeFreshnessScore({
            retrievedAt,
            freshnessRequirementHours: evidence.freshnessRequirementHours,
            now,
          });
          const contentHash = hashContent(
            [
              evidence.sourceName,
              evidence.sourceIdentifier ?? '',
              evidence.originalExcerpt ?? evidence.statement,
            ].join('\n'),
          );

          const artifact = await tx.evidenceArtifact.create({
            data: {
              workspaceId,
              sourceName: evidence.sourceName,
              sourceIdentifier: evidence.sourceIdentifier,
              retrievedAt,
              region: evidence.region,
              language: evidence.language,
              collectionMethod: evidence.collectionMethod,
              collectionAgent: 'founder-stage6-manual-intake',
              originalExcerpt: evidence.originalExcerpt,
              reliabilityScore,
              freshnessScore,
              relevanceScore: evidence.relevanceScore,
              termsOfUseNote: evidence.termsOfUseNote,
              personalDataClassification: evidence.personalDataClassification,
              contentHash,
              expiryDate: evidence.expiryDate ? new Date(evidence.expiryDate) : undefined,
              processingHistory: [
                {
                  step: 'stage6_manual_intake',
                  at: now.toISOString(),
                  sourceType: evidence.sourceType,
                  freshnessRequirementHours: evidence.freshnessRequirementHours,
                  reliabilityMethod: 'research-connectors-source-type-v1',
                  freshnessMethod: 'research-connectors-linear-decay-v1',
                },
              ],
            },
          });

          await tx.evidenceClaim.create({
            data: {
              workspaceId,
              evidenceArtifactId: artifact.id,
              opportunityId: opportunity.id,
              claimType: evidence.claimType,
              statement: evidence.statement,
              value: evidence.value as never,
            },
          });
        }

        const scoring = await rescoreOpportunityInTransaction(tx, {
          workspaceId,
          opportunityId: opportunity.id,
          opportunityFactors: input.opportunityFactors,
          profitConfidenceFactors: input.profitConfidenceFactors,
          now,
        });

        return { opportunityId: opportunity.id, scoring };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An opportunity with this title already exists');
      }
      throw error;
    }

    await this.auditService.record(workspaceId, {
      actorId,
      action: 'OPPORTUNITY_CREATED',
      entityType: 'Opportunity',
      entityId: created.opportunityId,
      after: {
        title: input.title,
        evidenceQuality: created.scoring.evidenceQuality.score,
        opportunityScore: created.scoring.opportunityScore.score,
        profitConfidence: created.scoring.profitConfidence.score,
      },
    });

    return this.getById(workspaceId, created.opportunityId);
  }

  async rescore(
    workspaceId: string,
    id: string,
    input: RescoreOpportunityInput,
    actorId: string,
  ) {
    try {
      const scoring = await rescoreOpportunity({
        workspaceId,
        opportunityId: id,
        opportunityFactors: input.opportunityFactors,
        profitConfidenceFactors: input.profitConfidenceFactors,
      });
      await this.auditService.record(workspaceId, {
        actorId,
        action: 'OPPORTUNITY_RESCORED',
        entityType: 'Opportunity',
        entityId: id,
        after: {
          evidenceQuality: scoring.evidenceQuality.score,
          opportunityScore: scoring.opportunityScore.score,
          profitConfidence: scoring.profitConfidence.score,
        },
      });
      return this.getById(workspaceId, id);
    } catch (error) {
      if (error instanceof OpportunityScoringNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof OpportunityEvidenceUnavailableError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async loadForMutation(workspaceId: string, id: string) {
    const opportunity = await prisma.opportunity.findFirst({ where: { id, workspaceId } });
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found');
    }
    return opportunity;
  }

  async reject(workspaceId: string, id: string, reason: string, actorId: string) {
    const before = await this.loadForMutation(workspaceId, id);
    const after = await prisma.opportunity.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason, rejectedAt: new Date() },
    });
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'OPPORTUNITY_REJECTED',
      entityType: 'Opportunity',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  async archive(workspaceId: string, id: string, actorId: string) {
    const before = await this.loadForMutation(workspaceId, id);
    const after = await prisma.opportunity.update({
      where: { id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await this.auditService.record(workspaceId, {
      actorId,
      action: 'OPPORTUNITY_ARCHIVED',
      entityType: 'Opportunity',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  async promote(workspaceId: string, id: string, actorId: string) {
    await enforceCapabilityAdmission(workspaceId, 'VENTURE_CREATE', 'internal');
    const before = await this.loadForMutation(workspaceId, id);
    if (before.status === 'PROMOTED') {
      throw new ForbiddenException('Opportunity is already promoted');
    }

    const { after, proposal } = await prisma.$transaction(async (tx) => {
      // Serialize quota checks for a workspace on the subscription row so two
      // concurrent promotions cannot both observe the same remaining slot.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "subscriptions" WHERE "workspaceId" = ${workspaceId}::uuid FOR UPDATE`,
      );
      try {
        await enforceWorkspaceCapability(
          {
            workspaceId,
            capability: 'VENTURE_CREATE',
            stage: 'DISPATCH',
            providerMode: 'internal',
            recordAllow: true,
            correlationReference: `opportunity-promote:${id}`,
          },
          tx,
          prisma,
        );
      } catch (error) {
        rethrowCapabilityPolicyDenial(error);
        throw error;
      }

      const updated = await tx.opportunity.update({
        where: { id },
        data: { status: 'PROMOTED', promotedAt: new Date() },
      });

      const existingProposal = await tx.ventureProposal.findUnique({
        where: { opportunityId: id },
      });
      const proposalRecord =
        existingProposal ??
        (await tx.ventureProposal.create({
          data: { workspaceId, opportunityId: id, status: 'DRAFT' },
        }));

      const versionCount = await tx.ventureProposalVersion.count({
        where: { ventureProposalId: proposalRecord.id },
      });
      // snapshot must be plain JSON -- Prisma's Json columns reject class
      // instances (e.g. Decimal) even though they stringify fine on their own.
      const snapshot = JSON.parse(JSON.stringify(updated));
      await tx.ventureProposalVersion.create({
        data: {
          ventureProposalId: proposalRecord.id,
          opportunityId: id,
          versionNumber: versionCount + 1,
          snapshot,
        },
      });

      return { after: updated, proposal: proposalRecord };
    });

    await this.auditService.record(workspaceId, {
      actorId,
      action: 'OPPORTUNITY_PROMOTED',
      entityType: 'Opportunity',
      entityId: id,
      before,
      after,
    });

    return { opportunity: after, proposal };
  }
}
