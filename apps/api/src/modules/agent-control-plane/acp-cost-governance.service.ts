import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  assertBudgetAllows,
  costBudgetPolicyHash,
  costLedgerChecksum,
  type OperationalEventCapability,
  type OperationalActorKind,
  type WorkspaceContext,
} from '@ventureos/agent-control-plane';
import { Prisma, prisma } from '@ventureos/database';
import type { AuditService } from '../audit/audit.service';
import { AUDIT_SERVICE } from '../audit/audit.tokens';

export class AcpCostGovernanceDeniedError extends Error {}

export interface RecordGovernedUsageInput {
  readonly usageId: string;
  readonly receiptId: string;
  readonly dispatchId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sequence: number;
  readonly currency: string;
  readonly costMinorUnits: bigint;
  readonly computeUnits: bigint;
  readonly taskPolicyVersion: string;
  readonly taskLimitMinorUnits: bigint;
  readonly recordedAt: Date;
}

export interface GovernedUsageTotals {
  readonly ledgerEntryId: string;
  readonly workspaceSpendMinorUnits: bigint;
  readonly workspaceLimitMinorUnits: bigint;
  readonly taskSpendMinorUnits: bigint;
  readonly taskLimitMinorUnits: bigint;
  readonly workspacePolicyId: string;
}

function policyHash(policy: {
  id: string;
  workspaceId: string;
  scope: string;
  taskId: string | null;
  currency: string;
  limitMinorUnits: bigint;
  periodStart: Date;
  periodEnd: Date;
  policyVersion: string;
}): string {
  if (policy.scope !== 'WORKSPACE' && policy.scope !== 'TASK')
    throw new AcpCostGovernanceDeniedError('Unsupported budget policy scope');
  return costBudgetPolicyHash({
    schemaVersion: 1,
    policyId: policy.id,
    workspaceId: policy.workspaceId,
    scope: policy.scope,
    taskId: policy.taskId,
    currency: policy.currency,
    limitMinorUnits: policy.limitMinorUnits,
    periodStart: policy.periodStart.toISOString(),
    periodEnd: policy.periodEnd.toISOString(),
    policyVersion: policy.policyVersion,
  });
}

/** Internal durable spend boundary. No controller or provider calls this service. */
@Injectable()
export class AcpCostGovernanceService {
  constructor(@Inject(AUDIT_SERVICE) private readonly auditService: AuditService) {}

