import { Prisma } from '@ventureos/database';
import type {
  LinuxExecutableAuthorityTrustCheckpoint,
  LinuxExecutableAuthorityTrustCheckpointStore,
  LinuxExecutableAuthorityTrustSnapshotReader,
} from '@ventureos/agent-bridge';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface ExecutableAuthorityTrustSqlClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

interface SnapshotRow {
  readonly snapshot: unknown;
}

interface CheckpointRow {
  readonly schemaVersion: number;
  readonly signerKeyId: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
}

function deny(): never {
  throw new Error('Executable authority trust state denied');
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || PRIVATE_TEXT.test(value)) deny();
  return value;
}

function exactCheckpoint(input: unknown): Readonly<LinuxExecutableAuthorityTrustCheckpoint> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deny();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const record = input as Record<string, unknown>;
  const expected = [
    'schemaVersion',
    'signerKeyId',
    'snapshotHash',
    'snapshotId',
    'snapshotVersion',
  ].sort();
  const actual = Object.keys(record).sort();
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (
    actual.length !== expected.length ||
    Reflect.ownKeys(record).length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    actual.some((key) => !Object.hasOwn(descriptors[key] ?? {}, 'value')) ||
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.snapshotVersion) ||
    (record.snapshotVersion as number) < 1 ||
    (record.snapshotVersion as number) > 1_000_000 ||
    typeof record.snapshotHash !== 'string' ||
    !SHA256.test(record.snapshotHash)
  )
    deny();
  return Object.freeze({
    schemaVersion: 1,
    signerKeyId: reference(record.signerKeyId),
    snapshotId: reference(record.snapshotId),
    snapshotVersion: record.snapshotVersion as number,
    snapshotHash: record.snapshotHash,
  });
}

function checkpointFromRow(row: CheckpointRow): Readonly<LinuxExecutableAuthorityTrustCheckpoint> {
  return exactCheckpoint({
    schemaVersion: row.schemaVersion,
    signerKeyId: row.signerKeyId,
    snapshotId: row.snapshotId,
    snapshotVersion: row.snapshotVersion,
    snapshotHash: row.snapshotHash,
  });
}

/**
 * Reads only the highest persisted version for one explicitly bound signer.
 * Invalid or future highest rows are not skipped; the cryptographic source
 * must reject them rather than falling back to older trust.
 */
export class PostgresLinuxExecutableAuthorityTrustSnapshotReader implements LinuxExecutableAuthorityTrustSnapshotReader {
  readonly #signerKeyId: string;

  constructor(
    private readonly database: ExecutableAuthorityTrustSqlClient,
    signerKeyId: string,
  ) {
    this.#signerKeyId = reference(signerKeyId);
    Object.freeze(this);
  }

  async read(): Promise<unknown> {
    const rows = await this.database.$queryRaw<readonly SnapshotRow[]>(Prisma.sql`
      SELECT "snapshot"
      FROM "acp_executable_authority_trust_snapshots"
      WHERE "signerKeyId" = ${this.#signerKeyId}
      ORDER BY "snapshotVersion" DESC
      LIMIT 1
    `);
    if (!Array.isArray(rows) || rows.length !== 1 || !Object.hasOwn(rows[0] ?? {}, 'snapshot'))
      deny();
    return structuredClone(rows[0]!.snapshot);
  }
}

/**
 * PostgreSQL-backed signer-scoped CAS. The database owns the exact +1 guard,
 * snapshot foreign-key binding, and append-only audit event trigger; this
 * adapter additionally rejects malformed or non-monotonic calls before SQL.
 */
export class PostgresLinuxExecutableAuthorityTrustCheckpointStore implements LinuxExecutableAuthorityTrustCheckpointStore {
  constructor(private readonly database: ExecutableAuthorityTrustSqlClient) {
    Object.freeze(this);
  }

  async read(signerKeyId: string): Promise<unknown | null> {
    const signer = reference(signerKeyId);
    const rows = await this.database.$queryRaw<readonly CheckpointRow[]>(Prisma.sql`
      SELECT
        1 AS "schemaVersion",
        "signerKeyId", "snapshotId", "snapshotVersion", "snapshotHash"
      FROM "acp_executable_authority_trust_checkpoints"
      WHERE "signerKeyId" = ${signer}
      LIMIT 2
    `);
    if (!Array.isArray(rows) || rows.length > 1) deny();
    return rows.length === 0 ? null : checkpointFromRow(rows[0]!);
  }

  async compareAndSwap(
    signerKeyId: string,
    expected: Readonly<LinuxExecutableAuthorityTrustCheckpoint> | null,
    next: Readonly<LinuxExecutableAuthorityTrustCheckpoint>,
  ): Promise<boolean> {
    const signer = reference(signerKeyId);
    const nextCheckpoint = exactCheckpoint(next);
    if (nextCheckpoint.signerKeyId !== signer) deny();

    let rows: readonly { readonly applied: number }[];
    if (expected === null) {
      rows = await this.database.$queryRaw(Prisma.sql`
        INSERT INTO "acp_executable_authority_trust_checkpoints" (
          "signerKeyId", "snapshotId", "snapshotVersion", "snapshotHash"
        ) VALUES (
          ${signer}, ${nextCheckpoint.snapshotId},
          ${nextCheckpoint.snapshotVersion}, ${nextCheckpoint.snapshotHash}
        )
        ON CONFLICT ("signerKeyId") DO NOTHING
        RETURNING 1 AS "applied"
      `);
    } else {
      const expectedCheckpoint = exactCheckpoint(expected);
      if (
        expectedCheckpoint.signerKeyId !== signer ||
        nextCheckpoint.snapshotVersion !== expectedCheckpoint.snapshotVersion + 1 ||
        nextCheckpoint.snapshotId === expectedCheckpoint.snapshotId ||
        nextCheckpoint.snapshotHash === expectedCheckpoint.snapshotHash
      )
        deny();
      rows = await this.database.$queryRaw(Prisma.sql`
        UPDATE "acp_executable_authority_trust_checkpoints"
        SET
          "snapshotId" = ${nextCheckpoint.snapshotId},
          "snapshotVersion" = ${nextCheckpoint.snapshotVersion},
          "snapshotHash" = ${nextCheckpoint.snapshotHash},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "signerKeyId" = ${signer}
          AND "snapshotId" = ${expectedCheckpoint.snapshotId}
          AND "snapshotVersion" = ${expectedCheckpoint.snapshotVersion}
          AND "snapshotHash" = ${expectedCheckpoint.snapshotHash}
        RETURNING 1 AS "applied"
      `);
    }
    if (!Array.isArray(rows) || rows.length > 1) deny();
    return rows.length === 1 && rows[0]?.applied === 1;
  }
}
