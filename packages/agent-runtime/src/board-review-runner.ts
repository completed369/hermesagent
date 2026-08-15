import {
  dispatchWithWorkspaceCapability,
  enforceWorkspaceCapability,
  isCapabilityPolicyDeniedError,
  prisma,
} from '@ventureos/database';
import { calculateBoardVotingResult, DEFAULT_AGENT_WEIGHTS } from '@ventureos/policy-engine';
import { BOARD_AGENT_ROLES, type AgentOutput } from '@ventureos/contracts';
import { recordModelUsage } from '@ventureos/finance-engine';
import { runAllMockBoardAgents, type BoardAgentInput } from './mock-provider.js';
import { synthesiseDecision } from './decision-synthesiser.js';
import { captureBoardReviewMemory } from './memory-capture.js';
import type { MemoryStore } from './memory.js';

export class BoardReviewNotFoundError extends Error {}
export class BoardReviewInvalidOutputError extends Error {}

export interface RunBoardReviewParams {
  workspaceId: string;
  ventureProposalId: string;
  memoryStore?: MemoryStore;
}

export interface RunBoardReviewResult {
  boardReviewId: string;
  status: 'COMPLETED' | 'FAILED';
  votingResult: ReturnType<typeof calculateBoardVotingResult> | null;
  decisionSummaryId: string | null;
}

/**
 * Runs all 8 voting board agents (mock provider) against the CURRENT latest
 * VentureProposalVersion, persists one BoardVote per role, computes the
 * deterministic vote result via @ventureos/policy-engine (already
 * unit-tested), persists any active critical vetoes, generates the Decision
 * Synthesiser's summary, and marks the BoardReview COMPLETED.
 *
 * Plain function (not a NestJS service) so it can be called identically from
 * apps/api (BoardService) and apps/worker (a Temporal activity) -- same
 * pattern as AuditService/scoring-engine: one source of truth for the logic,
 * imported directly rather than duplicated.
 */
