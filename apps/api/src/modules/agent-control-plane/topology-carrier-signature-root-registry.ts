import { createHash } from 'node:crypto';

import type { OperationalEventCapability, WorkspaceContext } from '@ventureos/agent-control-plane';
import {
  canonicalJson,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  validateRetainedNativeSupervisorTopologyObservationCarrierBinding,
  validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
  type RetainedNativeSupervisorTopologyObservationCarrierBinding,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';

export interface TopologyCarrierSignatureRootSqlClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const AUTHORIZATION_LIFETIME_MS = 60_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

export interface TopologyCarrierSignatureRootProvisioningRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'TOPOLOGY_CARRIER_SIGNATURE_PUBLIC_ROOT_PROVISIONING';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly binding: Readonly<RetainedNativeSupervisorTopologyObservationCarrierBinding>;
  readonly root: Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord>;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

interface RootRow extends RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord {}

interface ProvisionedRootRow extends RootRow {
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly carrierId: string;
  readonly provisioningRequestHash: string;
  readonly provisioningAuthorizationId: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: number;
  readonly authorizedFrom: Date;
  readonly authorizedUntil: Date;
}

export class TopologyCarrierSignatureRootRegistryDeniedError extends Error {}

function deny(message: string): never {
  throw new TopologyCarrierSignatureRootRegistryDeniedError(message);
}

function reference(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    return deny(`${field} must be a safe non-sensitive reference`);
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function clockValue(clock: () => number): number {
  const now = clock();
  if (
    !Number.isFinite(now) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > MAX_DATE_MS - AUTHORIZATION_LIFETIME_MS
  )
    return deny('Root provisioning clock is invalid');
  return now;
}

function exactRequest(
  input: unknown,
  now: number,
): Readonly<TopologyCarrierSignatureRootProvisioningRequest> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return deny('Root provisioning request is invalid');
  const value = input as Record<string, unknown>;
  const expected = [
    'binding',
    'purpose',
    'root',
    'runtimeConnection',
    'schemaVersion',
    'supervisorInstanceId',
    'workspaceId',
  ].sort();
  const keys = Object.keys(value).sort();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Reflect.ownKeys(value).length !== expected.length ||
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    keys.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value')) ||
    value.schemaVersion !== 1 ||
    value.purpose !== 'TOPOLOGY_CARRIER_SIGNATURE_PUBLIC_ROOT_PROVISIONING' ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    return deny('Root provisioning request shape is invalid');
  const workspaceId = reference(value.workspaceId, 'workspaceId');
  const supervisorInstanceId = reference(value.supervisorInstanceId, 'supervisorInstanceId');
  const binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
    value.binding,
    now,
  );
  const root = validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord(
    value.root,
  );
  const expectedPrincipal =
    root.principalRole === 'API_COORDINATOR'
      ? binding.coordinatorPrincipalReference
      : binding.workerPrincipalReference;
  if (
    workspaceId !== binding.workspaceId ||
    supervisorInstanceId !== binding.supervisorInstanceId ||
    root.rootRecordVersion !== 1 ||
    root.principalReference !== expectedPrincipal ||
    root.bindingHash !== retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding) ||
    root.revokedAt !== null ||
    Date.parse(root.validFrom) > Date.parse(binding.issuedAt) ||
    Date.parse(root.validUntil) < Date.parse(binding.expiresAt)
  )
    return deny('Root does not grant the exact live carrier binding');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'TOPOLOGY_CARRIER_SIGNATURE_PUBLIC_ROOT_PROVISIONING',
    workspaceId,
    supervisorInstanceId,
    binding,
    root,
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function rootFromRow(
  row: RootRow,
): Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord> {
  return validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord({
    schemaVersion: row.schemaVersion,
    rootRecordId: row.rootRecordId,
    rootRecordVersion: row.rootRecordVersion,
    signerKeyId: row.signerKeyId,
    algorithm: row.algorithm,
    purpose: row.purpose,
    principalRole: row.principalRole,
    principalReference: row.principalReference,
    bindingHash: row.bindingHash,
    publicKeySpkiBase64: row.publicKeySpkiBase64,
    publicKeySpkiSha256: row.publicKeySpkiSha256,
    validFrom: new Date(row.validFrom).toISOString(),
    validUntil: new Date(row.validUntil).toISOString(),
    revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt).toISOString(),
    testOnly: row.testOnly,
  });
}

