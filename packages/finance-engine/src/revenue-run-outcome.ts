import {
  Prisma,
  prisma,
  type AcpCostLedgerEntry,
  type AcpRunUsage,
  type Expense,
  type RevenueEntry,
} from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import { enforceFinanceMutation, enforceFinanceRead } from './capability-guard.js';
import {
  RevenueRunConflictError,
  RevenueRunInvalidInputError,
  RevenueRunNotFoundError,
  RevenueRunOutcomeEvidenceDriftError,
} from './errors.js';

export interface LinkRevenueRunFactParams {
  workspaceId: string;
  revenueRunId: string;
  factId: string;
  linkedBy: string;
}

export interface RecordRevenueRunCostReconciliationParams {
  workspaceId: string;
  revenueRunId: string;
  overlapMinorUnits: bigint;
  basisReference: string;
  idempotencyKey: string;
  reconciledBy: string;
}

export const REVENUE_RUN_COMMERCIAL_EVIDENCE_KINDS = [
  'PAYMENT_SETTLEMENT',
  'DELIVERY_CONFIRMATION',
  'REFUND_OBSERVATION',
] as const;
export type RevenueRunCommercialEvidenceKind =
  (typeof REVENUE_RUN_COMMERCIAL_EVIDENCE_KINDS)[number];

export const REVENUE_RUN_COMMERCIAL_EVIDENCE_SOURCE_TYPES = [
  'MARKETPLACE_EXPORT',
  'PAYMENT_PROCESSOR_EXPORT',
  'BANK_SETTLEMENT_EXPORT',
  'FULFILLMENT_EXPORT',
  'FOUNDER_OBSERVED',
] as const;
export type RevenueRunCommercialEvidenceSourceType =
  (typeof REVENUE_RUN_COMMERCIAL_EVIDENCE_SOURCE_TYPES)[number];

export interface RecordRevenueRunCommercialEvidenceParams {
  workspaceId: string;
  revenueRunId: string;
  revenueEntryId: string;
  kind: RevenueRunCommercialEvidenceKind;
  sourceType: RevenueRunCommercialEvidenceSourceType;
  sourceReferenceHash: string;
  sourceArtifactSha256: string;
  observedAt: Date;
  idempotencyKey: string;
  recordedBy: string;
}

type UsageWithLedger = AcpRunUsage & { costLedgerEntry: AcpCostLedgerEntry | null };

function requireBoundedText(value: string, field: string): void {
  if (value.length < 1 || value.length > 200 || value.trim() !== value) {
    throw new RevenueRunInvalidInputError(`${field} must be 1-200 trimmed characters`);
  }
}

function validateLinkParams(params: LinkRevenueRunFactParams): void {
  for (const [field, value] of [
    ['workspaceId', params.workspaceId],
    ['revenueRunId', params.revenueRunId],
    ['factId', params.factId],
    ['linkedBy', params.linkedBy],
  ] as const) {
    requireBoundedText(value, field);
  }
}

function validateCostReconciliationParams(params: RecordRevenueRunCostReconciliationParams): void {
  for (const [field, value] of [
    ['workspaceId', params.workspaceId],
    ['revenueRunId', params.revenueRunId],
    ['idempotencyKey', params.idempotencyKey],
    ['reconciledBy', params.reconciledBy],
  ] as const) {
    requireBoundedText(value, field);
  }
  if (
    params.basisReference.length < 1 ||
    params.basisReference.length > 500 ||
    params.basisReference.trim() !== params.basisReference
  ) {
    throw new RevenueRunInvalidInputError('basisReference must be 1-500 trimmed characters');
  }
  if (typeof params.overlapMinorUnits !== 'bigint' || params.overlapMinorUnits < 0n) {
    throw new RevenueRunInvalidInputError('overlapMinorUnits must be a non-negative bigint');
  }
}

