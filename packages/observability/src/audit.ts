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
  integrityHash: string;
}

/**
 * Append-only audit event contract. The actual persistence adapter lives in
 * apps/api (AuditModule) and MUST only ever INSERT rows for this table -
 * never UPDATE or DELETE, enforced at both the application and DB layer.
 * This function builds the immutable, hashed record shape.
 */
export function buildAuditEventRecord(
  input: AuditEventInput,
  id: string,
  now: Date = new Date(),
): AuditEventRecord {
  const timestamp = now.toISOString();
  const integrityHash = hashObject({ ...input, id, timestamp });
  return { ...input, id, timestamp, integrityHash };
}
