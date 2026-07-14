import { randomUUID } from 'node:crypto';
import { prisma } from '@ventureos/database';
import { buildAuditEventRecord, type AuditEventInput } from '@ventureos/observability';

/**
 * Writes a real, queryable AuditEvent row directly from a Temporal activity.
 * Activities run inside apps/worker, which has no NestJS DI container, so
 * this mirrors apps/api's AuditService.record() exactly (same append-only
 * insert, same integrity hash) rather than routing through it.
 *
 * This closes a gap live browser verification found on 2026-07-14: actions
 * executed via a Temporal workflow (the primary UI path for Phase 3/4/6)
 * were only ever audited at workflow-start (via the API's synchronous
 * startX() call) and at the founder's decision (via ApprovalsService.decide,
 * always a synchronous API call) -- never for the workflow's own
 * intermediate steps (board review completion, product/listing generation,
 * marketplace prepare/approval-request/publish), because those activities
 * called their underlying package functions directly, bypassing the
 * NestJS-only AuditService entirely.
 */
export async function writeAuditEvent(
  workspaceId: string | undefined,
  input: AuditEventInput,
): Promise<void> {
  const id = randomUUID();
  const record = buildAuditEventRecord(input, id);
  await prisma.auditEvent.create({
    data: {
      id: record.id,
      workspaceId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before as never,
      after: input.after as never,
      correlationId: input.correlationId,
      workflowId: input.workflowId,
      policyResult: input.policyResult as never,
      approvalReference: input.approvalReference,
      ipOrSessionId: input.ipOrSessionId,
      integrityHash: record.integrityHash,
      createdAt: record.timestamp,
    },
  });
}
