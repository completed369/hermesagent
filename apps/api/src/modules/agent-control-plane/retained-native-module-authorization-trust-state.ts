import { Prisma } from '@ventureos/database';
import {
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication,
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  canonicalJson,
} from '@ventureos/agent-bridge';
import type {
  RetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore,
  RetainedNativeSupervisorModuleAuthorizationCheckpoint,
  RetainedNativeSupervisorModuleAuthorizationCheckpointStore,
  RetainedNativeSupervisorModuleAuthorizationSnapshotReader,
  RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore,
} from '@ventureos/agent-bridge';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface RetainedNativeModuleAuthorizationTrustSqlClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

interface SnapshotRow {
  readonly snapshot: unknown;
}

interface PublishedSnapshotRow extends SnapshotRow {
  readonly snapshotHash: string;
}

interface AuditedPublishedSnapshotRow extends PublishedSnapshotRow {
  readonly workspaceId: string;
  readonly supervisorInstanceId: string;
  readonly snapshotVersion: number;
  readonly snapshotId: string;
  readonly signerKeyId: string;
  readonly issuanceRequestHash: string;
  readonly issuanceAuthorizationId: string;
  readonly authorityRequestHash: string;
  readonly approvalId: string;
  readonly approvalEvidenceHash: string;
  readonly authorizedByReference: string;
  readonly authorityLevel: number;
  readonly authorizedFrom: Date;
  readonly authorizedUntil: Date;
}

interface CheckpointRow {
  readonly schemaVersion: number;
  readonly supervisorInstanceId: string;
  readonly signerKeyId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
  readonly clientAuthorizationId: string | null;
  readonly clientAuthorizationVersion: number | null;
  readonly clientAuthorizationHash: string | null;
  readonly listenerAuthorizationId: string | null;
  readonly listenerAuthorizationVersion: number | null;
  readonly listenerAuthorizationHash: string | null;
}

function deny(): never {
  throw new Error('Retained-native module authorization trust state denied');
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value)) deny();
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000)
    deny();
  return value as number;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) deny();
  return value;
}

function optionalGrant(
  record: Record<string, unknown>,
  prefix: 'client' | 'listener',
): Readonly<{ id: string | null; version: number | null; hash: string | null }> {
  const id = record[`${prefix}AuthorizationId`];
  const version = record[`${prefix}AuthorizationVersion`];
  const hash = record[`${prefix}AuthorizationHash`];
  const active = id !== null;
  if (active !== (version !== null) || active !== (hash !== null)) deny();
  return Object.freeze({
    id: active ? reference(id) : null,
    version: active ? positiveInteger(version) : null,
    hash: active ? digest(hash) : null,
  });
}

function exactCheckpoint(
  input: unknown,
): Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const record = input as Record<string, unknown>;
  const expected = [
    'clientAuthorizationHash',
    'clientAuthorizationId',
    'clientAuthorizationVersion',
    'listenerAuthorizationHash',
    'listenerAuthorizationId',
    'listenerAuthorizationVersion',
    'schemaVersion',
    'signerKeyId',
    'snapshotHash',
    'snapshotId',
    'snapshotVersion',
    'supervisorInstanceId',
  ].sort();
  const actual = Object.keys(record).sort();
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (
    actual.length !== expected.length ||
    Reflect.ownKeys(record).length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value')) ||
    record.schemaVersion !== 1
  )
    deny();
  const client = optionalGrant(record, 'client');
  const listener = optionalGrant(record, 'listener');
  return Object.freeze({
    schemaVersion: 1,
    supervisorInstanceId: reference(record.supervisorInstanceId),
    signerKeyId: reference(record.signerKeyId),
    snapshotId: reference(record.snapshotId),
    snapshotVersion: positiveInteger(record.snapshotVersion),
    snapshotHash: digest(record.snapshotHash),
    clientAuthorizationId: client.id,
    clientAuthorizationVersion: client.version,
    clientAuthorizationHash: client.hash,
    listenerAuthorizationId: listener.id,
    listenerAuthorizationVersion: listener.version,
    listenerAuthorizationHash: listener.hash,
  });
}

export class PostgresRetainedNativeModuleAuthorizationSnapshotReader implements RetainedNativeSupervisorModuleAuthorizationSnapshotReader {
  readonly #supervisorInstanceId: string;

  constructor(
    private readonly database: RetainedNativeModuleAuthorizationTrustSqlClient,
    supervisorInstanceId: string,
  ) {
    this.#supervisorInstanceId = reference(supervisorInstanceId);
    Object.freeze(this);
  }