export async function runBoardReview(params: RunBoardReviewParams): Promise<RunBoardReviewResult> {
  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'AI_MODEL_EXECUTION',
    stage: 'DISPATCH',
  });

  const proposal = await prisma.ventureProposal.findFirst({
    where: { id: params.ventureProposalId, workspaceId: params.workspaceId },
    include: {
      opportunity: true,
      versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 },
    },
  });
  if (!proposal) {
    throw new BoardReviewNotFoundError('Venture proposal not found');
  }
  const latestVersion = proposal.versions[0];
  if (!latestVersion) {
    throw new BoardReviewNotFoundError('Venture proposal has no versions to review');
  }

  const boardReview = await prisma.boardReview.create({
    data: {
      workspaceId: params.workspaceId,
      ventureProposalId: proposal.id,
      ventureProposalVersionId: latestVersion.id,
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  try {
    const opportunity = proposal.opportunity;
    const [evidenceClaims, latestEvidenceQuality] = await Promise.all([
      prisma.evidenceClaim.findMany({
        where: { opportunityId: opportunity.id },
        select: { id: true },
      }),
      prisma.opportunityScore.findFirst({
        where: { opportunityId: opportunity.id, scoreType: 'EVIDENCE_QUALITY' },
        orderBy: { calculatedAt: 'desc' },
        select: { score: true, formulaVersion: true },
      }),
    ]);
    const evidenceClaimIds = evidenceClaims.map((claim) => claim.id);

    const agentInput: BoardAgentInput = {
      proposalVersionId: latestVersion.id,
      opportunityTitle: opportunity.title,
      opportunityScore: Number(opportunity.latestOpportunityScore ?? 0),
      profitConfidenceScore: Number(opportunity.latestProfitConfidence ?? 0),
      isSpeculative: opportunity.isSpeculative,
      estimatedCostEur: Number(opportunity.estimatedCostEur ?? 0),
      estimatedRevenueEur: Number(opportunity.estimatedRevenueEur ?? 0),
      estimatedProfitEur: Number(opportunity.estimatedProfitEur ?? 0),
      risks: opportunity.risks,
      evidenceClaimIds,
    };

    const outputs: AgentOutput[] = await dispatchWithWorkspaceCapability(
      {
        workspaceId: params.workspaceId,
        capability: 'AI_MODEL_EXECUTION',
        stage: 'DISPATCH',
      },
      () => runAllMockBoardAgents(agentInput),
    );

    const agentDefinitions = await prisma.agentDefinition.findMany({
      where: { role: { in: [...BOARD_AGENT_ROLES] } },
    });
    const definitionByRole = new Map(agentDefinitions.map((d) => [d.role, d]));

    for (const output of outputs) {
      const definition = definitionByRole.get(output.agentRole);
      if (!definition) {
        // Fail closed: never persist a vote we cannot attribute to a real,
        // seeded AgentDefinition row.
        throw new BoardReviewInvalidOutputError(
          `No AgentDefinition seeded for role ${output.agentRole}`,
        );
      }
      await prisma.boardVote.create({
        data: {
          boardReviewId: boardReview.id,
          agentDefinitionId: definition.id,
          agentRole: output.agentRole,
          agentVersion: output.agentVersion,
          decision: output.decision,
          confidence: output.confidence,
          output: output as never,
          isValid: true,
        },
      });

      // Phase 7 deliverable #2: real for every agent run, including mock ones
      // -- costEur is 0 for the mock provider, but the recording mechanism is
      // real so it is correct the moment a real provider is enabled.
      await recordModelUsage({
        workspaceId: params.workspaceId,
        agentDefinitionId: definition.id,
        ventureProposalId: proposal.id,
        boardReviewId: boardReview.id,
        provider: definition.modelProvider,
        model: definition.modelName,
        costEur: 0,
      });
    }

    // Stage-6-created opportunities always persist an EVIDENCE_QUALITY score
    // before promotion. Legacy seed/demo opportunities predate that history;
    // keeping the option absent for those rows preserves their mechanical
    // regression purpose without treating them as commercially validated.
    const votingResult = calculateBoardVotingResult(outputs, {
      weights: DEFAULT_AGENT_WEIGHTS,
      ...(latestEvidenceQuality
        ? { evidenceQualityScore: Number(latestEvidenceQuality.score) }
        : {}),
    });

    for (const veto of votingResult.activeCriticalVetoes) {
      const vote = await prisma.boardVote.findFirst({
        where: { boardReviewId: boardReview.id, agentRole: veto.agentRole },
      });
      if (vote) {
        await prisma.boardVeto.create({
          data: {
            boardReviewId: boardReview.id,
            boardVoteId: vote.id,
            agentRole: veto.agentRole,
            type: veto.type,
            reason: veto.reason,
          },
        });
      }
    }

    const summaryDraft = synthesiseDecision(outputs, votingResult);
    const decisionSummary = await prisma.decisionSummary.create({
      data: {
        boardReviewId: boardReview.id,
        agreementSummary: summaryDraft.agreementSummary,
        disagreementSummary: summaryDraft.disagreementSummary,
        vetoSummary: summaryDraft.vetoSummary,
        overallConfidence: summaryDraft.overallConfidence,
        recommendation: summaryDraft.recommendation,
        generatedAt: new Date(summaryDraft.generatedAt),
      },
    });

    const completedBoardReview = await prisma.boardReview.update({
      where: { id: boardReview.id },
      data: {
        status: 'COMPLETED',
        votingResult: votingResult as never,
        blocked: votingResult.blocked,
        meetsThreshold: votingResult.meetsThreshold,
        completedAt: new Date(),
      },
    });

    await captureBoardReviewMemory({
      boardReview: completedBoardReview,
      decisionSummary,
      ...(params.memoryStore ? { store: params.memoryStore } : {}),
    });

    return {
      boardReviewId: boardReview.id,
      status: 'COMPLETED',
      votingResult,
      decisionSummaryId: decisionSummary.id,
    };
  } catch (err) {
    if (isCapabilityPolicyDeniedError(err)) {
      await prisma.boardReview.update({
        where: { id: boardReview.id },
        data: {
          status: 'FAILED',
          failureReason: 'CAPABILITY_POLICY_DENIED',
          completedAt: new Date(),
        },
      });
      throw err;
    }
    await prisma.boardReview.update({
      where: { id: boardReview.id },
      data: {
        status: 'FAILED',
        failureReason: err instanceof Error ? err.message : 'Unknown error',
        completedAt: new Date(),
      },
    });
    return {
      boardReviewId: boardReview.id,
      status: 'FAILED',
      votingResult: null,
      decisionSummaryId: null,
    };
  }
}