function validateCommercialEvidenceParams(
  params: RecordRevenueRunCommercialEvidenceParams,
  capturedAt: Date,
): void {
  for (const [field, value] of [
    ['workspaceId', params.workspaceId],
    ['revenueRunId', params.revenueRunId],
    ['revenueEntryId', params.revenueEntryId],
    ['idempotencyKey', params.idempotencyKey],
    ['recordedBy', params.recordedBy],
  ] as const) {
    requireBoundedText(value, field);
  }
  if (!REVENUE_RUN_COMMERCIAL_EVIDENCE_KINDS.includes(params.kind)) {
    throw new RevenueRunInvalidInputError('Unsupported commercial evidence kind');
  }
  if (!REVENUE_RUN_COMMERCIAL_EVIDENCE_SOURCE_TYPES.includes(params.sourceType)) {
    throw new RevenueRunInvalidInputError('Unsupported commercial evidence source type');
  }
  if (!/^[0-9a-f]{64}$/u.test(params.sourceReferenceHash)) {
    throw new RevenueRunInvalidInputError('sourceReferenceHash must be a lowercase SHA-256 digest');
  }
  if (!/^[0-9a-f]{64}$/u.test(params.sourceArtifactSha256)) {
    throw new RevenueRunInvalidInputError(
      'sourceArtifactSha256 must be a lowercase SHA-256 digest',
    );
  }
  if (!Number.isFinite(params.observedAt.getTime()) || params.observedAt > capturedAt) {
    throw new RevenueRunInvalidInputError('observedAt must be a valid non-future timestamp');
  }
}

function commercialEvidenceHash(input: {
  workspaceId: string;
  revenueRunId: string;
  revenueEntryId: string;
  kind: string;
  sourceType: string;
  sourceReferenceHash: string;
  sourceArtifactSha256: string;
  observedAt: Date;
  verificationState: string;
  recordedBy: string;
}): string {
  return hashObject({
    kind: 'REVENUE_RUN_COMMERCIAL_EVIDENCE',
    workspaceId: input.workspaceId,
    revenueRunId: input.revenueRunId,
    revenueEntryId: input.revenueEntryId,
    evidenceKind: input.kind,
    sourceType: input.sourceType,
    sourceReferenceHash: input.sourceReferenceHash,
    sourceArtifactSha256: input.sourceArtifactSha256,
    observedAt: input.observedAt.toISOString(),
    verificationState: input.verificationState,
    recordedBy: input.recordedBy,
  });
}

