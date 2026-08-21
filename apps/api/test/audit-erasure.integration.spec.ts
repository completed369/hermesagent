import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { verifyAuditEventRecord, type AuditEventRecord } from '@ventureos/observability';
import { AuditService } from '../src/modules/audit/audit.service';

describe('audit integrity through relational erasure (integration)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('round-trips canonical omitted and explicit-null fields through relational erasure', async () => {
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

    const service = new AuditService();
    await service.record(workspace.id, {
      actorId: actor.id,
      action: 'AUDIT_ERASURE_OMITTED',
      entityType: 'AuditTest',
      entityId: suffix,
    });
    await service.record(workspace.id, {
      actorId: actor.id,
      action: 'AUDIT_ERASURE_EXPLICIT_NULL',
      entityType: 'AuditTest',
      entityId: suffix,
      before: null,
      after: null,
      correlationId: null,
      workflowId: null,
      policyResult: null,
      approvalReference: null,
      ipOrSessionId: null,
    });
    const beforeErasure = await prisma.auditEvent.findMany({
      where: { workspaceId: workspace.id, action: { startsWith: 'AUDIT_ERASURE_' } },
      orderBy: { action: 'asc' },
    });
    expect(beforeErasure).toHaveLength(2);

    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    const retained = await prisma.auditEvent.findMany({
      where: { id: { in: beforeErasure.map((event) => event.id) } },
      orderBy: { action: 'asc' },
    });

    expect(retained).toHaveLength(2);
    for (const row of retained) {
      expect(row.actorId).toBeNull();
      expect(row.workspaceId).toBeNull();
      expect(row.actorReference).toBe(actor.id);
      expect(row.workspaceReference).toBe(workspace.id);
      const verifiable: AuditEventRecord = {
        id: row.id,
        timestamp: row.createdAt.toISOString(),
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before,
        after: row.after,
        correlationId: row.correlationId,
        workflowId: row.workflowId,
        policyResult: row.policyResult,
        approvalReference: row.approvalReference,
        ipOrSessionId: row.ipOrSessionId,
        workspaceReference: row.workspaceReference,
        actorReference: row.actorReference,
        source: row.source,
        sourceEventId: row.sourceEventId,
        idempotencyKey: row.idempotencyKey,
        occurredAt: row.occurredAt?.toISOString() ?? null,
        integrityVersion: 2,
        integrityHash: row.integrityHash,
      };
      expect(verifyAuditEventRecord(verifiable)).toBe(true);
    }

    await prisma.auditEvent.deleteMany({
      where: { id: { in: retained.map((event) => event.id) } },
    });
  });
});
