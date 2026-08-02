import { prisma, type Prisma } from '@ventureos/database';
import { ResearchCostCapExceededError } from './errors.js';

export interface ResearchCostCapConfig {
  perRunLimitEur: number;
  perWorkspaceDayLimitEur: number;
}

/** Phase 5 deliverable #4: real (mock-provider-cost-is-zero-by-default) spend
 * caps, so the enforcement path is correct the moment a real paid research
 * provider is ever enabled -- same principle as the AI_PER_*_COST_LIMIT_EUR
 * env vars already scaffolded for the agent runtime. */
export const DEFAULT_RESEARCH_COST_CAPS: ResearchCostCapConfig = {
  perRunLimitEur: 1,
  perWorkspaceDayLimitEur: 5,
};

/**
 * Throws ResearchCostCapExceededError (fail closed) if either the estimated
 * cost of this run alone, or today's already-succeeded spend plus this run,
 * would exceed the configured caps. DB-touching -- reads today's
 * DataAcquisitionRun rows for the workspace.
 */
export async function assertWithinResearchCostCaps(
  workspaceId: string,
  estimatedCostEur: number,
  config: ResearchCostCapConfig = DEFAULT_RESEARCH_COST_CAPS,
  client: Pick<Prisma.TransactionClient, 'dataAcquisitionRun'> = prisma,
): Promise<void> {
  if (estimatedCostEur > config.perRunLimitEur) {
    throw new ResearchCostCapExceededError(
      `Estimated run cost EUR ${estimatedCostEur.toFixed(4)} exceeds the per-run cap EUR ${config.perRunLimitEur}.`,
    );
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const todaysRuns = await client.dataAcquisitionRun.findMany({
    where: {
      workspaceId,
      createdAt: { gte: startOfDay },
      status: { in: ['RESERVED', 'SUCCEEDED'] },
    },
    select: { costEur: true },
  });
  const spentToday = todaysRuns.reduce((sum, run) => sum + Number(run.costEur), 0);

  if (spentToday + estimatedCostEur > config.perWorkspaceDayLimitEur) {
    throw new ResearchCostCapExceededError(
      `Today's research spend EUR ${spentToday.toFixed(4)} plus this run's EUR ${estimatedCostEur.toFixed(4)} would exceed the per-workspace-per-day cap EUR ${config.perWorkspaceDayLimitEur}.`,
    );
  }
}
