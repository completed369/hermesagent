import { Prisma, prisma } from '@ventureos/database';
import { enforceFinanceMutation, enforceFinanceRead } from './capability-guard.js';
import { assertBusinessSpend, BusinessSpendDeniedError } from './business-spend-policy.js';

interface Account {
  state: string;
  funding_cents: bigint;
  protected_cents: bigint;
  funding_fresh: boolean;
}
interface Commitment {
  id: string;
  purchase_group: string;
  reserved_cents: bigint;
  actual_cents: bigint | null;
  state: string;
  cost_evidence: string;
  cost_valid_until: Date;
  settlement_evidence: string | null;
}

function reference(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:._/-]{1,200}$/.test(value))
    throw new BusinessSpendDeniedError('A bounded evidence reference is required');
}

async function lockAccount(tx: Prisma.TransactionClient, workspaceId: string): Promise<Account> {
  const [account] = await tx.$queryRaw<Account[]>(Prisma.sql`
    SELECT state, funding_cents, protected_cents,
      COALESCE(funding_valid_until > clock_timestamp(), false) AS funding_fresh
    FROM business_spending_accounts WHERE workspace_id = ${workspaceId}::uuid FOR UPDATE`);
  if (!account) throw new BusinessSpendDeniedError('Business funding has not been configured');
  return account;
}

async function totals(tx: Prisma.TransactionClient, workspaceId: string, group: string) {
  const [row] = await tx.$queryRaw<Array<{ lifetime: bigint; monthly: bigint; related: bigint }>>(
    Prisma.sql`SELECT
      COALESCE(SUM(COALESCE(actual_cents, reserved_cents)), 0)::bigint AS lifetime,
      COALESCE(SUM(COALESCE(actual_cents, reserved_cents)) FILTER (WHERE state = 'RESERVED' OR
        date_trunc('month', settled_at AT TIME ZONE 'Asia/Nicosia') =
        date_trunc('month', clock_timestamp() AT TIME ZONE 'Asia/Nicosia')), 0)::bigint AS monthly,
      COALESCE(SUM(COALESCE(actual_cents, reserved_cents)) FILTER (WHERE purchase_group = ${group}), 0)::bigint AS related
    FROM business_spending_commitments WHERE workspace_id = ${workspaceId}::uuid AND state <> 'CANCELLED'`,
  );
  if (!row) throw new BusinessSpendDeniedError('Business ledger unavailable');
  return row;
}

export interface ReserveBusinessExpenseInput {
  workspaceId: string;
  id: string;
  /** Stable commercial obligation ID; all related purchases share it. */
  purchaseGroup: string;
  /** Full contractual maximum including fees, tax, renewals and retries. */
  maximumCents: bigint;
  costEvidence: string;
  costValidUntil: Date;
}

/** Internal pre-execution reservation, composed inside the caller's transaction. */
export async function reserveBusinessExpenseInTransaction(
  tx: Prisma.TransactionClient,
  input: ReserveBusinessExpenseInput,
): Promise<void> {
  for (const value of [input.id, input.purchaseGroup, input.costEvidence]) reference(value);
  if (!Number.isFinite(input.costValidUntil.getTime()))
    throw new BusinessSpendDeniedError('Verified cost expiry is required');
  await enforceFinanceMutation(input.workspaceId, `business:reserve:${input.id}`, tx);
  const account = await lockAccount(tx, input.workspaceId);
  const [existing] = await tx.$queryRaw<Commitment[]>(Prisma.sql`
    SELECT * FROM business_spending_commitments
    WHERE workspace_id = ${input.workspaceId}::uuid AND id = ${input.id}`);
  if (existing) {
    if (
      existing.purchase_group !== input.purchaseGroup ||
      existing.reserved_cents !== input.maximumCents ||
      existing.cost_evidence !== input.costEvidence ||
      existing.state !== 'RESERVED' ||
      existing.cost_valid_until.getTime() !== input.costValidUntil.getTime()
    )
      throw new BusinessSpendDeniedError(
        'Commitment replay does not match the original reservation',
      );
    // A replay is not permission to execute again. Dispatch remains separately idempotent.
    if (account.state !== 'RUNNING' || !account.funding_fresh)
      throw new BusinessSpendDeniedError('Business spending is unavailable');
    const [fresh] = await tx.$queryRaw<Array<{ valid: boolean }>>(Prisma.sql`
      SELECT ${existing.cost_valid_until} > clock_timestamp() AS valid`);
    if (!fresh?.valid) throw new BusinessSpendDeniedError('Verified cost information has expired');
    return;
  }
  const [clock] = await tx.$queryRaw<Array<{ valid: boolean }>>(Prisma.sql`
    SELECT ${input.costValidUntil} > clock_timestamp() AS valid`);
  if (!clock?.valid) throw new BusinessSpendDeniedError('Verified cost information has expired');
  const used = await totals(tx, input.workspaceId, input.purchaseGroup);
  assertBusinessSpend(
    {
      state: account.state,
      fundingFresh: account.funding_fresh,
      availableCents: account.funding_cents - account.protected_cents - used.lifetime,
      monthlyUsedCents: used.monthly,
      relatedUsedCents: used.related,
    },
    input.maximumCents,
  );
  await tx.$executeRaw(Prisma.sql`INSERT INTO business_spending_commitments
    (workspace_id, id, purchase_group, reserved_cents, cost_evidence, cost_valid_until)
    VALUES (${input.workspaceId}::uuid, ${input.id}, ${input.purchaseGroup}, ${input.maximumCents},
      ${input.costEvidence}, ${input.costValidUntil})`);
  await tx.$executeRaw(Prisma.sql`INSERT INTO business_spending_events
    (workspace_id, commitment_id, kind, cents, evidence)
    VALUES (${input.workspaceId}::uuid, ${input.id}, 'RESERVED', ${input.maximumCents}, ${input.costEvidence})`);
}

