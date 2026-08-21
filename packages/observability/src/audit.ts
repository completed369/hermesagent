import { hashObject } from '@ventureos/security';

export interface AuditEventInput {
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
  workflowId?: string;
  policyResult?: unknown;
  approvalReference?: string;
  ipOrSessionId?: string;
}

export interface AuditEventRecord extends AuditEventInput {
  id: string;
  timestamp: string;
  workspaceReference?: string;
  actorReference?: string;
  source: string;
  sourceEventId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
  integrityVersion: 1 | 2;
  integrityHash: string;
}

export interface AuditEventMetadata {
  workspaceReference?: string;
  actorReference?: string;
  source?: string;
  sourceEventId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
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
  const record = {
    ...input,
    id,
    timestamp,
    workspaceReference: metadata.workspaceReference,
    actorReference: metadata.actorReference ?? input.actorId,
    source: metadata.source ?? 'APPLICATION',
    sourceEventId: metadata.sourceEventId,
    idempotencyKey: metadata.idempotencyKey,
    occurredAt: metadata.occurredAt,
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