  async read(): Promise<unknown> {
    const rows = await this.database.$queryRaw<readonly SnapshotRow[]>(Prisma.sql`
      SELECT "snapshot"
      FROM "acp_retained_native_module_authorization_snapshots"
      WHERE "supervisorInstanceId" = ${this.#supervisorInstanceId}
      ORDER BY "snapshotVersion" DESC
      LIMIT 1
    `);
    if (!Array.isArray(rows) || rows.length !== 1 || !Object.hasOwn(rows[0] ?? {}, 'snapshot'))
      deny();
    return structuredClone(rows[0]!.snapshot);
  }
}

export class PostgresRetainedNativeModuleAuthorizationSnapshotPublicationStore implements RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore {
  constructor(private readonly database: RetainedNativeModuleAuthorizationTrustSqlClient) {
    Object.freeze(this);
  }

  async append(
    authenticated: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  ): Promise<'APPENDED' | 'REPLAYED'> {
    AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot.assertAuthenticated(
      authenticated,
    );
    const { snapshot, snapshotHash } = authenticated;
    const rows = await this.database.$queryRaw<readonly { readonly applied: number }[]>(Prisma.sql`
      INSERT INTO "acp_retained_native_module_authorization_snapshots" (
        "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId",
        "previousSnapshotHash", "snapshot", "issuedAt", "validUntil"
      ) VALUES (
        ${snapshot.supervisorInstanceId}, ${snapshot.snapshotVersion}, ${snapshot.snapshotId},
        ${snapshotHash}, ${snapshot.signerKeyId}, ${snapshot.previousSnapshotHash},
        CAST(${JSON.stringify(snapshot)} AS JSONB), ${new Date(snapshot.issuedAt)},
        ${new Date(snapshot.validUntil)}
      ) ON CONFLICT ("supervisorInstanceId", "snapshotVersion") DO NOTHING
      RETURNING 1 AS "applied"
    `);
    if (!Array.isArray(rows) || rows.length > 1 || (rows.length === 1 && rows[0]?.applied !== 1))
      deny();
    if (rows.length === 1) return 'APPENDED';

    // A conflicting concurrent insert can be invisible to the INSERT statement's snapshot after
    // it waits on the unique index. Re-read in a new statement before calling the outcome a replay.
    const existing = await this.database.$queryRaw<readonly PublishedSnapshotRow[]>(Prisma.sql`
      SELECT "snapshotHash", "snapshot"
      FROM "acp_retained_native_module_authorization_snapshots"
      WHERE "supervisorInstanceId" = ${snapshot.supervisorInstanceId}
        AND "snapshotVersion" = ${snapshot.snapshotVersion}
      LIMIT 2
    `);
    if (
      !Array.isArray(existing) ||
      existing.length !== 1 ||
      existing[0]?.snapshotHash !== snapshotHash ||
      canonicalJson(existing[0]?.snapshot) !== canonicalJson(snapshot)
    )
      deny();
    return 'REPLAYED';
  }
}

/** Atomically persists an authenticated snapshot and its controller-minted approval evidence. */
export class PostgresRetainedNativeModuleAuthorizationAuditedPublicationStore implements RetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore {
  constructor(private readonly database: RetainedNativeModuleAuthorizationTrustSqlClient) {
    Object.freeze(this);
  }