/**
 * Durable public-only trust grants for one exact five-second carrier binding.
 * No private key, signer, transport, or runtime composition is reachable here.
 */
export class PostgresTopologyCarrierSignatureRootRegistry {
  constructor(private readonly database: TopologyCarrierSignatureRootSqlClient) {
    Object.freeze(this);
  }

  async read(
    bindingInput: unknown,
    principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
    clock: () => number = Date.now,
  ): Promise<Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord> | null> {
    const now = clockValue(clock);
    const binding = validateRetainedNativeSupervisorTopologyObservationCarrierBinding(
      bindingInput,
      now,
    );
    if (principalRole !== 'API_COORDINATOR' && principalRole !== 'WORKER_CLIENT')
      return deny('Carrier principal role is invalid');
    const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
    const principalReference =
      principalRole === 'API_COORDINATOR'
        ? binding.coordinatorPrincipalReference
        : binding.workerPrincipalReference;
    const rows = await this.database.$queryRaw<readonly RootRow[]>(Prisma.sql`
      SELECT 1 AS "schemaVersion", r."rootRecordId", r."rootRecordVersion", r."signerKeyId",
        r."algorithm", r."purpose", r."principalRole", r."principalReference", r."bindingHash",
        r."publicKeySpkiBase64", r."publicKeySpkiSha256", r."validFrom", r."validUntil",
        r."revokedAt", r."testOnly"
      FROM "acp_topology_carrier_signature_roots" r
      JOIN "acp_topology_carrier_signature_root_scopes" s
        ON s."carrierId" = r."carrierId"
       AND s."workspaceId" = r."workspaceId"
       AND s."supervisorInstanceId" = r."supervisorInstanceId"
       AND s."bindingHash" = r."bindingHash"
      WHERE r."workspaceId" = CAST(${binding.workspaceId} AS UUID)
        AND r."supervisorInstanceId" = ${binding.supervisorInstanceId}
        AND r."carrierId" = ${binding.carrierId}
        AND r."bindingHash" = ${bindingHash}
        AND r."principalRole" = ${principalRole}
        AND r."principalReference" = ${principalReference}
        AND r."validFrom" <= ${new Date(binding.issuedAt)}
        AND r."validUntil" >= ${new Date(binding.expiresAt)}
        AND r."revokedAt" IS NULL
        AND s."issuedAt" <= clock_timestamp()
        AND s."expiresAt" > clock_timestamp()
      LIMIT 2
    `);
    if (!Array.isArray(rows) || rows.length > 1) return deny('Carrier root state is ambiguous');
    return rows[0] === undefined ? null : rootFromRow(rows[0]);
  }

