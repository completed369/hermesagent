import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@ventureos/database';
import { buildAuditEventRecord, type AuditEventInput } from '@ventureos/observability';

/**
 * The ONLY way to write an audit event. Callers never touch prisma.auditEvent
 * directly, so this module is the single enforcement point for
 * append-only-ness (create only, never update/delete) and integrity hashing.
 */
@Injectable()
export class AuditService {
  async record(
    workspaceId: string | undefined,
    input: AuditEventInput,
    client: Pick<Prisma.TransactionClient, 'auditEvent'> = prisma,
  ): Promise<void> {
    const id = randomUUID();
    const record = buildAuditEventRecord(input, id);
    await client.auditEvent.create({
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

  async list(workspaceId: string, limit = 100) {
    return prisma.auditEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }
}