  async append(
    publication: AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication,
  ): Promise<'APPENDED' | 'REPLAYED'> {
    AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication.assertAuthenticated(
      publication,
    );
    const { snapshot, snapshotHash } = publication.snapshot;
    const evidence = publication.issuance;
    const rows = await this.database.$queryRaw<readonly { readonly applied: number }[]>(Prisma.sql`
      WITH inserted_snapshot AS (
        INSERT INTO "acp_retained_native_module_authorization_snapshots" (
          "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId",
          "previousSnapshotHash", "snapshot", "issuedAt", "validUntil"
        ) VALUES (
          ${snapshot.supervisorInstanceId}, ${snapshot.snapshotVersion}, ${snapshot.snapshotId},
          ${snapshotHash}, ${snapshot.signerKeyId}, ${snapshot.previousSnapshotHash},
          CAST(${JSON.stringify(snapshot)} AS JSONB), ${new Date(snapshot.issuedAt)},
          ${new Date(snapshot.validUntil)}
        ) ON CONFLICT ("supervisorInstanceId", "snapshotVersion") DO NOTHING
        RETURNING 1
      ), inserted_evidence AS (
        INSERT INTO "acp_retained_native_module_authorization_issuance_evidence" (
          "workspaceId", "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash",
          "signerKeyId", "issuanceRequestHash", "issuanceAuthorizationId",
          "authorityRequestHash", "approvalId", "approvalEvidenceHash", "authorizedByReference",
          "authorityLevel", "authorizedFrom", "authorizedUntil"
        ) SELECT
          CAST(${evidence.workspaceId} AS UUID), ${evidence.supervisorInstanceId},
          ${evidence.snapshotVersion}, ${evidence.snapshotId}, ${evidence.snapshotHash},
          ${evidence.signerKeyId}, ${evidence.issuanceRequestHash},
          ${evidence.issuanceAuthorizationId}, ${evidence.authorityRequestHash},
          ${evidence.approvalId}, ${evidence.approvalEvidenceHash},
          ${evidence.authorizedByReference}, ${evidence.authorityLevel},
          ${new Date(evidence.authorizedFrom)}, ${new Date(evidence.authorizedUntil)}
        FROM inserted_snapshot
        RETURNING 1
      )
      SELECT CASE WHEN EXISTS (SELECT 1 FROM inserted_evidence) THEN 1 ELSE 0 END AS "applied"
    `);
    if (!Array.isArray(rows) || rows.length !== 1 || ![0, 1].includes(rows[0]?.applied ?? -1))
      deny();
    if (rows[0]!.applied === 1) return 'APPENDED';

    // Re-read after a conflicting insert becomes visible. Both the signed snapshot and every
    // approval-bound audit field must be identical before returning replay.
    const existing = await this.database.$queryRaw<readonly AuditedPublishedSnapshotRow[]>(
      Prisma.sql`
        SELECT s."snapshotHash", s."snapshot", e."workspaceId"::TEXT AS "workspaceId",
          e."supervisorInstanceId", e."snapshotVersion", e."snapshotId", e."signerKeyId",
          e."issuanceRequestHash", e."issuanceAuthorizationId", e."authorityRequestHash",
          e."approvalId", e."approvalEvidenceHash", e."authorizedByReference",
          e."authorityLevel", e."authorizedFrom", e."authorizedUntil"
        FROM "acp_retained_native_module_authorization_snapshots" s
        JOIN "acp_retained_native_module_authorization_issuance_evidence" e
          ON e."supervisorInstanceId" = s."supervisorInstanceId"
         AND e."snapshotVersion" = s."snapshotVersion"
        WHERE s."supervisorInstanceId" = ${snapshot.supervisorInstanceId}
          AND s."snapshotVersion" = ${snapshot.snapshotVersion}
        LIMIT 2
      `,
    );
    const current = existing[0];
    if (
      !Array.isArray(existing) ||
      existing.length !== 1 ||
      current?.snapshotHash !== snapshotHash ||
      canonicalJson(current.snapshot) !== canonicalJson(snapshot) ||
      current.workspaceId !== evidence.workspaceId ||
      current.supervisorInstanceId !== evidence.supervisorInstanceId ||
      current.snapshotVersion !== evidence.snapshotVersion ||
      current.snapshotId !== evidence.snapshotId ||
      current.signerKeyId !== evidence.signerKeyId ||
      current.issuanceRequestHash !== evidence.issuanceRequestHash ||
      current.issuanceAuthorizationId !== evidence.issuanceAuthorizationId ||
      current.authorityRequestHash !== evidence.authorityRequestHash ||
      current.approvalId !== evidence.approvalId ||
      current.approvalEvidenceHash !== evidence.approvalEvidenceHash ||
      current.authorizedByReference !== evidence.authorizedByReference ||
      current.authorityLevel !== evidence.authorityLevel ||
      !(current.authorizedFrom instanceof Date) ||
      current.authorizedFrom.toISOString() !== evidence.authorizedFrom ||
      !(current.authorizedUntil instanceof Date) ||
      current.authorizedUntil.toISOString() !== evidence.authorizedUntil
    )
      deny();
    return 'REPLAYED';
  }
}

export class PostgresRetainedNativeModuleAuthorizationCheckpointStore implements RetainedNativeSupervisorModuleAuthorizationCheckpointStore {
  constructor(private readonly database: RetainedNativeModuleAuthorizationTrustSqlClient) {
    Object.freeze(this);
  }

  async read(supervisorInstanceId: string): Promise<unknown | null> {
    const instance = reference(supervisorInstanceId);
    const rows = await this.database.$queryRaw<readonly CheckpointRow[]>(Prisma.sql`
      SELECT 1 AS "schemaVersion", "supervisorInstanceId", "signerKeyId", "snapshotId",
        "snapshotVersion", "snapshotHash", "clientAuthorizationId",
        "clientAuthorizationVersion", "clientAuthorizationHash", "listenerAuthorizationId",
        "listenerAuthorizationVersion", "listenerAuthorizationHash"
      FROM "acp_retained_native_module_authorization_checkpoints"
      WHERE "supervisorInstanceId" = ${instance}
      LIMIT 2
    `);
    if (!Array.isArray(rows) || rows.length > 1) deny();
    return rows.length === 0 ? null : exactCheckpoint({ ...rows[0]! });
  }