function commercialEvidenceSetHash(
  evidence: ReadonlyArray<{ id: string; evidenceHash: string }>,
): string {
  return hashObject({
    kind: 'REVENUE_RUN_COMMERCIAL_EVIDENCE_SET',
    evidence: evidence
      .map((item) => ({ id: item.id, evidenceHash: item.evidenceHash }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function revenueEntryEvidenceHash(entry: RevenueEntry): string {
  return hashObject({
    kind: 'REVENUE_ENTRY',
    id: entry.id,
    workspaceId: entry.workspaceId,
    ventureProposalId: entry.ventureProposalId,
    listingVersionId: entry.listingVersionId,
    unitsSold: entry.unitsSold,
    grossRevenueEur: entry.grossRevenueEur.toString(),
    marketplaceFeeEur: entry.marketplaceFeeEur.toString(),
    paymentProcessingFeeEur: entry.paymentProcessingFeeEur.toString(),
    listingFeeEur: entry.listingFeeEur.toString(),
    vatEur: entry.vatEur.toString(),
    refundsEur: entry.refundsEur.toString(),
    netRevenueEur: entry.netRevenueEur.toString(),
    source: entry.source,
    occurredAt: entry.occurredAt.toISOString(),
    recordedBy: entry.recordedBy,
    createdAt: entry.createdAt.toISOString(),
  });
}

function expenseEvidenceHash(expense: Expense): string {
  return hashObject({
    kind: 'EXPENSE',
    id: expense.id,
    workspaceId: expense.workspaceId,
    ventureProposalId: expense.ventureProposalId,
    category: expense.category,
    amountEur: expense.amountEur.toString(),
    description: expense.description,
    source: expense.source,
    incurredAt: expense.incurredAt.toISOString(),
    createdAt: expense.createdAt.toISOString(),
  });
}

function usageEvidenceHash(usage: UsageWithLedger): string {
  const ledger = usage.costLedgerEntry;
  if (!ledger) {
    throw new RevenueRunNotFoundError('Recognized ACP cost-ledger evidence not found');
  }
  if (
    ledger.workspaceId !== usage.workspaceId ||
    ledger.usageId !== usage.id ||
    ledger.runId !== usage.runId ||
    ledger.currency !== usage.currency ||
    ledger.costMinorUnits !== usage.costMinorUnits ||
    ledger.computeUnits !== usage.computeUnits
  ) {
    throw new RevenueRunOutcomeEvidenceDriftError(
      'ACP usage and recognized cost-ledger evidence do not match',
    );
  }
  return hashObject({
    kind: 'ACP_RECOGNIZED_USAGE',
    usage: {
      id: usage.id,
      workspaceId: usage.workspaceId,
      dispatchId: usage.dispatchId,
      runId: usage.runId,
      sessionId: usage.sessionId,
      receiptId: usage.receiptId,
      sequence: usage.sequence,
      computeUnits: usage.computeUnits.toString(),
      costMinorUnits: usage.costMinorUnits.toString(),
      cumulativeComputeUnits: usage.cumulativeComputeUnits.toString(),
      cumulativeCostMinorUnits: usage.cumulativeCostMinorUnits.toString(),
      currency: usage.currency,
      evidenceHash: usage.evidenceHash,
      recordedAt: usage.recordedAt.toISOString(),
    },
    recognizedCostLedger: {
      id: ledger.id,
      checksum: ledger.checksum,
      costMinorUnits: ledger.costMinorUnits.toString(),
      computeUnits: ledger.computeUnits.toString(),
      recordedAt: ledger.recordedAt.toISOString(),
    },
  });
}

function exactLinkReplay(
  existing: { workspaceId: string; revenueRunId: string; evidenceHash: string; linkedBy: string },
  params: LinkRevenueRunFactParams,
  evidenceHash: string,
): boolean {
  return (
    existing.workspaceId === params.workspaceId &&
    existing.revenueRunId === params.revenueRunId &&
    existing.evidenceHash === evidenceHash &&
    existing.linkedBy === params.linkedBy
  );
}

export async function linkRevenueRunRevenueEntry(params: LinkRevenueRunFactParams) {
  validateLinkParams(params);
  return prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:revenue-run:revenue-entry:${params.factId}`,
      tx,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "revenue_entries" WHERE "id" = ${params.factId}::uuid FOR UPDATE`,
    );
    const run = await tx.revenueRun.findFirst({
      where: { id: params.revenueRunId, workspaceId: params.workspaceId },
      select: { id: true, workspaceId: true, ventureProposalId: true, currency: true },
    });
    if (!run) throw new RevenueRunNotFoundError('Revenue run not found');
    if (run.currency !== 'EUR') {
      throw new RevenueRunInvalidInputError(
        'EUR revenue evidence cannot be linked to this currency',
      );
    }
    const entry = await tx.revenueEntry.findFirst({
      where: {
        id: params.factId,
        workspaceId: params.workspaceId,
        ventureProposalId: run.ventureProposalId,
      },
    });
    if (!entry) throw new RevenueRunNotFoundError('Revenue entry not found for the exact venture');
    const evidenceHash = revenueEntryEvidenceHash(entry);
    const existing = await tx.revenueRunRevenueEntry.findUnique({
      where: { revenueEntryId: entry.id },
    });
    if (existing) {
      if (!exactLinkReplay(existing, params, evidenceHash)) {
        throw new RevenueRunConflictError(
          'Revenue entry already has different correlation evidence',
        );
      }
      return existing;
    }
    return tx.revenueRunRevenueEntry.create({
      data: {
        workspaceId: params.workspaceId,
        revenueRunId: params.revenueRunId,
        revenueEntryId: entry.id,
        evidenceHash,
        linkedBy: params.linkedBy,
      },
    });
  });
}

export async function linkRevenueRunExpense(params: LinkRevenueRunFactParams) {
  validateLinkParams(params);
  return prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:revenue-run:expense:${params.factId}`,
      tx,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "expenses" WHERE "id" = ${params.factId}::uuid FOR UPDATE`,
    );
    const run = await tx.revenueRun.findFirst({
      where: { id: params.revenueRunId, workspaceId: params.workspaceId },
      select: { id: true, workspaceId: true, ventureProposalId: true, currency: true },
    });
    if (!run) throw new RevenueRunNotFoundError('Revenue run not found');
    if (run.currency !== 'EUR') {
      throw new RevenueRunInvalidInputError(
        'EUR expense evidence cannot be linked to this currency',
      );
    }
    const expense = await tx.expense.findFirst({
      where: {
        id: params.factId,
        workspaceId: params.workspaceId,
        ventureProposalId: run.ventureProposalId,
      },
    });
    if (!expense) throw new RevenueRunNotFoundError('Expense not found for the exact venture');
    const evidenceHash = expenseEvidenceHash(expense);
    const existing = await tx.revenueRunExpense.findUnique({ where: { expenseId: expense.id } });
    if (existing) {
      if (!exactLinkReplay(existing, params, evidenceHash)) {
        throw new RevenueRunConflictError('Expense already has different correlation evidence');
      }
      return existing;
    }
    return tx.revenueRunExpense.create({
      data: {
        workspaceId: params.workspaceId,
        revenueRunId: params.revenueRunId,
        expenseId: expense.id,
        evidenceHash,
        linkedBy: params.linkedBy,
      },
    });
  });
}

