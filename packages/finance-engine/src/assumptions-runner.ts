import { prisma } from '@ventureos/database';
import type { FinancialAssumption } from '@ventureos/database';
import { DEFAULT_FINANCIAL_ASSUMPTIONS, FinancialAssumptionsSchema } from './assumptions.js';
import type { FinancialAssumptions } from './assumptions.js';

export interface UpsertFinancialAssumptionParams {
  workspaceId: string;
  ventureProposalId: string;
  assumptions?: Partial<FinancialAssumptions>;
}

/**
 * Creates a new "current" FinancialAssumption row for a venture, superseding
 * (never mutating) whatever was previously current -- so every
 * FinancialForecast keeps pointing at the exact assumption set that produced
 * it, even after the founder edits an assumption later. Missing fields fall
 * back to `DEFAULT_FINANCIAL_ASSUMPTIONS` (the same development defaults
 * documented in docs/FINANCIAL_MODEL.md), validated through the same Zod
 * schema `finance-engine`'s pure functions already rely on.
 */
export async function upsertFinancialAssumption(
  params: UpsertFinancialAssumptionParams,
): Promise<FinancialAssumption> {
  const current = await getActiveFinancialAssumption(params.workspaceId, params.ventureProposalId);
  const merged = FinancialAssumptionsSchema.parse({
    ...DEFAULT_FINANCIAL_ASSUMPTIONS,
    ...(current
      ? {
          productPriceEur: Number(current.productPriceEur),
          marketplaceFeeRate: Number(current.marketplaceFeeRate),
          paymentProcessingFeeRate: Number(current.paymentProcessingFeeRate),
          listingFeeEur: Number(current.listingFeeEur),
          refundRate: Number(current.refundRate),
          discountRate: Number(current.discountRate),
          vatRate: Number(current.vatRate),
          aiGenerationCostEur: Number(current.aiGenerationCostEur),
          monthlyOverheadAllocationEur: Number(current.monthlyOverheadAllocationEur),
          forecastPeriodDays: current.forecastPeriodDays,
          targetContributionMarginRate: Number(current.targetContributionMarginRate),
          minimumProfitConfidence: Number(current.minimumProfitConfidence),
        }
      : {}),
    ...params.assumptions,
  });

  return prisma.$transaction(async (tx) => {
    await tx.financialAssumption.updateMany({
      where: { ventureProposalId: params.ventureProposalId, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    return tx.financialAssumption.create({
      data: {
        workspaceId: params.workspaceId,
        ventureProposalId: params.ventureProposalId,
        productPriceEur: merged.productPriceEur,
        marketplaceFeeRate: merged.marketplaceFeeRate,
        paymentProcessingFeeRate: merged.paymentProcessingFeeRate,
        listingFeeEur: merged.listingFeeEur,
        refundRate: merged.refundRate,
        discountRate: merged.discountRate,
        vatRate: merged.vatRate,
        aiGenerationCostEur: merged.aiGenerationCostEur,
        monthlyOverheadAllocationEur: merged.monthlyOverheadAllocationEur,
        forecastPeriodDays: merged.forecastPeriodDays,
        targetContributionMarginRate: merged.targetContributionMarginRate,
        minimumProfitConfidence: merged.minimumProfitConfidence,
      },
    });
  });
}

export async function getActiveFinancialAssumption(
  workspaceId: string,
  ventureProposalId: string,
): Promise<FinancialAssumption | null> {
  return prisma.financialAssumption.findFirst({
    where: { workspaceId, ventureProposalId, supersededAt: null },
    orderBy: { createdAt: 'desc' as const },
  });
}

/** Converts a persisted FinancialAssumption row (Prisma Decimal fields) back
 * into the plain-number shape `finance-engine`'s pure calculation functions
 * expect. */
export function toFinancialAssumptions(row: FinancialAssumption): FinancialAssumptions {
  return FinancialAssumptionsSchema.parse({
    productPriceEur: Number(row.productPriceEur),
    marketplaceFeeRate: Number(row.marketplaceFeeRate),
    paymentProcessingFeeRate: Number(row.paymentProcessingFeeRate),
    listingFeeEur: Number(row.listingFeeEur),
    refundRate: Number(row.refundRate),
    discountRate: Number(row.discountRate),
    vatRate: Number(row.vatRate),
    aiGenerationCostEur: Number(row.aiGenerationCostEur),
    monthlyOverheadAllocationEur: Number(row.monthlyOverheadAllocationEur),
    forecastPeriodDays: row.forecastPeriodDays,
    targetContributionMarginRate: Number(row.targetContributionMarginRate),
    minimumProfitConfidence: Number(row.minimumProfitConfidence),
  });
}
