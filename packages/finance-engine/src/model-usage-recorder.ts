import { prisma } from '@ventureos/database';
import type { ModelUsage } from '@ventureos/database';
import { chargeToBudgetInTransaction, resolveBudgetAllocation } from './budget-guard.js';
import { enforceFinanceMutation } from './capability-guard.js';
import { BudgetNotFoundError } from './errors.js';

export interface RecordModelUsageParams {
  workspaceId: string;
  agentDefinitionId?: string;
  ventureProposalId?: string;
  boardReviewId?: string;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costEur?: number;
}

/** Records model usage and any associated budget charge in one transaction. */
export async function recordModelUsage(params: RecordModelUsageParams): Promise<ModelUsage> {
  const provider = params.provider ?? 'mock';
  const model = params.model ?? 'mock-v1';
  const promptTokens = params.promptTokens ?? 0;
  const completionTokens = params.completionTokens ?? 0;
  const costEur = params.costEur ?? 0;

  if (!Number.isFinite(costEur) || costEur < 0) {
    throw new BudgetNotFoundError('Model usage cost must be a non-negative finite amount');
  }

  const allocation = await resolveBudgetAllocation(
    params.workspaceId,
    'AI_MODEL_USAGE',
    params.ventureProposalId,
  );

  return prisma.$transaction(async (tx) => {
    if (params.ventureProposalId) {
      const proposal = await tx.ventureProposal.findFirst({
        where: { id: params.ventureProposalId, workspaceId: params.workspaceId },
        select: { id: true },
      });
      if (!proposal) throw new BudgetNotFoundError('Venture proposal not found');
    }
    if (params.boardReviewId) {
      const boardReview = await tx.boardReview.findFirst({
        where: { id: params.boardReviewId, workspaceId: params.workspaceId },
        select: { id: true },
      });
      if (!boardReview) throw new BudgetNotFoundError('Board review not found');
    }

    if (costEur === 0) {
      await enforceFinanceMutation(
        params.workspaceId,
        `finance:model-usage:${params.boardReviewId ?? params.ventureProposalId ?? 'workspace'}`,
        tx,
      );
    }

    const usage = await tx.modelUsage.create({
      data: {
        workspaceId: params.workspaceId,
        agentDefinitionId: params.agentDefinitionId,
        ventureProposalId: params.ventureProposalId,
        boardReviewId: params.boardReviewId,
        provider,
        model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costEur,
      },
    });

    if (costEur > 0) {
      await chargeToBudgetInTransaction(tx, {
        workspaceId: params.workspaceId,
        budgetAllocationId: allocation?.id,
        ventureProposalId: params.ventureProposalId,
        category: 'AI_MODEL_USAGE',
        amountEur: costEur,
        source: 'agent-runtime:model-usage',
        referenceType: 'ModelUsage',
        referenceId: usage.id,
        description: `${provider}/${model} invocation`,
      });
    }

    return usage;
  });
}