  async compareAndSwap(
    supervisorInstanceId: string,
    expected: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> | null,
    next: Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint>,
  ): Promise<boolean> {
    const instance = reference(supervisorInstanceId);
    const successor = exactCheckpoint(next);
    if (successor.supervisorInstanceId !== instance) deny();
    let rows: readonly { readonly applied: number }[];
    if (expected === null) {
      rows = await this.database.$queryRaw(Prisma.sql`
        INSERT INTO "acp_retained_native_module_authorization_checkpoints" (
          "supervisorInstanceId", "signerKeyId", "snapshotId", "snapshotVersion", "snapshotHash",
          "clientAuthorizationId", "clientAuthorizationVersion", "clientAuthorizationHash",
          "listenerAuthorizationId", "listenerAuthorizationVersion", "listenerAuthorizationHash"
        ) VALUES (
          ${instance}, ${successor.signerKeyId}, ${successor.snapshotId},
          ${successor.snapshotVersion}, ${successor.snapshotHash}, ${successor.clientAuthorizationId},
          ${successor.clientAuthorizationVersion}, ${successor.clientAuthorizationHash},
          ${successor.listenerAuthorizationId}, ${successor.listenerAuthorizationVersion},
          ${successor.listenerAuthorizationHash}
        ) ON CONFLICT ("supervisorInstanceId") DO NOTHING
        RETURNING 1 AS "applied"
      `);
    } else {
      const current = exactCheckpoint(expected);
      if (
        current.supervisorInstanceId !== instance ||
        successor.snapshotVersion !== current.snapshotVersion + 1 ||
        successor.snapshotId === current.snapshotId ||
        successor.snapshotHash === current.snapshotHash ||
        (current.clientAuthorizationId !== null &&
          current.clientAuthorizationId === successor.clientAuthorizationId &&
          successor.clientAuthorizationVersion !== null &&
          current.clientAuthorizationVersion !== null &&
          (successor.clientAuthorizationVersion < current.clientAuthorizationVersion ||
            (successor.clientAuthorizationVersion === current.clientAuthorizationVersion &&
              successor.clientAuthorizationHash !== current.clientAuthorizationHash))) ||
        (current.listenerAuthorizationId !== null &&
          current.listenerAuthorizationId === successor.listenerAuthorizationId &&
          successor.listenerAuthorizationVersion !== null &&
          current.listenerAuthorizationVersion !== null &&
          (successor.listenerAuthorizationVersion < current.listenerAuthorizationVersion ||
            (successor.listenerAuthorizationVersion === current.listenerAuthorizationVersion &&
              successor.listenerAuthorizationHash !== current.listenerAuthorizationHash)))
      )
        deny();
      rows = await this.database.$queryRaw(Prisma.sql`
        UPDATE "acp_retained_native_module_authorization_checkpoints"
        SET "signerKeyId" = ${successor.signerKeyId}, "snapshotId" = ${successor.snapshotId},
          "snapshotVersion" = ${successor.snapshotVersion}, "snapshotHash" = ${successor.snapshotHash},
          "clientAuthorizationId" = ${successor.clientAuthorizationId},
          "clientAuthorizationVersion" = ${successor.clientAuthorizationVersion},
          "clientAuthorizationHash" = ${successor.clientAuthorizationHash},
          "listenerAuthorizationId" = ${successor.listenerAuthorizationId},
          "listenerAuthorizationVersion" = ${successor.listenerAuthorizationVersion},
          "listenerAuthorizationHash" = ${successor.listenerAuthorizationHash},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "supervisorInstanceId" = ${instance}
          AND "signerKeyId" = ${current.signerKeyId}
          AND "snapshotId" = ${current.snapshotId}
          AND "snapshotVersion" = ${current.snapshotVersion}
          AND "snapshotHash" = ${current.snapshotHash}
          AND "clientAuthorizationId" IS NOT DISTINCT FROM ${current.clientAuthorizationId}
          AND "clientAuthorizationVersion" IS NOT DISTINCT FROM ${current.clientAuthorizationVersion}
          AND "clientAuthorizationHash" IS NOT DISTINCT FROM ${current.clientAuthorizationHash}
          AND "listenerAuthorizationId" IS NOT DISTINCT FROM ${current.listenerAuthorizationId}
          AND "listenerAuthorizationVersion" IS NOT DISTINCT FROM ${current.listenerAuthorizationVersion}
          AND "listenerAuthorizationHash" IS NOT DISTINCT FROM ${current.listenerAuthorizationHash}
        RETURNING 1 AS "applied"
      `);
    }
    if (!Array.isArray(rows) || rows.length > 1) deny();
    return rows.length === 1 && rows[0]?.applied === 1;
  }
}
