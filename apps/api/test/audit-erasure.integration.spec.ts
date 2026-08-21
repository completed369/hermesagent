import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { verifyAuditEventRecord, type AuditEventRecord } from '@ventureos/observability';
import { AuditService } from '../src/modules/audit/audit.service';

describe('audit integrity through relational erasure (integration)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('retains a verifiable v2 checksum when user and workspace relations are cleared', async () => {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: 'Audit erasure test', slug: `audit-erasure-${suffix}` },
    });
    const actor = await prisma.user.create({
      data: {
        email: `audit-erasure-${suffix}@ventureos.local`,
        displayName: 'Audit erasure actor',
      },
    });

    await new AuditService().record(workspace.id, {
      actorId: actor.id,
      action: 'AUDIT_ERASURE_ROUNDTRIP',
      entityType: 'AuditTest',
      entityId: suffix,
      correlationId: `audit-erasure:${suffix}`,
    });
    const beforeErasure = await prisma.auditEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: 'AUDIT_ERASURE_ROUNDTRIP' },
    });

    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    const retained = await prisma.auditEvent.findUniqueOrThrow({ where: { id: beforeErasure.id } });

    expect(retained.actorId).toBeNull();
    expect(retained.workspaceId).toBeNull();
    expect(retained.actorReference).toBe(actor.id);
    expect(retained.workspaceReference).toBe(workspace.id);
    const verifiable: AuditEventRecord = {
      id: retained.id,
      timestamp: retained.createdAt.toISOString(),
      actorId: undefined,
      action: retained.action,
      entityType: retained.entityType,
      entityId: retained.entityId,
      correlationId: retained.correlationId ?? undefined,
      workspaceReference: retained.workspaceReference ?? undefined,
      actorReference: retained.actorReference ?? undefined,
      source: retained.source,
      sourceEventId: retained.sourceEventId ?? undefined,
      idempotencyKey: retained.idempotencyKey ?? undefined,
      occurredAt: retained.occurredAt?.toISOString(),
      integrityVersion: 2,
      integrityHash: retained.integrityHash,
    };
    expect(verifyAuditEventRecord(verifiable)).toBe(true);

    await prisma.auditEvent.delete({ where: { id: retained.id } });
  });
});