export async function linkRevenueRunUsage(params: LinkRevenueRunFactParams) {
  validateLinkParams(params);
  return prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:revenue-run:usage:${params.factId}`,
      tx,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "acp_run_usages" WHERE "workspaceId" = ${params.workspaceId}::uuid AND "id" = ${params.factId} FOR UPDATE`,
    );
    const run = await tx.revenueRun.findFirst({
      where: { id: params.revenueRunId, workspaceId: params.workspaceId },
      select: { id: true, workspaceId: true, runId: true, currency: true },
    });
    if (!run) throw new RevenueRunNotFoundError('Revenue run not found');
    if (!run.runId) {
      throw new RevenueRunInvalidInputError('Revenue run has no exact ACP run binding');
    }
    const usage = await tx.acpRunUsage.findFirst({
      where: {
        id: params.factId,
        workspaceId: params.workspaceId,
        runId: run.runId,
        currency: run.currency,
      },
      include: { costLedgerEntry: true },
    });
    if (!usage)
      throw new RevenueRunNotFoundError('ACP usage not found for the exact run and currency');
    const evidenceHash = usageEvidenceHash(usage);
    const existing = await tx.revenueRunUsage.findUnique({
      where: { workspaceId_usageId: { workspaceId: params.workspaceId, usageId: usage.id } },
    });
    if (existing) {
      if (!exactLinkReplay(existing, params, evidenceHash)) {
        throw new RevenueRunConflictError('ACP usage already has different correlation evidence');
      }
      return existing;
    }
    return tx.revenueRunUsage.create({
      data: {
        workspaceId: params.workspaceId,
        revenueRunId: params.revenueRunId,
        usageId: usage.id,
        evidenceHash,
        linkedBy: params.linkedBy,
      },
    });
  });
}

/**
 * Retains a privacy-minimized external commercial evidence assertion for an
 * exact linked revenue fact. The state is deliberately fixed to unverified;
 * this function cannot authenticate a provider export or promote revenue
 * truth.
 */
