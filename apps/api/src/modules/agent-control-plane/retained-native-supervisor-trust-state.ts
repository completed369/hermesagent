import { Prisma } from '@ventureos/database';
import type {
  RetainedNativeSupervisorTrustCheckpoint,
  RetainedNativeSupervisorTrustCheckpointStore,
  RetainedNativeSupervisorTrustSnapshotReader,
} from '@ventureos/agent-bridge';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface RetainedNativeSupervisorTrustSqlClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

interface SnapshotRow {
  readonly snapshot: unknown;
}

interface CheckpointRow {
  readonly schemaVersion: number;
  readonly supervisorInstanceId: string;
  readonly signerKeyId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
  readonly activeSupervisorKeyId: string | null;
  readonly activePublicKeySpkiSha256: string | null;
  readonly activeTrustRecordId: string | null;
  readonly activeTrustRecordVersion: number | null;
}

function deny(): never {
  throw new Error('Retained-native supervisor trust state denied');
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

function exactCheckpoint(input: unknown): Readonly<RetainedNativeSupervisorTrustCheckpoint> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const record = input as Record<string, unknown>;
  const expected = [
    'activePublicKeySpkiSha256',
    'activeSupervisorKeyId',
    'activeTrustRecordId',
    'activeTrustRecordVersion',
    'schemaVersion',
    'signerKeyId',
    'snapshotHash',
    'snapshotId',
    'snapshotVersion',
    'supervisorInstanceId',
  ].sort();
  const actual = Object.keys(record).sort();
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const active = record.activeSupervisorKeyId !== null;
  if (
    actual.length !== expected.length ||
    Reflect.ownKeys(record).length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value')) ||
    record.schemaVersion !== 1 ||
    active !== (record.activePublicKeySpkiSha256 !== null) ||
    active !== (record.activeTrustRecordId !== null) ||
    active !== (record.activeTrustRecordVersion !== null)
  )
    deny();
  return Object.freeze({
    schemaVersion: 1,
    supervisorInstanceId: reference(record.supervisorInstanceId),
    signerKeyId: reference(record.signerKeyId),
    snapshotId: reference(record.snapshotId),
    snapshotVersion: positiveInteger(record.snapshotVersion),
    snapshotHash: digest(record.snapshotHash),
    activeSupervisorKeyId: active ? reference(record.activeSupervisorKeyId) : null,
    activePublicKeySpkiSha256: active ? digest(record.activePublicKeySpkiSha256) : null,
    activeTrustRecordId: active ? reference(record.activeTrustRecordId) : null,
    activeTrustRecordVersion: active ? positiveInteger(record.activeTrustRecordVersion) : null,
  });
}

function checkpointFromRow(row: CheckpointRow): Readonly<RetainedNativeSupervisorTrustCheckpoint> {
  return exactCheckpoint({ ...row });
}

export class PostgresRetainedNativeSupervisorTrustSnapshotReader implements RetainedNativeSupervisorTrustSnapshotReader {
  readonly #supervisorInstanceId: string;

  constructor(
    private readonly database: RetainedNativeSupervisorTrustSqlClient,
    supervisorInstanceId: string,
  ) {
    this.#supervisorInstanceId = reference(supervisorInstanceId);
    Object.freeze(this);
  }

  async read(): Promise<unknown> {
    const rows = await this.database.$queryRaw<readonly SnapshotRow[]>(Prisma.sql`
      SELECT "snapshot"
      FROM "acp_retained_native_supervisor_trust_snapshots"
      WHERE "supervisorInstanceId" = ${this.#supervisorInstanceId}
      ORDER BY "snapshotVersion" DESC
      LIMIT 1
    `);
    if (!Array.isArray(rows) || rows.length !== 1 || !Object.hasOwn(rows[0] ?? {}, 'snapshot'))
      deny();
    return structuredClone(rows[0]!.snapshot);
  }
}

export class PostgresRetainedNativeSupervisorTrustCheckpointStore implements RetainedNativeSupervisorTrustCheckpointStore {
  constructor(private readonly database: RetainedNativeSupervisorTrustSqlClient) {
    Object.freeze(this);
  }

