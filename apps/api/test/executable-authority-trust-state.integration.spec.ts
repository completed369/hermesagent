import { createHash, randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@ventureos/database';
import type { LinuxExecutableAuthorityTrustCheckpoint } from '@ventureos/agent-bridge';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresLinuxExecutableAuthorityTrustCheckpointStore,
  PostgresLinuxExecutableAuthorityTrustSnapshotReader,
} from '../src/modules/agent-control-plane/executable-authority-trust-state';

describe('durable executable authority trust state (PostgreSQL integration)', () => {
  const suffix = randomUUID();
  const signerKeyId = `root-signer-${suffix}`;
  const signature = Buffer.alloc(64, 7).toString('base64');
  const issuedAt = '2026-09-01T03:00:00.000Z';
  const validUntil = '2026-09-01T03:15:00.000Z';
  const store = new PostgresLinuxExecutableAuthorityTrustCheckpointStore(prisma);
  const reader = new PostgresLinuxExecutableAuthorityTrustSnapshotReader(prisma, signerKeyId);

  function hash(version: number): string {
    return createHash('sha256').update(`${suffix}:${version}`).digest('hex');
  }

  function snapshot(version: number, previousSnapshotHash: string | null) {
    return {
      schemaVersion: 1,
      snapshotId: `snapshot-${suffix}-${version}`,
      snapshotVersion: version,
      signerKeyId,
      algorithm: 'ED25519',
      issuedAt,
      validUntil,
      previousSnapshotHash,
      records: [
        {
          schemaVersion: 1,
          trustRecordId: `trust-record-${suffix}`,
          trustRecordVersion: 1,
          signerKeyId: `executable-signer-${suffix}`,
          algorithm: 'ED25519',
          publicKeySpkiBase64: 'MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          publicKeySpkiSha256: 'f'.repeat(64),
          adapterKind: 'CODEX_APP_SERVER_STDIO_V1',
          argumentPolicyReference: 'codex-app-server-jsonl-v1',
          authorizedWorktreeRoot: '/workspaces',
          validFrom: issuedAt,
          validUntil,
          revokedAt: null,
          testOnly: false,
        },
      ],
      signature,
    };
  }

  function checkpoint(version: number): Readonly<LinuxExecutableAuthorityTrustCheckpoint> {
    return Object.freeze({
      schemaVersion: 1,
      signerKeyId,
      snapshotId: `snapshot-${suffix}-${version}`,
      snapshotVersion: version,
      snapshotHash: hash(version),
    });
  }

  async function insertSnapshot(version: number, previousSnapshotHash: string | null) {
    const body = snapshot(version, previousSnapshotHash);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "acp_executable_authority_trust_snapshots" (
        "signerKeyId", "snapshotVersion", "snapshotId", "snapshotHash",
        "previousSnapshotHash", "snapshot", "issuedAt", "validUntil"
      ) VALUES (
        ${signerKeyId}, ${version}, ${body.snapshotId}, ${hash(version)},
        ${previousSnapshotHash}, CAST(${JSON.stringify(body)} AS JSONB),
        ${new Date(issuedAt)}, ${new Date(validUntil)}
      )
    `);
  }

  beforeAll(async () => {
    await insertSnapshot(1, null);
    await insertSnapshot(2, hash(1));
    await insertSnapshot(3, hash(2));
  });

  it('reads the highest stored signer version without falling back', async () => {
    await expect(reader.read()).resolves.toMatchObject({
      snapshotId: `snapshot-${suffix}-3`,
      snapshotVersion: 3,
      signerKeyId,
      previousSnapshotHash: hash(2),
    });
  });

  it('atomically bootstraps, advances exactly, and appends audit evidence', async () => {
    await expect(store.read(signerKeyId)).resolves.toBeNull();
    await expect(store.compareAndSwap(signerKeyId, null, checkpoint(1))).resolves.toBe(true);
    await expect(store.compareAndSwap(signerKeyId, null, checkpoint(1))).resolves.toBe(false);
    await expect(store.compareAndSwap(signerKeyId, checkpoint(1), checkpoint(2))).resolves.toBe(
      true,
    );

    await expect(store.read(signerKeyId)).resolves.toEqual(checkpoint(2));
    const events = await prisma.$queryRaw<
      readonly {
        previousSnapshotVersion: number | null;
        nextSnapshotVersion: number;
      }[]
    >(Prisma.sql`
      SELECT "previousSnapshotVersion", "nextSnapshotVersion"
      FROM "acp_executable_authority_trust_checkpoint_events"
      WHERE "signerKeyId" = ${signerKeyId}
      ORDER BY "createdAt", "nextSnapshotVersion"
    `);
    expect(events).toEqual([
      { previousSnapshotVersion: null, nextSnapshotVersion: 1 },
      { previousSnapshotVersion: 1, nextSnapshotVersion: 2 },
    ]);
  });

  it('allows exactly one winner for concurrent expected-value advancement', async () => {
    const results = await Promise.all([
      store.compareAndSwap(signerKeyId, checkpoint(2), checkpoint(3)),
      store.compareAndSwap(signerKeyId, checkpoint(2), checkpoint(3)),
    ]);
    expect(results.sort()).toEqual([false, true]);
    await expect(store.read(signerKeyId)).resolves.toEqual(checkpoint(3));

    const [{ count }] = await prisma.$queryRaw<readonly { count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::BIGINT AS "count"
      FROM "acp_executable_authority_trust_checkpoint_events"
      WHERE "signerKeyId" = ${signerKeyId}
    `);
    expect(count).toBe(3n);
  });

  it('enforces immutable snapshots, monotonic checkpoints, immutable audit, and exact JSON shape', async () => {
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_executable_authority_trust_snapshots"
        SET "snapshotHash" = ${'a'.repeat(64)}
        WHERE "signerKeyId" = ${signerKeyId} AND "snapshotVersion" = 1
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_executable_authority_trust_checkpoints"
        SET "snapshotVersion" = 1
        WHERE "signerKeyId" = ${signerKeyId}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_executable_authority_trust_checkpoint_events"
        WHERE "signerKeyId" = ${signerKeyId}
      `),
    ).rejects.toThrow();

    const invalid = { ...snapshot(4, hash(3)), extra: true };
    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "acp_executable_authority_trust_snapshots" (
          "signerKeyId", "snapshotVersion", "snapshotId", "snapshotHash",
          "previousSnapshotHash", "snapshot", "issuedAt", "validUntil"
        ) VALUES (
          ${signerKeyId}, 4, ${invalid.snapshotId}, ${hash(4)}, ${hash(3)},
          CAST(${JSON.stringify(invalid)} AS JSONB), ${new Date(issuedAt)}, ${new Date(validUntil)}
        )
      `),
    ).rejects.toThrow();
  });
});
