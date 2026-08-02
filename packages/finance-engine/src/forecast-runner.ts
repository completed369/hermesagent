import { prisma } from '@ventureos/database';
import type { FinancialForecast, FinancialScenario } from '@ventureos/database';
import { calculateBreakEven, calculateScenarios } from './calculations.js';
import {
  getActiveFinancialAssumption,
  toFinancialAssumptions,
  upsertFinancialAssumption,
} from './assumptions-runner.js';
import { enforceFinanceMutation, enforceFinanceRead } from './capability-guard.js';

export interface GenerateForecastParams {
  workspaceId: string;
  ventureProposalId: string;
  baseUnitsSold: number;
  scenarioMultipliers?: { low: number; high: number };
}

export interface ForecastResult {
  forecast: FinancialForecast;
  scenarios: FinancialScenario[];
}

/**
 * Computes a real forecast via `finance-engine`'s pure `calculateBreakEven`/
 * `calculateScenarios` functions (never re-implemented here) and persists
 * the result as a new FinancialForecast + 3 FinancialScenario rows -- never
 * overwritten in place, so the founder can see how projections evolved. If
 * the venture has no FinancialAssumption yet, one is seeded from
 * `DEFAULT_FINANCIAL_ASSUMPTIONS` first so this never silently computes
 * against made-up numbers.
 */
export async function generateForecast(params: GenerateForecastParams): Promise<ForecastResult> {
  let assumption = await getActiveFinancialAssumption(params.workspaceId, params.ventureProposalId);
  if (!assumption) {
    assumption = await upsertFinancialAssumption({
      workspaceId: params.workspaceId,
      ventureProposalId: params.ventureProposalId,
    });
  }

  const financialAssumptions = toFinancialAssumptions(assumption);
  const breakEven = calculateBreakEven(financialAssumptions);
  const [low, base, high] = calculateScenarios(
    financialAssumptions,
    params.baseUnitsSold,
    params.scenarioMultipliers,
  );

  return prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:forecast:${params.ventureProposalId}`,
      tx,
    );
    const forecast = await tx.financialForecast.create({
      data: {
        workspaceId: params.workspaceId,
        ventureProposalId: params.ventureProposalId,
        financialAssumptionId: assumption!.id,
        baseUnitsSold: params.baseUnitsSold,
        breakEvenUnits: Number.isFinite(breakEven.breakEvenUnits) ? breakEven.breakEvenUnits : null,
        breakEvenRevenueEur: Number.isFinite(breakEven.breakEvenRevenueEur)
          ? breakEven.breakEvenRevenueEur
          : null,
        fixedCostsEur: breakEven.fixedCostsEur,
      },
    });

    const scenarios: FinancialScenario[] = [];
    for (const projection of [low, base, high]) {
      scenarios.push(
        await tx.financialScenario.create({
          data: {
            financialForecastId: forecast.id,
            scenario: projection.scenario,
            unitsSold: projection.unitsSold,
            grossRevenueEur: projection.grossRevenueEur,
            netRevenueEur: projection.netRevenueEur,
            totalVariableCostEur: projection.totalVariableCostEur,
            fixedCostsEur: projection.fixedCostsEur,
            grossProfitEur: projection.grossProfitEur,
            netProfitEur: projection.netProfitEur,
          },
        }),
      );
    }

    return { forecast, scenarios };
  });
}

export interface ForecastVsActualResult {
  forecastId: string;
  forecastNetRevenueEur: number;
  actualNetRevenueEur: number;
  actualUnitsSold: number;
  forecastErrorEur: number;
  forecastErrorRate: number | null; // null when forecastNetRevenueEur is 0
}

/**
 * Compares the most recent FinancialForecast's BASE scenario against real
 * (or founder-manually-entered) RevenueEntry rows recorded since that
 * forecast was generated -- master spec section 41's "forecast-vs-actual
 * comparison." Returns null if no forecast exists yet for this venture.
 */
export async function compareForecastToActual(
  workspaceId: string,
  ventureProposalId: string,
): Promise<ForecastVsActualResult | null> {
  await enforceFinanceRead(workspaceId, `finance:forecast-read:${ventureProposalId}`);
  const forecast = await prisma.financialForecast.findFirst({
    where: { workspaceId, ventureProposalId },
    orderBy: { createdAt: 'desc' as const },
    include: { scenarios: true },
  });
  if (!forecast) return null;

  const baseScenario = forecast.scenarios.find((s) => s.scenario === 'BASE');
  if (!baseScenario) return null;

  const actualEntries = await prisma.revenueEntry.findMany({
    where: { workspaceId, ventureProposalId, occurredAt: { gte: forecast.createdAt } },
  });
  const actualNetRevenueEur = actualEntries.reduce((sum, e) => sum + Number(e.netRevenueEur), 0);
  const actualUnitsSold = actualEntries.reduce((sum, e) => sum + e.unitsSold, 0);
  const forecastNetRevenueEur = Number(baseScenario.netRevenueEur);
  const forecastErrorEur = actualNetRevenueEur - forecastNetRevenueEur;

  return {
    forecastId: forecast.id,
    forecastNetRevenueEur,
    actualNetRevenueEur,
    actualUnitsSold,
    forecastErrorEur,
    forecastErrorRate:
      forecastNetRevenueEur !== 0 ? forecastErrorEur / forecastNetRevenueEur : null,
  };
}