export async function reserveBusinessExpense(input: ReserveBusinessExpenseInput): Promise<void> {
  await prisma.$transaction((tx) => reserveBusinessExpenseInTransaction(tx, input));
}

/** Fresh admission check; a reservation is not itself permission to issue a provider call. */
export async function isBusinessReservationExecutable(
  workspaceId: string,
  id: string,
  requiresFunds: boolean,
): Promise<boolean> {
  await enforceFinanceRead(workspaceId, `business:dispatch-check:${id}`);
  const [row] = await prisma.$queryRaw<Array<{ allowed: boolean }>>(Prisma.sql`
    SELECT (a.state='RUNNING' AND ((NOT ${requiresFunds} AND c.id IS NULL) OR
      (a.funding_valid_until>clock_timestamp() AND c.state='RESERVED' AND c.cost_valid_until>clock_timestamp()))) AS allowed
    FROM business_spending_accounts a LEFT JOIN business_spending_commitments c
      ON c.workspace_id=a.workspace_id AND c.id=${id}
    WHERE a.workspace_id=${workspaceId}::uuid`);
  return row?.allowed === true;
}

/** Release only after trusted provider/cancellation evidence establishes no further liability. */
export async function cancelBusinessExpense(input: {
  workspaceId: string;
  id: string;
  evidence: string;
}): Promise<void> {
  reference(input.id);
  reference(input.evidence);
  await prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(input.workspaceId, `business:cancel:${input.id}`, tx);
    await lockAccount(tx, input.workspaceId);
    const [item] = await tx.$queryRaw<
      Commitment[]
    >(Prisma.sql`SELECT * FROM business_spending_commitments
      WHERE workspace_id=${input.workspaceId}::uuid AND id=${input.id}`);
    if (item?.state === 'CANCELLED' && item.settlement_evidence === input.evidence) return;
    if (!item || item.state !== 'RESERVED')
      throw new BusinessSpendDeniedError('Reservation cannot be cancelled');
    await tx.$executeRaw(Prisma.sql`UPDATE business_spending_commitments SET state='CANCELLED',settlement_evidence=${input.evidence}
      WHERE workspace_id=${input.workspaceId}::uuid AND id=${input.id}`);
    await tx.$executeRaw(Prisma.sql`INSERT INTO business_spending_events(workspace_id,commitment_id,kind,evidence)
      VALUES(${input.workspaceId}::uuid,${input.id},'CANCELLED',${input.evidence})`);
  });
}

/** A real dispatch must also recheck pause immediately before its external effect. */
export async function assertBusinessExecutionInTransaction(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await enforceFinanceMutation(workspaceId, 'business:dispatch', tx);
  const account = await lockAccount(tx, workspaceId);
  if (account.state !== 'RUNNING')
    throw new BusinessSpendDeniedError('Business execution is paused or stopped');
}

