import { prisma } from '@ventureos/database';
import type { ModelUsage } from '@ventureos/database';
import { assertWithinBudget, chargeToBudget, resolveBudgetAllocation } from './budget-guard.js';

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

/**
 * Real for every agent/model invocation, including mock ones (master spec
 * section 41: "the recording mechanism must be real so it's correct the
 * moment real providers are enabled"). The mock provider's cost is always
 * 0, so this never blocks anything today, but it exercises the exact same
 * fail-closed budget-check path a real, non-zero-cost call would hit.
 */
export async function recordModelUsage(params: RecordModelUsageParams): Promise<ModelUsage> {
  const provider = params.provider ?? 'mock';
  const model = params.model ?? 'mock-v1';
  const promptTokens = params.promptTokens ?? 0;
  const completionTokens = params.completionTokens ?? 0;
  const costEur = params.costEur ?? 0;

  const allocation = await resolveBudgetAllocation(
    params.workspaceId,
    'AI_MODEL_USAGE',
    params.ventureProposalId,
  );

  if (costEur > 0 && allocation) {
    await assertWithinBudget(allocation.id, costEur);
  }

  const usage = await prisma.modelUsage.create({
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
    await chargeToBudget({
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
}
