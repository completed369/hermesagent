import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, prisma } from '@ventureos/database';
import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import { AcpTaskRunService } from '../src/modules/agent-control-plane/acp-task-run.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { buildCeoInstructionPlan } from '../src/modules/ceo/ceo-instruction-plan';

describe('research execution journal (PostgreSQL)', () => {
  let workspaceId: string;
  let otherWorkspaceId: string;
  let runId: string;
  const requestDigest = 'a'.repeat(64);
  beforeAll(async () => {
    const suffix = randomUUID();
    workspaceId = (
      await prisma.workspace.create({
        data: { name: 'Research journal', slug: `research-journal-${suffix}` },
      })
    ).id;
    otherWorkspaceId = (
      await prisma.workspace.create({
        data: { name: 'Other journal', slug: `research-other-${suffix}` },
      })
    ).id;
    const context = { workspaceId, principalId: `planner-${suffix}` };
    const capability = OperationalEventCapability.issue('AI_COO', [
      { ...context, actorKind: 'SYSTEM', authorityLevel: 1 },
    ]);
    const service = new AcpTaskRunService(
      new AuditService(),
      {
        async verify() {
          return false;
        },
      },
      {
        async verify() {
          return false;
        },
      },
    );
    await service.createPlan(
      capability,
      context,
      buildCeoInstructionPlan({ workspaceId, eventId: 'EvJournal', payloadDigest: requestDigest }),
    );
    runId = (await prisma.acpRun.findFirstOrThrow({ where: { workspaceId } })).id;
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO business_spending_accounts(workspace_id) VALUES (${workspaceId}::uuid)`,
    );
    await prisma.$executeRaw(Prisma.sql`INSERT INTO business_spending_commitments
      (workspace_id,id,purchase_group,reserved_cents,cost_evidence,cost_valid_until)
      VALUES (${workspaceId}::uuid,'journal-cost','journal-obligation',100,'synthetic-quote',clock_timestamp()+interval '1 hour')`);
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId].filter(Boolean) } },
    });
  });
  const claim = () =>
    prisma.$executeRaw(Prisma.sql`INSERT INTO business_research_attempts
    (workspace_id,run_id,request_digest,receipt_key_hash,commitment_id,run_version)
    VALUES (${workspaceId}::uuid,${runId},${requestDigest},${'b'.repeat(64)},'journal-cost',1)`);
  it('retains exactly one claim under concurrent inserts and rejects mutation or deletion', async () => {
    const results = await Promise.allSettled([claim(), claim()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(
      prisma.$executeRaw(
        Prisma.sql`UPDATE business_research_attempts SET request_digest=${'c'.repeat(64)} WHERE workspace_id=${workspaceId}::uuid AND run_id=${runId}`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(
        Prisma.sql`DELETE FROM business_research_attempts WHERE workspace_id=${workspaceId}::uuid AND run_id=${runId}`,
      ),
    ).rejects.toThrow();
  });
  it('binds immutable receipts to the claim tenant, run and request without completing work', async () => {
    const value = JSON.stringify({ workspaceId, runId, requestDigest, state: 'OUTCOME_UNKNOWN' });
    const insert = (workspace: string, request: string) =>
      prisma.$executeRaw(Prisma.sql`INSERT INTO business_research_receipts
      (workspace_id,run_id,request_digest,receipt_digest,receipt) VALUES
      (${workspace}::uuid,${runId},${request},${'d'.repeat(64)},${value}::jsonb)`);
    await expect(insert(otherWorkspaceId, requestDigest)).rejects.toThrow();
    await expect(insert(workspaceId, 'c'.repeat(64))).rejects.toThrow();
    await insert(workspaceId, requestDigest);
    await expect(insert(workspaceId, requestDigest)).rejects.toThrow();
    await expect(
      prisma.$executeRaw(
        Prisma.sql`UPDATE business_research_receipts SET receipt_digest=${'e'.repeat(64)} WHERE workspace_id=${workspaceId}::uuid AND run_id=${runId}`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(
        Prisma.sql`DELETE FROM business_research_receipts WHERE workspace_id=${workspaceId}::uuid AND run_id=${runId}`,
      ),
    ).rejects.toThrow();
    expect(await prisma.acpArtifact.count({ where: { workspaceId, runId } })).toBe(0);
    expect(
      (
        await prisma.acpRun.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId, id: runId } },
        })
      ).status,
    ).not.toBe('COMPLETED');
    const [commitment] = await prisma.$queryRaw<Array<{ state: string }>>(
      Prisma.sql`SELECT state FROM business_spending_commitments WHERE workspace_id=${workspaceId}::uuid AND id='journal-cost'`,
    );
    expect(commitment?.state).toBe('RESERVED');
  });
});