export async function recordRevenueRunCommercialEvidence(
  params: RecordRevenueRunCommercialEvidenceParams,
) {
  const capturedAt = new Date();
  validateCommercialEvidenceParams(params, capturedAt);
  return prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:revenue-run:commercial-evidence:${params.idempotencyKey}`,
      tx,
    );
    const revenueLink = await tx.revenueRunRevenueEntry.findUnique({
      where: {
        workspaceId_revenueRunId_revenueEntryId: {
          workspaceId: params.workspaceId,
          revenueRunId: params.revenueRunId,
          revenueEntryId: params.revenueEntryId,
        },
      },
      select: { revenueEntryId: true },
    });
    if (!revenueLink) {
      throw new RevenueRunNotFoundError('Exact revenue-run revenue link not found');
    }

    const candidate = {
      workspaceId: params.workspaceId,
      revenueRunId: params.revenueRunId,
      revenueEntryId: params.revenueEntryId,
      kind: params.kind,
      sourceType: params.sourceType,
      sourceReferenceHash: params.sourceReferenceHash,
      sourceArtifactSha256: params.sourceArtifactSha256,
      observedAt: params.observedAt,
      verificationState: 'UNVERIFIED_EXTERNAL_ASSERTION' as const,
      idempotencyKey: params.idempotencyKey,
      recordedBy: params.recordedBy,
    };
    const evidenceHash = commercialEvidenceHash(candidate);
    const existing = await tx.revenueRunCommercialEvidence.findUnique({
      where: {
        revenueRunCommercialEvidenceIdempotency: {
          workspaceId: params.workspaceId,
          idempotencyKey: params.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.revenueRunId !== candidate.revenueRunId ||
        existing.revenueEntryId !== candidate.revenueEntryId ||
        existing.kind !== candidate.kind ||
        existing.sourceType !== candidate.sourceType ||
        existing.sourceReferenceHash !== candidate.sourceReferenceHash ||
        existing.sourceArtifactSha256 !== candidate.sourceArtifactSha256 ||
        existing.observedAt.getTime() !== candidate.observedAt.getTime() ||
        existing.verificationState !== candidate.verificationState ||
        existing.recordedBy !== candidate.recordedBy ||
        existing.evidenceHash !== evidenceHash
      ) {
        throw new RevenueRunConflictError(
          'Commercial-evidence idempotency key already has different evidence',
        );
      }
      return existing;
    }

    const artifactExisting = await tx.revenueRunCommercialEvidence.findUnique({
      where: {
        revenueRunCommercialEvidenceArtifact: {
          workspaceId: params.workspaceId,
          revenueRunId: params.revenueRunId,
          revenueEntryId: params.revenueEntryId,
          kind: params.kind,
          sourceArtifactSha256: params.sourceArtifactSha256,
        },
      },
    });
    if (artifactExisting) {
      throw new RevenueRunConflictError(
        'Commercial evidence artifact already has an immutable assertion',
      );
    }

    return tx.revenueRunCommercialEvidence.create({
      data: { ...candidate, evidenceHash },
    });
  });
}

function eurDecimalToMinorUnits(value: { toString(): string }): bigint {
  const text = value.toString();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/u.exec(text);
  if (!match) {
    throw new RevenueRunOutcomeEvidenceDriftError('EUR evidence has non-cent precision');
  }
  const minor = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -minor : minor;
}

function costEvidenceSetHash(
  kind: 'EXPENSE_SET' | 'RECOGNIZED_RUNTIME_USAGE_SET',
  links: ReadonlyArray<{ factId: string; evidenceHash: string }>,
): string {
  return hashObject({
    kind,
    evidence: [...links].sort((left, right) => left.factId.localeCompare(right.factId)),
  });
}

function costReconciliationHash(input: {
  workspaceId: string;
  revenueRunId: string;
  currency: string;
  expenseEvidenceSetHash: string;
  usageEvidenceSetHash: string;
  expenseTotalMinorUnits: bigint;
  runtimeChargeMinorUnits: bigint;
  overlapMinorUnits: bigint;
  basisReference: string;
  reconciledBy: string;
}): string {
  return hashObject({
    kind: 'REVENUE_RUN_COST_RECONCILIATION',
    workspaceId: input.workspaceId,
    revenueRunId: input.revenueRunId,
    currency: input.currency,
    expenseEvidenceSetHash: input.expenseEvidenceSetHash,
    usageEvidenceSetHash: input.usageEvidenceSetHash,
    expenseTotalMinorUnits: input.expenseTotalMinorUnits.toString(),
    runtimeChargeMinorUnits: input.runtimeChargeMinorUnits.toString(),
    overlapMinorUnits: input.overlapMinorUnits.toString(),
    basisReference: input.basisReference,
    reconciledBy: input.reconciledBy,
  });
}

/**
 * Records an immutable operator reconciliation for the exact current cost
 * evidence sets. The parent-row lock serializes append-only link insertion;
 * any later link changes a set hash and makes this evidence stale.
 */
export async function recordRevenueRunCostReconciliation(
  params: RecordRevenueRunCostReconciliationParams,
) {
  validateCostReconciliationParams(params);
  return prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:revenue-run:cost-reconciliation:${params.idempotencyKey}`,
      tx,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "revenue_runs" WHERE "workspaceId" = ${params.workspaceId}::uuid AND "id" = ${params.revenueRunId}::uuid FOR UPDATE`,
    );
    const run = await tx.revenueRun.findFirst({
      where: { id: params.revenueRunId, workspaceId: params.workspaceId },
      include: {
        expenses: { include: { expense: true } },
        usages: { include: { usage: { include: { costLedgerEntry: true } } } },
      },
    });
    if (!run) throw new RevenueRunNotFoundError('Revenue run not found');
    if (run.expenses.length === 0 || run.usages.length === 0) {
      throw new RevenueRunInvalidInputError(
        'Cost reconciliation requires both expense and recognized runtime evidence',
      );
    }

    let expenseTotalMinorUnits = 0n;
    const expenseSet = run.expenses.map((link) => {
      if (expenseEvidenceHash(link.expense) !== link.evidenceHash) {
        throw new RevenueRunOutcomeEvidenceDriftError('Expense evidence changed after linking');
      }
      expenseTotalMinorUnits += eurDecimalToMinorUnits(link.expense.amountEur);
      return { factId: link.expenseId, evidenceHash: link.evidenceHash };
    });

    let runtimeChargeMinorUnits = 0n;
    const usageSet = run.usages.map((link) => {
      if (usageEvidenceHash(link.usage) !== link.evidenceHash) {
        throw new RevenueRunOutcomeEvidenceDriftError('ACP usage evidence changed after linking');
      }
      runtimeChargeMinorUnits += link.usage.costMinorUnits;
      return { factId: link.usageId, evidenceHash: link.evidenceHash };
    });
    if (expenseTotalMinorUnits < 0n || runtimeChargeMinorUnits < 0n) {
      throw new RevenueRunOutcomeEvidenceDriftError('Cost evidence contains a negative aggregate');
    }
    if (
      params.overlapMinorUnits > expenseTotalMinorUnits ||
      params.overlapMinorUnits > runtimeChargeMinorUnits
    ) {
      throw new RevenueRunInvalidInputError(
        'overlapMinorUnits exceeds an authoritative cost aggregate',
      );
    }

    const expenseEvidenceSetHash = costEvidenceSetHash('EXPENSE_SET', expenseSet);
    const usageEvidenceSetHash = costEvidenceSetHash('RECOGNIZED_RUNTIME_USAGE_SET', usageSet);
    const candidate = {
      workspaceId: params.workspaceId,
      revenueRunId: params.revenueRunId,
      currency: run.currency,
      expenseEvidenceSetHash,
      usageEvidenceSetHash,
      expenseTotalMinorUnits,
      runtimeChargeMinorUnits,
      overlapMinorUnits: params.overlapMinorUnits,
      basisReference: params.basisReference,
      reconciledBy: params.reconciledBy,
    };
    const reconciliationHash = costReconciliationHash(candidate);
    const existing = await tx.revenueRunCostReconciliation.findUnique({
      where: {
        revenueRunCostReconciliationIdempotency: {
          workspaceId: params.workspaceId,
          idempotencyKey: params.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.revenueRunId !== candidate.revenueRunId ||
        existing.currency !== candidate.currency ||
        existing.expenseEvidenceSetHash !== candidate.expenseEvidenceSetHash ||
        existing.usageEvidenceSetHash !== candidate.usageEvidenceSetHash ||
        existing.expenseTotalMinorUnits !== candidate.expenseTotalMinorUnits ||
        existing.runtimeChargeMinorUnits !== candidate.runtimeChargeMinorUnits ||
        existing.overlapMinorUnits !== candidate.overlapMinorUnits ||
        existing.basisReference !== candidate.basisReference ||
        existing.reconciledBy !== candidate.reconciledBy ||
        existing.reconciliationHash !== reconciliationHash
      ) {
        throw new RevenueRunConflictError(
          'Cost-reconciliation idempotency key already has different evidence',
        );
      }
      return existing;
    }

    const evidenceSetExisting = await tx.revenueRunCostReconciliation.findUnique({
      where: {
        revenueRunCostReconciliationEvidenceSet: {
          workspaceId: params.workspaceId,
          revenueRunId: params.revenueRunId,
          expenseEvidenceSetHash,
          usageEvidenceSetHash,
        },
      },
    });
    if (evidenceSetExisting) {
      throw new RevenueRunConflictError(
        'Current cost evidence set already has immutable reconciliation evidence',
      );
    }

    return tx.revenueRunCostReconciliation.create({
      data: {
        ...candidate,
        reconciliationHash,
        idempotencyKey: params.idempotencyKey,
      },
    });
  });
}

/**
 * Returns recorded evidence without claiming that manual/mock revenue is
 * verified. Profit remains absent until an immutable reconciliation matches
 * the exact current cost evidence sets, and is explicitly unverified then.
 */
export async function getRevenueRunOutcomeEvidence(workspaceId: string, revenueRunId: string) {
  requireBoundedText(workspaceId, 'workspaceId');
  requireBoundedText(revenueRunId, 'revenueRunId');
  await enforceFinanceRead(workspaceId, `finance:revenue-run:outcome:${revenueRunId}`);
  return prisma.$transaction(
    async (tx) => {
      const run = await tx.revenueRun.findFirst({
        where: { id: revenueRunId, workspaceId },
        include: {
          revenueEntries: {
            include: { revenueEntry: true, commercialEvidence: true },
          },
          expenses: { include: { expense: true } },
          usages: { include: { usage: { include: { costLedgerEntry: true } } } },
          costReconciliations: { orderBy: { createdAt: 'desc' as const }, take: 1 },
        },
      });
      if (!run) throw new RevenueRunNotFoundError('Revenue run not found');

      let recordedGrossRevenueMinorUnits = 0n;
      let recordedNetRevenueMinorUnits = 0n;
      const commercialEvidence: Array<{
        id: string;
        evidenceHash: string;
        kind: string;
      }> = [];
      for (const link of run.revenueEntries) {
        if (revenueEntryEvidenceHash(link.revenueEntry) !== link.evidenceHash) {
          throw new RevenueRunOutcomeEvidenceDriftError(
            'Revenue-entry evidence changed after linking',
          );
        }
        recordedGrossRevenueMinorUnits += eurDecimalToMinorUnits(link.revenueEntry.grossRevenueEur);
        recordedNetRevenueMinorUnits += eurDecimalToMinorUnits(link.revenueEntry.netRevenueEur);
        for (const evidence of link.commercialEvidence) {
          if (
            evidence.workspaceId !== workspaceId ||
            evidence.revenueRunId !== revenueRunId ||
            evidence.revenueEntryId !== link.revenueEntryId ||
            evidence.verificationState !== 'UNVERIFIED_EXTERNAL_ASSERTION' ||
            commercialEvidenceHash(evidence) !== evidence.evidenceHash
          ) {
            throw new RevenueRunOutcomeEvidenceDriftError(
              'Commercial evidence does not match its exact revenue link',
            );
          }
          commercialEvidence.push({
            id: evidence.id,
            evidenceHash: evidence.evidenceHash,
            kind: evidence.kind,
          });
        }
      }

      let recordedExpenseMinorUnits = 0n;
      for (const link of run.expenses) {
        if (expenseEvidenceHash(link.expense) !== link.evidenceHash) {
          throw new RevenueRunOutcomeEvidenceDriftError('Expense evidence changed after linking');
        }
        recordedExpenseMinorUnits += eurDecimalToMinorUnits(link.expense.amountEur);
      }

      let recognizedRuntimeChargeMinorUnits = 0n;
      let recognizedRuntimeComputeUnits = 0n;
      for (const link of run.usages) {
        if (usageEvidenceHash(link.usage) !== link.evidenceHash) {
          throw new RevenueRunOutcomeEvidenceDriftError('ACP usage evidence changed after linking');
        }
        recognizedRuntimeChargeMinorUnits += link.usage.costMinorUnits;
        recognizedRuntimeComputeUnits += link.usage.computeUnits;
      }

      const expenseEvidenceSetHash = costEvidenceSetHash(
        'EXPENSE_SET',
        run.expenses.map((link) => ({ factId: link.expenseId, evidenceHash: link.evidenceHash })),
      );
      const usageEvidenceSetHash = costEvidenceSetHash(
        'RECOGNIZED_RUNTIME_USAGE_SET',
        run.usages.map((link) => ({ factId: link.usageId, evidenceHash: link.evidenceHash })),
      );
      const reconciliation = run.costReconciliations[0];
      const reconciliationMatchesCurrentEvidence =
        reconciliation?.expenseEvidenceSetHash === expenseEvidenceSetHash &&
        reconciliation.usageEvidenceSetHash === usageEvidenceSetHash;
      if (reconciliationMatchesCurrentEvidence) {
        const expectedHash = costReconciliationHash({
          workspaceId: reconciliation.workspaceId,
          revenueRunId: reconciliation.revenueRunId,
          currency: reconciliation.currency,
          expenseEvidenceSetHash: reconciliation.expenseEvidenceSetHash,
          usageEvidenceSetHash: reconciliation.usageEvidenceSetHash,
          expenseTotalMinorUnits: reconciliation.expenseTotalMinorUnits,
          runtimeChargeMinorUnits: reconciliation.runtimeChargeMinorUnits,
          overlapMinorUnits: reconciliation.overlapMinorUnits,
          basisReference: reconciliation.basisReference,
          reconciledBy: reconciliation.reconciledBy,
        });
        if (
          reconciliation.workspaceId !== workspaceId ||
          reconciliation.revenueRunId !== revenueRunId ||
          reconciliation.currency !== run.currency ||
          reconciliation.expenseTotalMinorUnits !== recordedExpenseMinorUnits ||
          reconciliation.runtimeChargeMinorUnits !== recognizedRuntimeChargeMinorUnits ||
          reconciliation.overlapMinorUnits > recordedExpenseMinorUnits ||
          reconciliation.overlapMinorUnits > recognizedRuntimeChargeMinorUnits ||
          reconciliation.reconciliationHash !== expectedHash
        ) {
          throw new RevenueRunOutcomeEvidenceDriftError(
            'Cost-reconciliation evidence does not match authoritative aggregates',
          );
        }
      }
      const deduplicatedTotalMinorUnits = reconciliationMatchesCurrentEvidence
        ? recordedExpenseMinorUnits +
          recognizedRuntimeChargeMinorUnits -
          reconciliation.overlapMinorUnits
        : null;

      return {
        id: run.id,
        workspaceId: run.workspaceId,
        currency: run.currency,
        forecast: {
          expectedRevenueMinorUnits: run.expectedRevenueMinorUnits,
          expectedCostMinorUnits: run.expectedCostMinorUnits,
          downsideMinorUnits: run.downsideMinorUnits,
          confidenceBps: run.confidenceBps,
          timeToCashDays: run.timeToCashDays,
          evidenceHash: run.forecastEvidenceHash,
        },
        recordedRevenue: {
          evidenceCount: run.revenueEntries.length,
          grossMinorUnits: recordedGrossRevenueMinorUnits,
          netMinorUnits: recordedNetRevenueMinorUnits,
          verificationState: 'UNVERIFIED_SOURCE_RECORDS' as const,
          commercialEvidence: {
            evidenceCount: commercialEvidence.length,
            paymentSettlementCount: commercialEvidence.filter(
              (evidence) => evidence.kind === 'PAYMENT_SETTLEMENT',
            ).length,
            deliveryConfirmationCount: commercialEvidence.filter(
              (evidence) => evidence.kind === 'DELIVERY_CONFIRMATION',
            ).length,
            refundObservationCount: commercialEvidence.filter(
              (evidence) => evidence.kind === 'REFUND_OBSERVATION',
            ).length,
            evidenceSetHash:
              commercialEvidence.length === 0
                ? null
                : commercialEvidenceSetHash(commercialEvidence),
            state:
              commercialEvidence.length === 0
                ? ('NO_COMMERCIAL_EVIDENCE' as const)
                : ('UNVERIFIED_EXTERNAL_ASSERTIONS' as const),
          },
        },
        recordedCosts: {
          expenseEvidenceCount: run.expenses.length,
          expenseMinorUnits: recordedExpenseMinorUnits,
          recognizedRuntimeUsageCount: run.usages.length,
          recognizedRuntimeChargeMinorUnits,
          recognizedRuntimeComputeUnits,
          overlapState: reconciliationMatchesCurrentEvidence
            ? ('RECONCILED_EXACT_EVIDENCE_SET' as const)
            : run.costReconciliations.length > 0
              ? ('STALE_RECONCILIATION_EVIDENCE_SET' as const)
              : ('POTENTIAL_EXPENSE_RUNTIME_OVERLAP' as const),
          reconciledOverlapMinorUnits: reconciliationMatchesCurrentEvidence
            ? reconciliation.overlapMinorUnits
            : null,
          deduplicatedTotalMinorUnits,
          reconciliation: reconciliationMatchesCurrentEvidence
            ? {
                id: reconciliation.id,
                evidenceHash: reconciliation.reconciliationHash,
                basisReference: reconciliation.basisReference,
              }
            : null,
        },
        profit: {
          minorUnits:
            deduplicatedTotalMinorUnits === null
              ? null
              : recordedNetRevenueMinorUnits - deduplicatedTotalMinorUnits,
          state:
            deduplicatedTotalMinorUnits === null
              ? ('NOT_CALCULATED_POTENTIAL_COST_OVERLAP' as const)
              : ('CALCULATED_FROM_UNVERIFIED_REVENUE_AND_RECONCILED_COSTS' as const),
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
