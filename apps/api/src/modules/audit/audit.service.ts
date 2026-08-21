import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@ventureos/database';
import { buildAuditEventRecord, type AuditEventInput } from '@ventureos/observability';
import {
  validateOperationalEvent,
  type OperationalEventCapability,
  type OperationalEvent,
  type WorkspaceContext,
} from '@ventureos/agent-control-plane';

/**
 * Application audit writer. Immutable audit content is inserted here; the
 * database rejects later content updates while retaining explicit row deletion
 * for governed retention and tenant/user erasure.
 */
@Injectable()
export class AuditService {
  async record(
    workspaceId: string | undefined,
    input: AuditEventInput,
    client: Pick<Prisma.TransactionClient, 'auditEvent'> = prisma,
  ): Promise<void> {
    const id = randomUUID();
    const record = buildAuditEventRecord(input, id, new Date(), {
      workspaceReference: workspaceId,
      actorReference: input.actorId,
      sourceEventId: id,
    });
    await client.auditEvent.create({
      data: {
        id: record.id,
        workspaceId,
        actorId: input.actorId,
        workspaceReference: record.workspaceReference,
        actorReference: record.actorReference,
        source: record.source,
        sourceEventId: record.sourceEventId,
        idempotencyKey: record.idempotencyKey,
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
        integrityVersion: record.integrityVersion,
        occurredAt: record.occurredAt ? new Date(record.occurredAt) : undefined,
        createdAt: record.timestamp,
      },
    });
  }

  async recordOperationalEvent(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    event: OperationalEvent,
    relationalActorId?: string,
    client: Pick<Prisma.TransactionClient, 'auditEvent'> = prisma,
  ): Promise<void> {
    validateOperationalEvent(capability, context, event);
    if (
      relationalActorId !== undefined &&
      (event.actorKind !== 'HUMAN' || relationalActorId !== event.actorId)
    ) {
      throw new Error('Relational audit actor must match the authenticated human event actor');
    }
    const record = buildAuditEventRecord(
      {
        actorId: relationalActorId,
        action: event.type,
        entityType: event.subjectType,
        entityId: event.subjectId,
        after: event.facts,
        correlationId: event.correlationId,
        policyResult: { actorKind: event.actorKind },
      },
      randomUUID(),
      new Date(),
      {
        workspaceReference: event.workspaceId,
        actorReference: event.actorId,
        source: event.source,
        sourceEventId: event.id,
        idempotencyKey: event.idempotencyKey,
        occurredAt: event.occurredAt,
      },
    );
    await client.auditEvent.create({
      data: {
        id: record.id,
        workspaceId: event.workspaceId,
        actorId: relationalActorId,
        workspaceReference: record.workspaceReference,
        actorReference: record.actorReference,
        source: record.source,
        sourceEventId: record.sourceEventId,
        idempotencyKey: record.idempotencyKey,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        after: record.after as never,
        correlationId: record.correlationId,
        policyResult: record.policyResult as never,
        integrityHash: record.integrityHash,
        integrityVersion: record.integrityVersion,
        occurredAt: new Date(event.occurredAt),
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