  async read(supervisorInstanceId: string): Promise<unknown | null> {
    const instance = reference(supervisorInstanceId);
    const rows = await this.database.$queryRaw<readonly CheckpointRow[]>(Prisma.sql`
      SELECT 1 AS "schemaVersion", "supervisorInstanceId", "signerKeyId",
        "snapshotId", "snapshotVersion", "snapshotHash", "activeSupervisorKeyId",
        "activePublicKeySpkiSha256", "activeTrustRecordId", "activeTrustRecordVersion"
      FROM "acp_retained_native_supervisor_trust_checkpoints"
      WHERE "supervisorInstanceId" = ${instance}
      LIMIT 2
    `);
    if (!Array.isArray(rows) || rows.length > 1) deny();
    return rows.length === 0 ? null : checkpointFromRow(rows[0]!);
  }

  async compareAndSwap(
    supervisorInstanceId: string,
    expected: Readonly<RetainedNativeSupervisorTrustCheckpoint> | null,
    next: Readonly<RetainedNativeSupervisorTrustCheckpoint>,
  ): Promise<boolean> {
    const instance = reference(supervisorInstanceId);
    const successor = exactCheckpoint(next);
    if (successor.supervisorInstanceId !== instance) deny();
    let rows: readonly { readonly applied: number }[];

    if (expected === null) {
      rows = await this.database.$queryRaw(Prisma.sql`
        INSERT INTO "acp_retained_native_supervisor_trust_checkpoints" (
          "supervisorInstanceId", "signerKeyId", "snapshotId", "snapshotVersion", "snapshotHash",
          "activeSupervisorKeyId", "activePublicKeySpkiSha256", "activeTrustRecordId",
          "activeTrustRecordVersion"
        ) VALUES (
          ${instance}, ${successor.signerKeyId}, ${successor.snapshotId},
          ${successor.snapshotVersion}, ${successor.snapshotHash}, ${successor.activeSupervisorKeyId},
          ${successor.activePublicKeySpkiSha256}, ${successor.activeTrustRecordId},
          ${successor.activeTrustRecordVersion}
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
        (current.activeSupervisorKeyId !== null &&
          current.activeSupervisorKeyId === successor.activeSupervisorKeyId &&
          current.activePublicKeySpkiSha256 !== successor.activePublicKeySpkiSha256) ||
        (current.activeTrustRecordId !== null &&
          current.activeTrustRecordId === successor.activeTrustRecordId &&
          successor.activeTrustRecordVersion !== null &&
          current.activeTrustRecordVersion !== null &&
          successor.activeTrustRecordVersion < current.activeTrustRecordVersion)
      )
        deny();
      rows = await this.database.$queryRaw(Prisma.sql`
        UPDATE "acp_retained_native_supervisor_trust_checkpoints"
        SET "signerKeyId" = ${successor.signerKeyId}, "snapshotId" = ${successor.snapshotId},
          "snapshotVersion" = ${successor.snapshotVersion}, "snapshotHash" = ${successor.snapshotHash},
          "activeSupervisorKeyId" = ${successor.activeSupervisorKeyId},
          "activePublicKeySpkiSha256" = ${successor.activePublicKeySpkiSha256},
          "activeTrustRecordId" = ${successor.activeTrustRecordId},
          "activeTrustRecordVersion" = ${successor.activeTrustRecordVersion},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "supervisorInstanceId" = ${instance}
          AND "signerKeyId" = ${current.signerKeyId}
          AND "snapshotId" = ${current.snapshotId}
          AND "snapshotVersion" = ${current.snapshotVersion}
          AND "snapshotHash" = ${current.snapshotHash}
          AND "activeSupervisorKeyId" IS NOT DISTINCT FROM ${current.activeSupervisorKeyId}
          AND "activePublicKeySpkiSha256" IS NOT DISTINCT FROM ${current.activePublicKeySpkiSha256}
          AND "activeTrustRecordId" IS NOT DISTINCT FROM ${current.activeTrustRecordId}
          AND "activeTrustRecordVersion" IS NOT DISTINCT FROM ${current.activeTrustRecordVersion}
        RETURNING 1 AS "applied"
      `);
    }
    if (!Array.isArray(rows) || rows.length > 1) deny();
    return rows.length === 1 && rows[0]?.applied === 1;
  }
}
