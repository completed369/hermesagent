import { createHash } from 'node:crypto';

import type { OperationalEventCapability, WorkspaceContext } from '@ventureos/agent-control-plane';
import {
  canonicalJson,
  validateRetainedNativeSupervisorModuleAuthorizationRootRecord,
  type RetainedNativeSupervisorModuleAuthorizationRootRecord,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';

import type { RetainedNativeModuleAuthorizationTrustSqlClient } from './retained-native-module-authorization-trust-state';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const AUTHORIZATION_LIFETIME_MS = 60_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface RetainedNativeModuleAuthorizationRootProvisioningRequest {
  readonly schemaVersion: 1;
  readonly purpose: 'RETAINED_NATIVE_MODULE_AUTHORIZATION_PUBLIC_ROOT_PROVISIONING';
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly root: Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord>;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

interface RootRow extends RetainedNativeSupervisorModuleAuthorizationRootRecord {}

interface ProvisionedRootRow extends RootRow {
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly provisioningRequestHash: string;
  readonly provisioningAuthorizationId: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: number;
  readonly authorizedFrom: Date;
  readonly authorizedUntil: Date;
}

export class RetainedNativeModuleAuthorizationRootRegistryDeniedError extends Error {}

function deny(message: string): never {
  throw new RetainedNativeModuleAuthorizationRootRegistryDeniedError(message);
}

function reference(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value))
    return deny(`${field} must be a safe non-sensitive reference`);
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function exactRequest(
  input: unknown,
): Readonly<RetainedNativeModuleAuthorizationRootProvisioningRequest> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return deny('Root provisioning request is invalid');
  const value = input as Record<string, unknown>;
  const expected = [
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
    value.purpose !== 'RETAINED_NATIVE_MODULE_AUTHORIZATION_PUBLIC_ROOT_PROVISIONING' ||
    value.runtimeConnection !== 'NOT_CONFIGURED'
  )
    return deny('Root provisioning request shape is invalid');
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_MODULE_AUTHORIZATION_PUBLIC_ROOT_PROVISIONING',
    workspaceId: reference(value.workspaceId, 'workspaceId'),
    supervisorInstanceId: reference(value.supervisorInstanceId, 'supervisorInstanceId'),
    root: validateRetainedNativeSupervisorModuleAuthorizationRootRecord(value.root),
    runtimeConnection: 'NOT_CONFIGURED',
  });
}

function rootFromRow(
  row: RootRow,
): Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord> {
  return validateRetainedNativeSupervisorModuleAuthorizationRootRecord({
    schemaVersion: row.schemaVersion,
    rootRecordId: row.rootRecordId,
    rootRecordVersion: row.rootRecordVersion,
    signerKeyId: row.signerKeyId,
    algorithm: row.algorithm,
    purpose: row.purpose,
    publicKeySpkiBase64: row.publicKeySpkiBase64,
    publicKeySpkiSha256: row.publicKeySpkiSha256,
    minimumSnapshotVersion: row.minimumSnapshotVersion,
    validFrom: new Date(row.validFrom).toISOString(),
    validUntil: new Date(row.validUntil).toISOString(),
    revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt).toISOString(),
    testOnly: row.testOnly,
  });
}

/**
 * Durable public-only root registry. Provisioning requires an exact trusted
 * control-plane Level-3 capability and records immutable evidence atomically.
 * It has no private-key, signing, transport, or runtime activation capability.
 */
export class PostgresRetainedNativeModuleAuthorizationRootRegistry {
  constructor(private readonly database: RetainedNativeModuleAuthorizationTrustSqlClient) {
    Object.freeze(this);
  }

  async read(
    workspaceId: string,
    supervisorInstanceId: string,
  ): Promise<readonly Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord>[]> {
    const workspace = reference(workspaceId, 'workspaceId');
    const supervisor = reference(supervisorInstanceId, 'supervisorInstanceId');
    const rows = await this.database.$queryRaw<readonly RootRow[]>(Prisma.sql`
      SELECT 1 AS "schemaVersion", "rootRecordId", "rootRecordVersion", "signerKeyId",
        "algorithm", "purpose", "publicKeySpkiBase64", "publicKeySpkiSha256",
        "minimumSnapshotVersion", "validFrom", "validUntil", "revokedAt", false AS "testOnly"
      FROM (
        SELECT DISTINCT ON ("rootRecordId") *
        FROM "acp_retained_native_module_authorization_roots"
        WHERE "workspaceId" = CAST(${workspace} AS UUID)
          AND "supervisorInstanceId" = ${supervisor}
        ORDER BY "rootRecordId", "rootRecordVersion" DESC
      ) current_roots
      WHERE "validUntil" > clock_timestamp()
        AND ("revokedAt" IS NULL OR "revokedAt" > clock_timestamp())
      ORDER BY "rootRecordId"
      LIMIT 9
    `);
    if (!Array.isArray(rows) || rows.length > 8) return deny('Active root set exceeds bound');
    return Object.freeze(rows.map(rootFromRow));
  }

