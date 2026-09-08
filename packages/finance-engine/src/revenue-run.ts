import { prisma, type RevenueRun } from '@ventureos/database';
import { enforceFinanceMutation } from './capability-guard.js';
import {
  RevenueRunConflictError,
  RevenueRunInvalidInputError,
  RevenueRunNotFoundError,
} from './errors.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const CURRENCY = /^[A-Z]{3}$/u;

export interface CreateRevenueRunPlanParams {
  workspaceId: string;
  opportunityId: string;
  ventureProposalId: string;
  approvalRequestId?: string;
  experimentId?: string;
  taskId?: string;
  runId?: string;
  currency: string;
  expectedRevenueMinorUnits: bigint;
  expectedCostMinorUnits: bigint;
  downsideMinorUnits: bigint;
  confidenceBps: number;
  timeToCashDays: number;
  forecastEvidenceHash: string;
  idempotencyKey: string;
  createdBy: string;
}

function requireBoundedText(value: string, field: string): void {
  if (value.length < 1 || value.length > 200 || value.trim() !== value) {
    throw new RevenueRunInvalidInputError(`${field} must be 1-200 trimmed characters`);
  }
}

function validateRevenueRunPlan(params: CreateRevenueRunPlanParams): void {
  for (const [field, value] of [
    ['workspaceId', params.workspaceId],
    ['opportunityId', params.opportunityId],
    ['ventureProposalId', params.ventureProposalId],
    ['idempotencyKey', params.idempotencyKey],
    ['createdBy', params.createdBy],
  ] as const) {
    requireBoundedText(value, field);
  }
  for (const [field, value] of [
    ['approvalRequestId', params.approvalRequestId],
    ['experimentId', params.experimentId],
    ['taskId', params.taskId],
    ['runId', params.runId],
  ] as const) {
    if (value !== undefined) requireBoundedText(value, field);
  }
  if (params.runId !== undefined && params.taskId === undefined) {
    throw new RevenueRunInvalidInputError('runId requires the exact taskId');
  }
  if (!CURRENCY.test(params.currency)) {
    throw new RevenueRunInvalidInputError('currency must be an ISO-style three-letter code');
  }
  for (const [field, value] of [
    ['expectedRevenueMinorUnits', params.expectedRevenueMinorUnits],
    ['expectedCostMinorUnits', params.expectedCostMinorUnits],
    ['downsideMinorUnits', params.downsideMinorUnits],
  ] as const) {
    if (typeof value !== 'bigint' || value < 0n) {
      throw new RevenueRunInvalidInputError(`${field} must be a non-negative bigint`);
    }
  }
  if (
    !Number.isInteger(params.confidenceBps) ||
    params.confidenceBps < 0 ||
    params.confidenceBps > 10_000
  ) {
    throw new RevenueRunInvalidInputError('confidenceBps must be an integer from 0 to 10000');
  }
  if (
    !Number.isInteger(params.timeToCashDays) ||
    params.timeToCashDays < 0 ||
    params.timeToCashDays > 36_500
  ) {
    throw new RevenueRunInvalidInputError('timeToCashDays must be an integer from 0 to 36500');
  }
  if (!SHA256.test(params.forecastEvidenceHash)) {
    throw new RevenueRunInvalidInputError(
      'forecastEvidenceHash must be a lowercase SHA-256 digest',
    );
  }
}

function isExactReplay(existing: RevenueRun, params: CreateRevenueRunPlanParams): boolean {
  return (
    existing.status === 'PLANNED' &&
    existing.workspaceId === params.workspaceId &&
    existing.opportunityId === params.opportunityId &&
    existing.ventureProposalId === params.ventureProposalId &&
    existing.approvalRequestId === (params.approvalRequestId ?? null) &&
    existing.experimentId === (params.experimentId ?? null) &&
    existing.taskId === (params.taskId ?? null) &&
    existing.runId === (params.runId ?? null) &&
    existing.currency === params.currency &&
    existing.expectedRevenueMinorUnits === params.expectedRevenueMinorUnits &&
    existing.expectedCostMinorUnits === params.expectedCostMinorUnits &&
    existing.downsideMinorUnits === params.downsideMinorUnits &&
    existing.confidenceBps === params.confidenceBps &&
    existing.timeToCashDays === params.timeToCashDays &&
    existing.forecastEvidenceHash === params.forecastEvidenceHash &&
    existing.createdBy === params.createdBy
  );
}