  async recordUsage(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    actorKind: Exclude<OperationalActorKind, 'RUNTIME'>,
    tx: Prisma.TransactionClient,
    input: RecordGovernedUsageInput,
  ): Promise<GovernedUsageTotals> {
    capability.assertSource('CONTROL_PLANE');
    const derivedActorKind = capability.actorKindFor(context);
    if (
      derivedActorKind === 'RUNTIME' ||
      derivedActorKind !== actorKind ||
      capability.authorityLevelFor(context) < 3
    )
      throw new AcpCostGovernanceDeniedError('Cost ledger actor binding mismatch');
    const workspaceId = context.workspaceId;
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "acp_cost_budget_policies" WHERE "workspaceId" = ${workspaceId}::uuid AND "currency" = ${input.currency} AND "periodStart" <= ${input.recordedAt} AND "periodEnd" > ${input.recordedAt} ORDER BY CASE "scope" WHEN 'WORKSPACE' THEN 0 ELSE 1 END, "taskId" NULLS FIRST, "id" FOR UPDATE`,
    );
    const policies = await tx.acpCostBudgetPolicy.findMany({
      where: {
        workspaceId,
        currency: input.currency,
        periodStart: { lte: input.recordedAt },
        periodEnd: { gt: input.recordedAt },
        OR: [
          { scope: 'WORKSPACE', taskId: null },
          { scope: 'TASK', taskId: input.taskId },
        ],
      },
      orderBy: [{ scope: 'asc' }, { id: 'asc' }],
    });
    const workspacePolicies = policies.filter((policy) => policy.scope === 'WORKSPACE');
    const taskPolicies = policies.filter(
      (policy) => policy.scope === 'TASK' && policy.taskId === input.taskId,
    );
    if (workspacePolicies.length !== 1 || taskPolicies.length !== 1)
      throw new AcpCostGovernanceDeniedError(
        'Exactly one workspace and task budget policy required',
      );
    const workspacePolicy = workspacePolicies[0];
    const taskPolicy = taskPolicies[0];
    if (!workspacePolicy || !taskPolicy)
      throw new AcpCostGovernanceDeniedError('Budget policies unavailable');
    if (
      policyHash(workspacePolicy) !== workspacePolicy.policyHash ||
      policyHash(taskPolicy) !== taskPolicy.policyHash ||
      taskPolicy.policyVersion !== input.taskPolicyVersion ||
      taskPolicy.periodStart.getTime() !== workspacePolicy.periodStart.getTime() ||
      taskPolicy.periodEnd.getTime() !== workspacePolicy.periodEnd.getTime() ||
      taskPolicy.limitMinorUnits > input.taskLimitMinorUnits
    )
      throw new AcpCostGovernanceDeniedError('Budget policy binding mismatch');

    const [workspaceAggregate, taskAggregate] = await Promise.all([
      tx.acpCostLedgerEntry.aggregate({
        where: {
          workspaceId,
          currency: input.currency,
          recordedAt: { gte: workspacePolicy.periodStart, lt: workspacePolicy.periodEnd },
        },
        _sum: { costMinorUnits: true },
      }),
      tx.acpCostLedgerEntry.aggregate({
        where: {
          workspaceId,
          taskId: input.taskId,
          currency: input.currency,
          recordedAt: { gte: taskPolicy.periodStart, lt: taskPolicy.periodEnd },
        },
        _sum: { costMinorUnits: true },
      }),
    ]);
    const currentWorkspaceSpend = workspaceAggregate._sum.costMinorUnits ?? 0n;
    const currentTaskSpend = taskAggregate._sum.costMinorUnits ?? 0n;
    try {
      assertBudgetAllows(
        currentWorkspaceSpend,
        workspacePolicy.limitMinorUnits,
        currentTaskSpend,
        taskPolicy.limitMinorUnits,
        input.costMinorUnits,
      );
    } catch {
      throw new AcpCostGovernanceDeniedError('Usage exceeds governed budget');
    }
    const workspaceSpendMinorUnits = currentWorkspaceSpend + input.costMinorUnits;
    const taskSpendMinorUnits = currentTaskSpend + input.costMinorUnits;
    const ledgerEntryId = input.usageId;
    const checksum = costLedgerChecksum({
      schemaVersion: 1,
      workspaceId,
      usageId: input.usageId,
      receiptId: input.receiptId,
      dispatchId: input.dispatchId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      runtimeId: input.runtimeId,
      connectionId: input.connectionId,
      sequence: input.sequence,
      currency: input.currency,
      costMinorUnits: input.costMinorUnits,
      computeUnits: input.computeUnits,
      workspacePolicyId: workspacePolicy.id,
      workspacePolicyHash: workspacePolicy.policyHash,
      taskPolicyId: taskPolicy.id,
      taskPolicyHash: taskPolicy.policyHash,
      workspaceSpendMinorUnits,
      taskSpendMinorUnits,
      workspaceLimitMinorUnits: workspacePolicy.limitMinorUnits,
      taskLimitMinorUnits: taskPolicy.limitMinorUnits,
      periodStart: workspacePolicy.periodStart.toISOString(),
      periodEnd: workspacePolicy.periodEnd.toISOString(),
      recordedAt: input.recordedAt.toISOString(),
    });
    await tx.acpCostLedgerEntry.create({
      data: {
        id: ledgerEntryId,
        workspaceId,
        usageId: input.usageId,
        receiptId: input.receiptId,
        dispatchId: input.dispatchId,
        sessionId: input.sessionId,
        runId: input.runId,
        taskId: input.taskId,
        runtimeId: input.runtimeId,
        connectionId: input.connectionId,
        sequence: input.sequence,
        currency: input.currency,
        costMinorUnits: input.costMinorUnits,
        computeUnits: input.computeUnits,
        workspacePolicyId: workspacePolicy.id,
        workspacePolicyHash: workspacePolicy.policyHash,
        taskPolicyId: taskPolicy.id,
        taskPolicyHash: taskPolicy.policyHash,
        periodStart: workspacePolicy.periodStart,
        periodEnd: workspacePolicy.periodEnd,
        workspaceSpendMinorUnits,
        taskSpendMinorUnits,
        checksum,
        recordedAt: input.recordedAt,
      },
    });
    await this.auditService.recordOperationalEvent(
      capability,
      context,
      {
        id: randomUUID(),
        workspaceId,
        type: 'cost.ledger.recorded',
        source: 'CONTROL_PLANE',
        actorKind,
        actorId: context.principalId,
        subjectType: 'AcpCostLedgerEntry',
        subjectId: ledgerEntryId,
        occurredAt: input.recordedAt.toISOString(),
        idempotencyKey: `cost-ledger:${ledgerEntryId}`,
        correlationId: input.runId,
        facts: {
          taskId: input.taskId,
          runId: input.runId,
          usageId: input.usageId,
          receiptId: input.receiptId,
          currency: input.currency,
          costMinorUnits: Number(input.costMinorUnits),
          workspaceCostUsedMinorUnits: Number(workspaceSpendMinorUnits),
          workspaceCostLimitMinorUnits: Number(workspacePolicy.limitMinorUnits),
          taskCostUsedMinorUnits: Number(taskSpendMinorUnits),
          taskCostLimitMinorUnits: Number(taskPolicy.limitMinorUnits),
          workspacePolicyId: workspacePolicy.id,
        },
      },
      actorKind === 'HUMAN' ? context.principalId : undefined,
      tx,
    );
    return {
      ledgerEntryId,
      workspaceSpendMinorUnits,
      workspaceLimitMinorUnits: workspacePolicy.limitMinorUnits,
      taskSpendMinorUnits,
      taskLimitMinorUnits: taskPolicy.limitMinorUnits,
      workspacePolicyId: workspacePolicy.id,
    };
  }
}

/** Exportable read-only workspace ledger view; it cannot create policy or spend. */
@Injectable()
export class AcpCostLedgerQueryService {
  async listLedger(capability: OperationalEventCapability, context: WorkspaceContext, take = 50) {
    capability.assertSource('CONTROL_PLANE');
    const actorKind = capability.actorKindFor(context);
    if (actorKind === 'RUNTIME' || capability.authorityLevelFor(context) < 0)
      throw new AcpCostGovernanceDeniedError('Trusted observer authority is required');
    if (!Number.isInteger(take) || take < 1 || take > 100)
      throw new AcpCostGovernanceDeniedError('Ledger page size is invalid');
    const entries = await prisma.acpCostLedgerEntry.findMany({
      where: { workspaceId: context.workspaceId },
      include: { workspacePolicy: true, taskPolicy: true },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take,
    });
    for (const entry of entries) {
      const checksum = costLedgerChecksum({
        schemaVersion: 1,
        workspaceId: entry.workspaceId,
        usageId: entry.usageId,
        receiptId: entry.receiptId,
        dispatchId: entry.dispatchId,
        sessionId: entry.sessionId,
        runId: entry.runId,
        taskId: entry.taskId,
        runtimeId: entry.runtimeId,
        connectionId: entry.connectionId,
        sequence: entry.sequence,
        currency: entry.currency,
        costMinorUnits: entry.costMinorUnits,
        computeUnits: entry.computeUnits,
        workspacePolicyId: entry.workspacePolicyId,
        workspacePolicyHash: entry.workspacePolicyHash,
        taskPolicyId: entry.taskPolicyId,
        taskPolicyHash: entry.taskPolicyHash,
        workspaceSpendMinorUnits: entry.workspaceSpendMinorUnits,
        taskSpendMinorUnits: entry.taskSpendMinorUnits,
        workspaceLimitMinorUnits: entry.workspacePolicy.limitMinorUnits,
        taskLimitMinorUnits: entry.taskPolicy.limitMinorUnits,
        periodStart: entry.periodStart.toISOString(),
        periodEnd: entry.periodEnd.toISOString(),
        recordedAt: entry.recordedAt.toISOString(),
      });
      if (
        checksum !== entry.checksum ||
        policyHash(entry.workspacePolicy) !== entry.workspacePolicyHash ||
        policyHash(entry.taskPolicy) !== entry.taskPolicyHash
      )
        throw new AcpCostGovernanceDeniedError('Cost ledger integrity verification failed');
    }
    return entries;
  }
}