  async provision(
    input: unknown,
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    clock: () => number = Date.now,
  ): Promise<'APPENDED' | 'REPLAYED'> {
    const request = exactRequest(input);
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
    const now = clock();
    if (
      !Number.isFinite(now) ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now > MAX_DATE_MS - AUTHORIZATION_LIFETIME_MS
    )
      return deny('Root provisioning clock is invalid');

    const authorizedFrom = new Date(now).toISOString();
    const authorizedUntil = new Date(now + AUTHORIZATION_LIFETIME_MS).toISOString();
    const provisioningRequestHash = digest(request);
    const evidenceBinding = Object.freeze({
      evidencePurpose: 'RETAINED_NATIVE_MODULE_PUBLIC_ROOT_LEVEL3_AUTHORIZATION' as const,
      policyVersion: 1 as const,
      request,
      authorizedByReference: boundContext.principalId,
      actorKind,
      authorityLevel: 3 as const,
      authorizedFrom,
      authorizedUntil,
    });
    const approvalEvidenceHash = digest(evidenceBinding);
    const provisioningAuthorizationId = `native-module-root:${approvalEvidenceHash}`;
    const approvalId = `level3-control-plane:${approvalEvidenceHash}`;
    const root = request.root;
    const inserted = await this.database.$queryRaw<
      readonly { readonly applied: number }[]
    >(Prisma.sql`
      WITH inserted_scope AS (
        INSERT INTO "acp_retained_native_module_authorization_root_scopes" (
          "supervisorInstanceId", "workspaceId"
        ) VALUES (${request.supervisorInstanceId}, CAST(${request.workspaceId} AS UUID))
        -- Untargeted conflict handling is required because both the primary key and the
        -- composite foreign-key target can observe the same concurrent bootstrap.
        ON CONFLICT DO NOTHING
        RETURNING 1
      ), bound_scope AS (
        SELECT 1 FROM inserted_scope
        UNION ALL
        SELECT 1
        FROM "acp_retained_native_module_authorization_root_scopes"
        WHERE "supervisorInstanceId" = ${request.supervisorInstanceId}
          AND "workspaceId" = CAST(${request.workspaceId} AS UUID)
        LIMIT 1
      ), inserted_root AS (
        INSERT INTO "acp_retained_native_module_authorization_roots" (
          "workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion",
          "signerKeyId", "algorithm", "purpose", "publicKeySpkiBase64",
          "publicKeySpkiSha256", "minimumSnapshotVersion", "validFrom", "validUntil",
          "revokedAt", "testOnly"
        ) SELECT
          CAST(${request.workspaceId} AS UUID), ${request.supervisorInstanceId},
          ${root.rootRecordId}, ${root.rootRecordVersion}, ${root.signerKeyId}, ${root.algorithm},
          ${root.purpose}, ${root.publicKeySpkiBase64}, ${root.publicKeySpkiSha256},
          ${root.minimumSnapshotVersion}, ${new Date(root.validFrom)}, ${new Date(root.validUntil)},
          ${root.revokedAt === null ? null : new Date(root.revokedAt)}, ${root.testOnly}
        FROM bound_scope
        ON CONFLICT ("workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion")
          DO NOTHING
        RETURNING 1
      ), inserted_evidence AS (
        INSERT INTO "acp_retained_native_module_authorization_root_evidence" (
          "workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion",
          "signerKeyId", "publicKeySpkiSha256", "provisioningRequestHash",
          "provisioningAuthorizationId", "approvalId", "approvalEvidenceHash",
          "authorizedByReference", "authorityLevel", "authorizedFrom", "authorizedUntil"
        ) SELECT CAST(${request.workspaceId} AS UUID), ${request.supervisorInstanceId},
          ${root.rootRecordId}, ${root.rootRecordVersion}, ${root.signerKeyId},
          ${root.publicKeySpkiSha256}, ${provisioningRequestHash}, ${provisioningAuthorizationId},
          ${approvalId}, ${approvalEvidenceHash}, ${boundContext.principalId}, 3,
          ${new Date(authorizedFrom)}, ${new Date(authorizedUntil)}
        FROM inserted_root
        RETURNING 1
      )
      SELECT CASE WHEN EXISTS (SELECT 1 FROM inserted_evidence) THEN 1 ELSE 0 END AS "applied"
    `);
    if (
      !Array.isArray(inserted) ||
      inserted.length !== 1 ||
      ![0, 1].includes(inserted[0]?.applied ?? -1)
    )
      return deny('Root provisioning result is invalid');
    if (inserted[0]!.applied === 1) return 'APPENDED';

    const existing = await this.database.$queryRaw<readonly ProvisionedRootRow[]>(Prisma.sql`
      SELECT 1 AS "schemaVersion", r."workspaceId"::TEXT AS "workspaceId",
        r."supervisorInstanceId", r."rootRecordId", r."rootRecordVersion", r."signerKeyId",
        r."algorithm", r."purpose", r."publicKeySpkiBase64", r."publicKeySpkiSha256",
        r."minimumSnapshotVersion", r."validFrom", r."validUntil", r."revokedAt",
        r."testOnly", e."provisioningRequestHash", e."provisioningAuthorizationId",
        e."approvalId", e."approvalEvidenceHash", e."authorizedByReference",
        e."authorityLevel", e."authorizedFrom", e."authorizedUntil"
      FROM "acp_retained_native_module_authorization_roots" r
      JOIN "acp_retained_native_module_authorization_root_evidence" e
        ON e."workspaceId" = r."workspaceId"
       AND e."supervisorInstanceId" = r."supervisorInstanceId"
       AND e."rootRecordId" = r."rootRecordId"
       AND e."rootRecordVersion" = r."rootRecordVersion"
      WHERE r."workspaceId" = CAST(${request.workspaceId} AS UUID)
        AND r."supervisorInstanceId" = ${request.supervisorInstanceId}
        AND r."rootRecordId" = ${root.rootRecordId}
        AND r."rootRecordVersion" = ${root.rootRecordVersion}
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
