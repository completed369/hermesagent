import { createHash, randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@ventureos/database';
import {
  canonicalJson,
  linuxRetainedNativeSupervisorModuleLoadRequestHash,
  type LinuxRetainedNativeSupervisorModuleAuthorization,
  type RetainedNativeSupervisorModuleAuthorizationCheckpoint,
} from '@ventureos/agent-bridge';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresRetainedNativeModuleAuthorizationCheckpointStore,
  PostgresRetainedNativeModuleAuthorizationSnapshotReader,
} from '../src/modules/agent-control-plane/retained-native-module-authorization-trust-state';

describe('durable retained-native module authorization trust state (PostgreSQL integration)', () => {
  const suffix = randomUUID();
  const supervisorInstanceId = `native-supervisor-${suffix}`;
  const signature = Buffer.alloc(64, 7).toString('base64');
  const issuedAt = '2030-01-01T12:00:00.000Z';
  const validUntil = '2030-01-01T12:05:00.000Z';
  const store = new PostgresRetainedNativeModuleAuthorizationCheckpointStore(prisma);
  const reader = new PostgresRetainedNativeModuleAuthorizationSnapshotReader(
    prisma,
    supervisorInstanceId,
  );

  function authorization(
    kind: 'CLIENT' | 'LISTENER',
    version: number,
  ): LinuxRetainedNativeSupervisorModuleAuthorization {
    const request = {
      schemaVersion: 1 as const,
      platform: 'LINUX' as const,
      architecture: 'X64' as const,
      moduleKind: kind,
      canonicalModulePath: `/opt/ventureos/native/${kind.toLowerCase()}.node`,
      socketPath: '/run/ventureos/supervisor/recovery.sock',
      runtimeConnection: 'NOT_CONFIGURED' as const,
    };
    return {
      ...request,
      authorizationId: `${kind.toLowerCase()}-grant-${suffix}`,
      authorizationVersion: version,
      requestHash: linuxRetainedNativeSupervisorModuleLoadRequestHash(request),
      validFrom: issuedAt,
      validUntil,
      moduleSha256: kind === 'CLIENT' ? 'a'.repeat(64) : 'b'.repeat(64),
      moduleIdentityReference: kind === 'CLIENT' ? 'linux:dev-1:ino-2' : 'linux:dev-1:ino-3',
      moduleOwnerUid: 1000,
      moduleOwnerGid: 1000,
      moduleMode: 0o555,
      moduleSizeBytes: 64_000,
      socketDirectory: '/run/ventureos/supervisor',
      socketDirectoryIdentityReference: 'linux:dev-4:ino-5',
      socketDirectoryOwnerUid: 1000,
      socketDirectoryOwnerGid: 1000,
      socketDirectoryMode: 0o700,
    };
  }

  function snapshot(version: number, previousSnapshotHash: string | null) {
    return {
      schemaVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION',
      snapshotId: `module-auth-snapshot-${suffix}-${version}`,
      snapshotVersion: version,
      signerKeyId: version === 1 ? `root-signer-${suffix}-1` : `root-signer-${suffix}-2`,
      algorithm: 'ED25519',
      supervisorInstanceId,
      issuedAt,
      validUntil,
      previousSnapshotHash,
      authorizations:
        version === 3 ? [] : [authorization('CLIENT', version), authorization('LISTENER', version)],
      signature,
    };
  }

  const hashes = new Map<number, string>();
  function snapshotHash(version: number): string {
    const cached = hashes.get(version);
    if (cached !== undefined) return cached;
    const value = createHash('sha256')
      .update(canonicalJson(snapshot(version, version === 1 ? null : snapshotHash(version - 1))))
      .digest('hex');
    hashes.set(version, value);
    return value;
  }

  function checkpoint(
    version: number,
  ): Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> {
    const body = snapshot(version, version === 1 ? null : snapshotHash(version - 1));
    const client = body.authorizations.find((value) => value.moduleKind === 'CLIENT') ?? null;
    const listener = body.authorizations.find((value) => value.moduleKind === 'LISTENER') ?? null;
    return Object.freeze({
      schemaVersion: 1,
      supervisorInstanceId,
      signerKeyId: body.signerKeyId,
      snapshotId: body.snapshotId,
      snapshotVersion: version,
      snapshotHash: snapshotHash(version),
      clientAuthorizationId: client?.authorizationId ?? null,
      clientAuthorizationVersion: client?.authorizationVersion ?? null,
      clientAuthorizationHash:
        client === null ? null : createHash('sha256').update(canonicalJson(client)).digest('hex'),
      listenerAuthorizationId: listener?.authorizationId ?? null,
      listenerAuthorizationVersion: listener?.authorizationVersion ?? null,
      listenerAuthorizationHash:
        listener === null
          ? null
          : createHash('sha256').update(canonicalJson(listener)).digest('hex'),
    });
  }

  async function insertSnapshot(version: number) {
    const previousSnapshotHash = version === 1 ? null : snapshotHash(version - 1);
    const body = snapshot(version, previousSnapshotHash);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "acp_retained_native_module_authorization_snapshots" (
        "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash", "signerKeyId",
        "previousSnapshotHash", "snapshot", "issuedAt", "validUntil"
      ) VALUES (
        ${supervisorInstanceId}, ${version}, ${body.snapshotId}, ${snapshotHash(version)},
        ${body.signerKeyId}, ${previousSnapshotHash}, CAST(${JSON.stringify(body)} AS JSONB),
        ${new Date(issuedAt)}, ${new Date(validUntil)}
      )
    `);
  }

  beforeAll(async () => {
    for (let version = 1; version <= 5; version += 1) await insertSnapshot(version);
  });

  it('reads only the highest supervisor-instance snapshot without fallback', async () => {
    await expect(reader.read()).resolves.toMatchObject({
      supervisorInstanceId,
      snapshotVersion: 5,
      previousSnapshotHash: snapshotHash(4),
    });
  });

  it('atomically bootstraps, rotates, revokes, and appends digest-only audit evidence', async () => {
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
        nextClientAuthorizationId: string | null;
      }[]
    >(Prisma.sql`
      SELECT "previousSnapshotVersion", "nextSnapshotVersion", "nextClientAuthorizationId"
      FROM "acp_retained_native_module_authorization_checkpoint_events"
      WHERE "supervisorInstanceId" = ${supervisorInstanceId}
      ORDER BY "createdAt", "nextSnapshotVersion"
    `);
    expect(events).toEqual([
      {
        previousSnapshotVersion: null,
        nextSnapshotVersion: 1,
        nextClientAuthorizationId: authorization('CLIENT', 1).authorizationId,
      },
      {
        previousSnapshotVersion: 1,
        nextSnapshotVersion: 2,
        nextClientAuthorizationId: authorization('CLIENT', 2).authorizationId,
      },
      { previousSnapshotVersion: 2, nextSnapshotVersion: 3, nextClientAuthorizationId: null },
    ]);
  });

  it('allows exactly one winner for concurrent full expected-value advancement', async () => {
    const results = await Promise.all([
      store.compareAndSwap(supervisorInstanceId, checkpoint(3), checkpoint(4)),
      store.compareAndSwap(supervisorInstanceId, checkpoint(3), checkpoint(4)),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });

  it('enforces exact grant binding, immutable snapshots, monotonic checkpoints, and immutable audit', async () => {
    const fifth = checkpoint(5);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_retained_native_module_authorization_checkpoints"
        SET "snapshotId" = ${fifth.snapshotId}, "snapshotVersion" = ${fifth.snapshotVersion},
          "snapshotHash" = ${fifth.snapshotHash}, "signerKeyId" = ${fifth.signerKeyId},
          "clientAuthorizationId" = ${'wrong-client-grant'},
          "clientAuthorizationVersion" = ${fifth.clientAuthorizationVersion},
          "clientAuthorizationHash" = ${fifth.clientAuthorizationHash},
          "listenerAuthorizationId" = ${fifth.listenerAuthorizationId},
          "listenerAuthorizationVersion" = ${fifth.listenerAuthorizationVersion},
          "listenerAuthorizationHash" = ${fifth.listenerAuthorizationHash}
        WHERE "supervisorInstanceId" = ${supervisorInstanceId}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_retained_native_module_authorization_snapshots" SET "snapshotHash" = ${'f'.repeat(64)}
        WHERE "supervisorInstanceId" = ${supervisorInstanceId} AND "snapshotVersion" = 1
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_retained_native_module_authorization_checkpoints" SET "snapshotVersion" = 1
        WHERE "supervisorInstanceId" = ${supervisorInstanceId}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_retained_native_module_authorization_checkpoint_events"
        WHERE "supervisorInstanceId" = ${supervisorInstanceId}
      `),
    ).rejects.toThrow();
  });
});
