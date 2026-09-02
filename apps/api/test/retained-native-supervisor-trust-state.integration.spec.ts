import { createHash, randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@ventureos/database';
import type { RetainedNativeSupervisorTrustCheckpoint } from '@ventureos/agent-bridge';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresRetainedNativeSupervisorTrustCheckpointStore,
  PostgresRetainedNativeSupervisorTrustSnapshotReader,
} from '../src/modules/agent-control-plane/retained-native-supervisor-trust-state';

describe('durable retained-native supervisor trust state (PostgreSQL integration)', () => {
  const suffix = randomUUID();
  const supervisorInstanceId = `native-supervisor-${suffix}`;
  const signature = Buffer.alloc(64, 9).toString('base64');
  const issuedAt = '2026-09-02T03:00:00.000Z';
  const validUntil = '2026-09-02T03:15:00.000Z';
  const store = new PostgresRetainedNativeSupervisorTrustCheckpointStore(prisma);
  const reader = new PostgresRetainedNativeSupervisorTrustSnapshotReader(
    prisma,
    supervisorInstanceId,
  );

  function hash(version: number): string {
    return createHash('sha256').update(`${suffix}:${version}`).digest('hex');
  }

  function activeRecord(version: number) {
    return {
      schemaVersion: 1,
      trustRecordId: `native-trust-${suffix}-${version}`,
      trustRecordVersion: 1,
      supervisorInstanceId,
      supervisorKeyId: `native-key-${suffix}-${version}`,
      algorithm: 'ED25519',
      purpose: 'RETAINED_NATIVE_RECOVERY_OBSERVATION',
      publicKeySpkiBase64: 'MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      publicKeySpkiSha256: String(version).repeat(64),
      validFrom: issuedAt,
      validUntil,
      revokedAt: null,
      testOnly: false,
    };
  }

  function snapshot(version: number, previousSnapshotHash: string | null) {
    return {
      schemaVersion: 1,
      snapshotId: `native-snapshot-${suffix}-${version}`,
      snapshotVersion: version,
      signerKeyId: version === 1 ? `root-signer-${suffix}-1` : `root-signer-${suffix}-2`,
      algorithm: 'ED25519',
      supervisorInstanceId,
      issuedAt,
      validUntil,
      previousSnapshotHash,
      record: version === 3 ? null : activeRecord(version),
      signature,
    };
  }

  function checkpoint(version: number): Readonly<RetainedNativeSupervisorTrustCheckpoint> {
    const body = snapshot(version, version === 1 ? null : hash(version - 1));
    return Object.freeze({
      schemaVersion: 1,
      supervisorInstanceId,
      signerKeyId: body.signerKeyId,
      snapshotId: body.snapshotId,
      snapshotVersion: version,
      snapshotHash: hash(version),
      activeSupervisorKeyId: body.record?.supervisorKeyId ?? null,
      activePublicKeySpkiSha256: body.record?.publicKeySpkiSha256 ?? null,
      activeTrustRecordId: body.record?.trustRecordId ?? null,
      activeTrustRecordVersion: body.record?.trustRecordVersion ?? null,
    });
  }

  async function insertSnapshot(version: number) {
    const previousSnapshotHash = version === 1 ? null : hash(version - 1);
    const body = snapshot(version, previousSnapshotHash);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "acp_retained_native_supervisor_trust_snapshots" (
        "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash",
        "signerKeyId", "previousSnapshotHash", "snapshot", "issuedAt", "validUntil"
      ) VALUES (
        ${supervisorInstanceId}, ${version}, ${body.snapshotId}, ${hash(version)},
        ${body.signerKeyId}, ${previousSnapshotHash}, CAST(${JSON.stringify(body)} AS JSONB),
        ${new Date(issuedAt)}, ${new Date(validUntil)}
      )
    `);
  }

  beforeAll(async () => {
    for (let version = 1; version <= 4; version += 1) await insertSnapshot(version);
  });

  it('reads only the highest supervisor-instance snapshot without fallback', async () => {
    await expect(reader.read()).resolves.toMatchObject({
      supervisorInstanceId,
      snapshotVersion: 4,
      previousSnapshotHash: hash(3),
    });
  });

  it('atomically bootstraps, rotates root/key, revokes, and appends audit evidence', async () => {
    await expect(store.read(supervisorInstanceId)).resolves.toBeNull();
    await expect(store.compareAndSwap(supervisorInstanceId, null, checkpoint(1))).resolves.toBe(
      true,
    );
    await expect(store.compareAndSwap(supervisorInstanceId, null, checkpoint(1))).resolves.toBe(
      false,
    );
    await expect(
      store.compareAndSwap(supervisorInstanceId, checkpoint(1), checkpoint(2)),
    ).resolves.toBe(true);
    await expect(
      store.compareAndSwap(supervisorInstanceId, checkpoint(2), checkpoint(3)),
    ).resolves.toBe(true);
    await expect(store.read(supervisorInstanceId)).resolves.toEqual(checkpoint(3));

    const events = await prisma.$queryRaw<
      readonly {
        previousSnapshotVersion: number | null;
        nextSnapshotVersion: number;
        nextActiveSupervisorKeyId: string | null;
      }[]
    >(Prisma.sql`
      SELECT "previousSnapshotVersion", "nextSnapshotVersion", "nextActiveSupervisorKeyId"
      FROM "acp_retained_native_supervisor_trust_checkpoint_events"
      WHERE "supervisorInstanceId" = ${supervisorInstanceId}
      ORDER BY "createdAt", "nextSnapshotVersion"
    `);
    expect(events).toEqual([
      {
        previousSnapshotVersion: null,
        nextSnapshotVersion: 1,
        nextActiveSupervisorKeyId: activeRecord(1).supervisorKeyId,
      },
      {
        previousSnapshotVersion: 1,
        nextSnapshotVersion: 2,
        nextActiveSupervisorKeyId: activeRecord(2).supervisorKeyId,
      },
      {
        previousSnapshotVersion: 2,
        nextSnapshotVersion: 3,
        nextActiveSupervisorKeyId: null,
      },
    ]);
  });

  it('allows exactly one winner for concurrent full expected-value advancement', async () => {
    const results = await Promise.all([
      store.compareAndSwap(supervisorInstanceId, checkpoint(3), checkpoint(4)),
      store.compareAndSwap(supervisorInstanceId, checkpoint(3), checkpoint(4)),
    ]);
    expect(results.sort()).toEqual([false, true]);
    await expect(store.read(supervisorInstanceId)).resolves.toEqual(checkpoint(4));
  });

  it('enforces immutable snapshots, monotonic checkpoints, immutable audit, and exact shape', async () => {
    await insertSnapshot(5);
    const fifth = checkpoint(5);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_retained_native_supervisor_trust_checkpoints"
        SET "signerKeyId" = ${fifth.signerKeyId}, "snapshotId" = ${fifth.snapshotId},
          "snapshotVersion" = ${fifth.snapshotVersion}, "snapshotHash" = ${fifth.snapshotHash},
          "activeSupervisorKeyId" = ${'wrong-native-key'},
          "activePublicKeySpkiSha256" = ${fifth.activePublicKeySpkiSha256},
          "activeTrustRecordId" = ${fifth.activeTrustRecordId},
          "activeTrustRecordVersion" = ${fifth.activeTrustRecordVersion}
        WHERE "supervisorInstanceId" = ${supervisorInstanceId}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_retained_native_supervisor_trust_snapshots"
        SET "snapshotHash" = ${'f'.repeat(64)}
        WHERE "supervisorInstanceId" = ${supervisorInstanceId} AND "snapshotVersion" = 1
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_retained_native_supervisor_trust_checkpoints"
        SET "snapshotVersion" = 1
        WHERE "supervisorInstanceId" = ${supervisorInstanceId}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_retained_native_supervisor_trust_checkpoint_events"
        WHERE "supervisorInstanceId" = ${supervisorInstanceId}
      `),
    ).rejects.toThrow();

    const invalid = { ...snapshot(6, hash(5)), extra: true };
    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "acp_retained_native_supervisor_trust_snapshots" (
          "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash",
          "signerKeyId", "previousSnapshotHash", "snapshot", "issuedAt", "validUntil"
        ) VALUES (
          ${supervisorInstanceId}, 6, ${invalid.snapshotId}, ${hash(6)}, ${invalid.signerKeyId},
          ${hash(5)}, CAST(${JSON.stringify(invalid)} AS JSONB),
          ${new Date(issuedAt)}, ${new Date(validUntil)}
        )
      `),
    ).rejects.toThrow();
  });
});
