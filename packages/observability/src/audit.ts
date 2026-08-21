import { hashObject } from '@ventureos/security';

export interface AuditEventInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string | null;
  workflowId?: string | null;
  policyResult?: unknown;
  approvalReference?: string | null;
  ipOrSessionId?: string | null;
}

export interface AuditEventRecord {
  id: string;
  timestamp: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown | null;
  after: unknown | null;
  correlationId: string | null;
  workflowId: string | null;
  policyResult: unknown | null;
  approvalReference: string | null;
  ipOrSessionId: string | null;
  workspaceReference: string | null;
  actorReference: string | null;
  source: string;
  sourceEventId: string | null;
  idempotencyKey: string | null;
  occurredAt: string | null;
  integrityVersion: 1 | 2;
  integrityHash: string;
}

export interface AuditEventMetadata {
  workspaceReference?: string | null;
  actorReference?: string | null;
  source?: string | null;
  sourceEventId?: string | null;
  idempotencyKey?: string | null;
  occurredAt?: string | null;
}

function integrityContent(record: Omit<AuditEventRecord, 'integrityHash'>): unknown {
  // actorId is a nullable relational pointer that may be cleared by governed
  // user erasure. actorReference is the immutable provenance bound by v2.
  const { actorId: _mutableActorRelation, ...immutableContent } = record;
  return immutableContent;
}

/**
 * Builds the immutable content for an audit row. Version 2 binds operational
 * provenance and replay metadata into the integrity hash. This is an integrity
 * checksum, not a signature or a claim of cryptographic tamper-proof storage.
 */
export function buildAuditEventRecord(
  input: AuditEventInput,
  id: string,
  now: Date = new Date(),
  metadata: AuditEventMetadata = {},
): AuditEventRecord {
  const timestamp = now.toISOString();
  const record: Omit<AuditEventRecord, 'integrityHash'> = {
    id,
    timestamp,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    correlationId: input.correlationId ?? null,
    workflowId: input.workflowId ?? null,
    policyResult: input.policyResult ?? null,
    approvalReference: input.approvalReference ?? null,
    ipOrSessionId: input.ipOrSessionId ?? null,
    workspaceReference: metadata.workspaceReference ?? null,
    actorReference: metadata.actorReference ?? input.actorId ?? null,
    source: metadata.source ?? 'APPLICATION',
    sourceEventId: metadata.sourceEventId ?? null,
    idempotencyKey: metadata.idempotencyKey ?? null,
    occurredAt: metadata.occurredAt ?? null,
    integrityVersion: 2 as const,
  };
  const integrityHash = hashObject(integrityContent(record));
  return { ...record, integrityHash };
}

export function verifyAuditEventRecord(record: AuditEventRecord): boolean {
  if (record.integrityVersion !== 2) return false;
  const { integrityHash, ...content } = record;
  return hashObject(integrityContent(content)) === integrityHash;
}