  async provision(
    input: unknown,
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    clock: () => number = Date.now,
  ): Promise<'APPENDED' | 'REPLAYED'> {
    const now = clockValue(clock);
    const request = exactRequest(input, now);
    const boundContext = Object.freeze({
      workspaceId: reference(context.workspaceId, 'workspaceId'),
      principalId: reference(context.principalId, 'principalId'),
    });
    capability.assertSource('CONTROL_PLANE');
    const actorKind = capability.actorKindFor(boundContext);
    if (
      request.workspaceId !== boundContext.workspaceId ||
      actorKind === 'RUNTIME' ||
      capability.authorityLevelFor(boundContext) !== 3
    )
      return deny('Exact workspace-bound Level-3 control-plane authority is required');

    const authorizedFrom = new Date(now).toISOString();
    const authorizedUntil = new Date(now + AUTHORIZATION_LIFETIME_MS).toISOString();
    const provisioningRequestHash = digest(request);
    const evidenceBinding = Object.freeze({
      evidencePurpose: 'TOPOLOGY_CARRIER_PUBLIC_ROOT_LEVEL3_AUTHORIZATION' as const,
      policyVersion: 1 as const,
      request,
      authorizedByReference: boundContext.principalId,
      actorKind,
      authorityLevel: 3 as const,
      authorizedFrom,
      authorizedUntil,
    });
    const approvalEvidenceHash = digest(evidenceBinding);
    const provisioningAuthorizationId = `carrier-root:${approvalEvidenceHash}`;
    const approvalId = `level3-control-plane:${approvalEvidenceHash}`;
    const binding = request.binding;
    const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
    const root = request.root;
    const inserted = await this.database.$queryRaw<readonly { readonly applied: number }[]>(
      Prisma.sql`
        WITH inserted_scope AS (
          INSERT INTO "acp_topology_carrier_signature_root_scopes" (
            "carrierId", "workspaceId", "supervisorInstanceId", "bindingHash",
            "coordinatorPrincipalReference", "workerPrincipalReference",
            "provisioningAttemptId", "provisioningPlanHash", "issuedAt", "expiresAt"
          ) VALUES (
            ${binding.carrierId}, CAST(${binding.workspaceId} AS UUID),
            ${binding.supervisorInstanceId}, ${bindingHash},
            ${binding.coordinatorPrincipalReference}, ${binding.workerPrincipalReference},
            ${binding.provisioningAttemptId}, ${binding.provisioningPlanHash},
            ${new Date(binding.issuedAt)}, ${new Date(binding.expiresAt)}
          ) ON CONFLICT DO NOTHING
          RETURNING 1
        ), bound_scope AS (
          SELECT 1 FROM inserted_scope
          UNION ALL
          SELECT 1 FROM "acp_topology_carrier_signature_root_scopes"
          WHERE "carrierId" = ${binding.carrierId}
            AND "workspaceId" = CAST(${binding.workspaceId} AS UUID)
            AND "supervisorInstanceId" = ${binding.supervisorInstanceId}
            AND "bindingHash" = ${bindingHash}
            AND "coordinatorPrincipalReference" = ${binding.coordinatorPrincipalReference}
            AND "workerPrincipalReference" = ${binding.workerPrincipalReference}
            AND "provisioningAttemptId" = ${binding.provisioningAttemptId}
            AND "provisioningPlanHash" = ${binding.provisioningPlanHash}
            AND "issuedAt" = ${new Date(binding.issuedAt)}
            AND "expiresAt" = ${new Date(binding.expiresAt)}
          LIMIT 1
        ), inserted_root AS (
          INSERT INTO "acp_topology_carrier_signature_roots" (
            "workspaceId", "supervisorInstanceId", "carrierId", "bindingHash",
            "rootRecordId", "rootRecordVersion", "signerKeyId", "algorithm", "purpose",
            "principalRole", "principalReference", "publicKeySpkiBase64",
            "publicKeySpkiSha256", "validFrom", "validUntil", "revokedAt", "testOnly"
          ) SELECT CAST(${binding.workspaceId} AS UUID), ${binding.supervisorInstanceId},
            ${binding.carrierId}, ${bindingHash}, ${root.rootRecordId}, ${root.rootRecordVersion},
            ${root.signerKeyId}, ${root.algorithm}, ${root.purpose}, ${root.principalRole},
            ${root.principalReference}, ${root.publicKeySpkiBase64}, ${root.publicKeySpkiSha256},
            ${new Date(root.validFrom)}, ${new Date(root.validUntil)}, NULL, false
          FROM bound_scope
          ON CONFLICT DO NOTHING
          RETURNING 1
        ), inserted_evidence AS (
          INSERT INTO "acp_topology_carrier_signature_root_evidence" (
            "workspaceId", "supervisorInstanceId", "carrierId", "bindingHash",
            "principalRole", "rootRecordId", "rootRecordVersion", "signerKeyId",
            "publicKeySpkiSha256", "provisioningRequestHash", "provisioningAuthorizationId",
            "approvalId", "approvalEvidenceHash", "authorizedByReference", "authorityLevel",
            "authorizedFrom", "authorizedUntil"
          ) SELECT CAST(${binding.workspaceId} AS UUID), ${binding.supervisorInstanceId},
            ${binding.carrierId}, ${bindingHash}, ${root.principalRole}, ${root.rootRecordId},
            ${root.rootRecordVersion}, ${root.signerKeyId}, ${root.publicKeySpkiSha256},
            ${provisioningRequestHash}, ${provisioningAuthorizationId}, ${approvalId},
            ${approvalEvidenceHash}, ${boundContext.principalId}, 3,
            ${new Date(authorizedFrom)}, ${new Date(authorizedUntil)}
          FROM inserted_root
          RETURNING 1
        )
        SELECT CASE WHEN EXISTS (SELECT 1 FROM inserted_evidence) THEN 1 ELSE 0 END AS "applied"
      `,
    );
    if (
      !Array.isArray(inserted) ||
      inserted.length !== 1 ||
      ![0, 1].includes(inserted[0]?.applied ?? -1)
    )
      return deny('Root provisioning result is invalid');
    if (inserted[0]!.applied === 1) return 'APPENDED';

    const existing = await this.database.$queryRaw<readonly ProvisionedRootRow[]>(Prisma.sql`
      SELECT 1 AS "schemaVersion", r."workspaceId"::TEXT AS "workspaceId",
        r."supervisorInstanceId", r."carrierId", r."rootRecordId", r."rootRecordVersion",
        r."signerKeyId", r."algorithm", r."purpose", r."principalRole",
        r."principalReference", r."bindingHash", r."publicKeySpkiBase64",
        r."publicKeySpkiSha256", r."validFrom", r."validUntil", r."revokedAt", r."testOnly",
        e."provisioningRequestHash", e."provisioningAuthorizationId", e."approvalId",
        e."approvalEvidenceHash", e."authorizedByReference", e."authorityLevel",
        e."authorizedFrom", e."authorizedUntil"
      FROM "acp_topology_carrier_signature_roots" r
      JOIN "acp_topology_carrier_signature_root_evidence" e
        ON e."workspaceId" = r."workspaceId"
       AND e."supervisorInstanceId" = r."supervisorInstanceId"
       AND e."carrierId" = r."carrierId"
       AND e."principalRole" = r."principalRole"
      WHERE r."workspaceId" = CAST(${request.workspaceId} AS UUID)
        AND r."supervisorInstanceId" = ${request.supervisorInstanceId}
        AND r."carrierId" = ${binding.carrierId}
        AND r."principalRole" = ${root.principalRole}
      LIMIT 2
    `);
    const current = existing[0];
    if (
      !Array.isArray(existing) ||
      existing.length !== 1 ||
      current === undefined ||
      canonicalJson(rootFromRow(current)) !== canonicalJson(root) ||
      current.workspaceId !== request.workspaceId ||
      current.supervisorInstanceId !== request.supervisorInstanceId ||
      current.carrierId !== binding.carrierId ||
      current.provisioningRequestHash !== provisioningRequestHash ||
      !SAFE_REFERENCE.test(current.provisioningAuthorizationId) ||
      !SAFE_REFERENCE.test(current.approvalId) ||
      !SAFE_REFERENCE.test(current.authorizedByReference) ||
      !SHA256.test(current.approvalEvidenceHash) ||
      current.authorityLevel !== 3 ||
      !(current.authorizedFrom instanceof Date) ||
      !(current.authorizedUntil instanceof Date) ||
      current.authorizedUntil.getTime() <= current.authorizedFrom.getTime() ||
      current.authorizedUntil.getTime() - current.authorizedFrom.getTime() > 5 * 60_000
    )
      return deny('Conflicting root provisioning replay denied');
    return 'REPLAYED';
  }
}
