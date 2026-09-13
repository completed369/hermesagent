import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Prisma, prisma, hasAuditedCapabilityDispatch } from '@ventureos/database';
import { assertBusinessExecutionInTransaction } from '@ventureos/finance-engine';
import { ResearchProviderReceiptSchema, type ResearchProviderReceipt } from '@ventureos/contracts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const reference = z.string().regex(/^[A-Za-z0-9:._/-]{1,200}$/);
const claimSchema = z
  .object({
    workspaceId: z.string().uuid(),
    runId: reference,
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    commitmentId: reference,
    expectedRunVersion: z.number().int().min(1),
  })
  .strict();
type Claim = z.infer<typeof claimSchema>;

/** Internal journal only. Caller must verify owner, assignment and exact quote/request
 * binding before calling, and recheck authority immediately before the external effect.
 * Existing capability policy still denies the production provider; no API composes this.
 */
export async function claimResearchAttempt(
  raw: Claim,
): Promise<Readonly<Claim & { receiptKey: string }>> {
  const input = claimSchema.parse(raw);
  if (
    process.env.DEPLOYMENT_ENVIRONMENT !== 'production' ||
    !['AI_MODEL_EXECUTION', 'RESEARCH_RUN'].every((capability) =>
      hasAuditedCapabilityDispatch({
        workspaceId: input.workspaceId,
        capability: capability as 'AI_MODEL_EXECUTION' | 'RESEARCH_RUN',
        providerMode: 'anthropic',
      }),
    )
  )
    throw new Error('Research claim requires audited production dispatch');
  const receiptKey = randomBytes(32).toString('hex');
  await prisma.$transaction(async (tx) => {
    await assertBusinessExecutionInTransaction(tx, input.workspaceId);
    const [run] = await tx.$queryRaw<Array<{ eligible: boolean }>>(Prisma.sql`
      SELECT (r.version=${input.expectedRunVersion} AND r.status IN ('ASSIGNED','RUNNING')
        AND t.kind='business.research' AND t.status=r.status
        AND t."assignedAgentId"=r."assignedAgentId"
        AND t."assignedRuntimeId"=r."assignedRuntimeId"
        AND t."assignedConnectionId"=r."assignedConnectionId"
        AND r."assignedAgentId" IS NOT NULL
        AND r."assignedRuntimeId" IS NOT NULL AND r."assignedConnectionId" IS NOT NULL
        AND r."assignmentEvidenceHash" IS NOT NULL) AS eligible
      FROM acp_runs r JOIN acp_tasks t ON t."workspaceId"=r."workspaceId" AND t.id=r."taskId"
      WHERE r."workspaceId"=${input.workspaceId}::uuid AND r.id=${input.runId} FOR UPDATE OF r,t`);
    if (!run?.eligible) throw new Error('Research run is not at the assigned version');
    const [funding] = await tx.$queryRaw<Array<{ eligible: boolean }>>(Prisma.sql`
      SELECT (a.state='RUNNING' AND a.funding_valid_until>clock_timestamp()
        AND c.state='RESERVED' AND c.cost_valid_until>clock_timestamp()) AS eligible
      FROM business_spending_commitments c JOIN business_spending_accounts a ON a.workspace_id=c.workspace_id
      WHERE c.workspace_id=${input.workspaceId}::uuid AND c.id=${input.commitmentId} FOR UPDATE OF c`);
    if (!funding?.eligible) throw new Error('Research reservation is not executable');
    // A duplicate MUST throw, even with identical input. It never grants a resend.
    await tx.$executeRaw(Prisma.sql`INSERT INTO business_research_attempts
      (workspace_id,run_id,request_digest,receipt_key_hash,commitment_id,run_version)
      VALUES (${input.workspaceId}::uuid,${input.runId},${input.requestDigest},${digest(receiptKey)},
        ${input.commitmentId},${input.expectedRunVersion})`);
  });
  return Object.freeze({ ...input, receiptKey });
}

/** Persist even after pause or capability revocation: recording an outcome grants
 * no execution or spend. An unguessable claim-bound key is required. Never log it.
 * Lost receipt/key after a crash leaves the claim unresolved and funds reserved.
 */
export async function recordResearchReceipt(
  raw: ResearchProviderReceipt,
  receiptKey: string,
): Promise<string> {
  const receipt = ResearchProviderReceiptSchema.parse(raw);
  if (!/^[a-f0-9]{64}$/.test(receiptKey)) throw new Error('Invalid research receipt authority');
  const serialized = JSON.stringify(receipt);
  if (Buffer.byteLength(serialized) > 512 * 1024)
    throw new Error('Research receipt exceeds storage bound');
  const receiptDigest = digest(serialized);
  await prisma.$transaction(async (tx) => {
    const [attempt] = await tx.$queryRaw<
      Array<{ request_digest: string; receipt_key_hash: string }>
    >(Prisma.sql`
      SELECT request_digest,receipt_key_hash FROM business_research_attempts
      WHERE workspace_id=${receipt.workspaceId}::uuid AND run_id=${receipt.runId} FOR UPDATE`);
    if (
      !attempt ||
      attempt.request_digest !== receipt.requestDigest ||
      !timingSafeEqual(
        Buffer.from(attempt.receipt_key_hash, 'hex'),
        Buffer.from(digest(receiptKey), 'hex'),
      )
    )
      throw new Error('Receipt does not match its research claim');
    const [existing] = await tx.$queryRaw<Array<{ receipt_digest: string }>>(Prisma.sql`
      SELECT receipt_digest FROM business_research_receipts
      WHERE workspace_id=${receipt.workspaceId}::uuid AND run_id=${receipt.runId}`);
    if (existing) {
      if (existing.receipt_digest !== receiptDigest)
        throw new Error('Research receipt conflicts with saved outcome');
      return;
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO business_research_receipts
      (workspace_id,run_id,request_digest,receipt_digest,receipt)
      VALUES (${receipt.workspaceId}::uuid,${receipt.runId},${receipt.requestDigest},${receiptDigest},${serialized}::jsonb)`);
  });
  // Never insert acp_artifacts, complete the run, release funds or settle a bill here.
  return receiptDigest;
}