/** Actual invoices are recorded even after pause, expiry or a provider overrun. */
export async function reconcileBusinessExpense(input: {
  workspaceId: string;
  id: string;
  actualCents: bigint;
  evidence: string;
}): Promise<void> {
  reference(input.id);
  reference(input.evidence);
  if (typeof input.actualCents !== 'bigint' || input.actualCents < 0n)
    throw new BusinessSpendDeniedError('Actual cost must be non-negative integer cents');
  await prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(input.workspaceId, `business:settle:${input.id}`, tx);
    await lockAccount(tx, input.workspaceId);
    const [item] = await tx.$queryRaw<
      Commitment[]
    >(Prisma.sql`SELECT * FROM business_spending_commitments
      WHERE workspace_id = ${input.workspaceId}::uuid AND id = ${input.id}`);
    if (!item) throw new BusinessSpendDeniedError('Reservation not found');
    if (
      item.state === 'SETTLED' &&
      item.actual_cents === input.actualCents &&
      item.settlement_evidence === input.evidence
    )
      return;
    if (item.state !== 'RESERVED')
      throw new BusinessSpendDeniedError('Settlement replay conflicts with history');
    await tx.$executeRaw(Prisma.sql`UPDATE business_spending_commitments SET state = 'SETTLED',
      actual_cents = ${input.actualCents}, settlement_evidence = ${input.evidence}, settled_at = clock_timestamp()
      WHERE workspace_id = ${input.workspaceId}::uuid AND id = ${input.id}`);
    await tx.$executeRaw(Prisma.sql`INSERT INTO business_spending_events
      (workspace_id, commitment_id, kind, cents, evidence)
      VALUES (${input.workspaceId}::uuid, ${input.id}, 'SETTLED', ${input.actualCents}, ${input.evidence})`);
    if (input.actualCents > item.reserved_cents) {
      await tx.$executeRaw(Prisma.sql`UPDATE business_spending_accounts SET state = 'PAUSED',
        funding_valid_until = NULL, funding_evidence = NULL, updated_at = clock_timestamp()
        WHERE workspace_id = ${input.workspaceId}::uuid`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO business_spending_events
        (workspace_id, commitment_id, kind, evidence)
        VALUES (${input.workspaceId}::uuid, ${input.id}, 'PAUSED', ${input.evidence})`);
    }
  });
}

export async function readBusinessBudget(workspaceId: string) {
  await enforceFinanceRead(workspaceId, 'business:budget:read');
  return prisma.$transaction(async (tx) => {
    const account = await lockAccount(tx, workspaceId);
    const used = await totals(tx, workspaceId, 'budget-report');
    return {
      state: account.state,
      fundingVerified: account.funding_fresh,
      availableCents: account.funding_fresh
        ? account.funding_cents - account.protected_cents - used.lifetime
        : null,
      paidAndCommittedCents: used.lifetime,
      monthlyPaidAndCommittedCents: used.monthly,
      monthlyRemainingCents: 15_000n - used.monthly,
      singleExpenseLimitCents: 2_500n,
    };
  });
}

/** Only a verified workspace founder can change execution state. Never grants funding. */
export async function setBusinessExecutionState(input: {
  workspaceId: string;
  founderId: string;
  state: 'RUNNING' | 'PAUSED' | 'STOPPED';
  evidence: string;
}): Promise<void> {
  await prisma.$transaction((tx) => setBusinessExecutionStateInTransaction(tx, input));
}

export async function setBusinessExecutionStateInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    founderId: string;
    state: 'RUNNING' | 'PAUSED' | 'STOPPED';
    evidence: string;
  },
): Promise<void> {
  reference(input.evidence);
  if (!['RUNNING', 'PAUSED', 'STOPPED'].includes(input.state))
    throw new BusinessSpendDeniedError('Invalid execution state');
  const founder = await tx.workspaceMember.findFirst({
    where: {
      workspaceId: input.workspaceId,
      userId: input.founderId,
      role: { key: 'FOUNDER' },
      user: { isFounder: true, deletedAt: null },
    },
  });
  if (!founder) throw new BusinessSpendDeniedError('Verified workspace founder required');
  // Pause/stop must remain available even if the billing entitlement has expired.
  if (input.state === 'RUNNING')
    await enforceFinanceMutation(input.workspaceId, 'business:resume', tx);
  await tx.$executeRaw(Prisma.sql`INSERT INTO business_spending_accounts (workspace_id)
      VALUES (${input.workspaceId}::uuid) ON CONFLICT (workspace_id) DO NOTHING`);
  await lockAccount(tx, input.workspaceId);
  await tx.$executeRaw(Prisma.sql`UPDATE business_spending_accounts SET state = ${input.state},
      updated_at = clock_timestamp() WHERE workspace_id = ${input.workspaceId}::uuid`);
  const kind = input.state === 'RUNNING' ? 'RESUMED' : input.state;
  await tx.$executeRaw(Prisma.sql`INSERT INTO business_spending_events (workspace_id, kind, evidence)
      VALUES (${input.workspaceId}::uuid, ${kind}, ${input.evidence})`);
}