/**
 * Persists an immutable planning record only. This function cannot activate a
 * run, dispatch work, spend, publish, contact a customer, or recognize money.
 * Optional approval linkage is correlation evidence, never execution authority.
 */
export async function createRevenueRunPlan(
  params: CreateRevenueRunPlanParams,
): Promise<RevenueRun> {
  validateRevenueRunPlan(params);
  return prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:revenue-run:plan:${params.idempotencyKey}`,
      tx,
    );

    const existing = await tx.revenueRun.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: params.workspaceId,
          idempotencyKey: params.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (!isExactReplay(existing, params)) {
        throw new RevenueRunConflictError(
          'Revenue-run idempotency key was reused with different inputs',
        );
      }
      return existing;
    }

    const opportunity = await tx.opportunity.findFirst({
      where: { id: params.opportunityId, workspaceId: params.workspaceId },
      select: { id: true },
    });
    if (!opportunity) throw new RevenueRunNotFoundError('Opportunity not found');

    const proposal = await tx.ventureProposal.findFirst({
      where: {
        id: params.ventureProposalId,
        workspaceId: params.workspaceId,
        opportunityId: params.opportunityId,
      },
      select: { id: true },
    });
    if (!proposal) throw new RevenueRunNotFoundError('Venture proposal not found');

    if (params.approvalRequestId) {
      const approval = await tx.approvalRequest.findFirst({
        where: {
          id: params.approvalRequestId,
          workspaceId: params.workspaceId,
          ventureProposalId: params.ventureProposalId,
          state: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS'] },
          revokedAt: null,
          expiresAt: { gt: new Date() },
          decisions: {
            some: {
              decision: { in: ['APPROVE', 'APPROVE_WITH_CONDITIONS'] },
              expiresAt: { gt: new Date() },
            },
          },
        },
        select: { id: true },
      });
      if (!approval) {
        throw new RevenueRunNotFoundError('Current approving evidence not found');
      }
    }

    if (params.experimentId) {
      const experiment = await tx.experiment.findFirst({
        where: {
          id: params.experimentId,
          workspaceId: params.workspaceId,
          ventureProposalId: params.ventureProposalId,
        },
        select: { id: true },
      });
      if (!experiment) throw new RevenueRunNotFoundError('Experiment not found');
    }

    if (params.taskId) {
      const task = await tx.acpTask.findUnique({
        where: { workspaceId_id: { workspaceId: params.workspaceId, id: params.taskId } },
        select: { id: true },
      });
      if (!task) throw new RevenueRunNotFoundError('ACP task not found');
    }

    if (params.runId) {
      const run = await tx.acpRun.findFirst({
        where: {
          workspaceId: params.workspaceId,
          id: params.runId,
          taskId: params.taskId,
        },
        select: { id: true },
      });
      if (!run) throw new RevenueRunNotFoundError('ACP run not found for the exact task');
    }

    return tx.revenueRun.create({
      data: {
        workspaceId: params.workspaceId,
        opportunityId: params.opportunityId,
        ventureProposalId: params.ventureProposalId,
        approvalRequestId: params.approvalRequestId,
        experimentId: params.experimentId,
        taskId: params.taskId,
        runId: params.runId,
        status: 'PLANNED',
        currency: params.currency,
        expectedRevenueMinorUnits: params.expectedRevenueMinorUnits,
        expectedCostMinorUnits: params.expectedCostMinorUnits,
        downsideMinorUnits: params.downsideMinorUnits,
        confidenceBps: params.confidenceBps,
        timeToCashDays: params.timeToCashDays,
        forecastEvidenceHash: params.forecastEvidenceHash,
        idempotencyKey: params.idempotencyKey,
        createdBy: params.createdBy,
      },
    });
  });
}
