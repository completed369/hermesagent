import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import { Prisma, prisma } from '@ventureos/database';
import {
  BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher,
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController,
  canonicalJson,
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher,
  linuxRetainedNativeSupervisorModuleLoadRequestHash,
  retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash,
  retainedNativeSupervisorModuleAuthorizationSnapshotHash,
  type LinuxRetainedNativeSupervisorModuleAuthorization,
  type RetainedNativeSupervisorModuleAuthorizationCheckpoint,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest,
} from '@ventureos/agent-bridge';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresRetainedNativeModuleAuthorizationCheckpointStore,
  PostgresRetainedNativeModuleAuthorizationAuditedPublicationStore,
  PostgresRetainedNativeModuleAuthorizationSnapshotPublicationStore,
  PostgresRetainedNativeModuleAuthorizationSnapshotReader,
} from '../src/modules/agent-control-plane/retained-native-module-authorization-trust-state';
import { PostgresRetainedNativeModuleAuthorizationRootRegistry } from '../src/modules/agent-control-plane/retained-native-module-authorization-root-registry';

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

  it('publishes only authenticated adjacent snapshots and serializes concurrent forks', async () => {
    const publicationInstanceId = `native-publisher-${suffix}`;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    const root = {
      schemaVersion: 1 as const,
      rootRecordId: `publisher-root-record-${suffix}`,
      rootRecordVersion: 1,
      signerKeyId: `publisher-root-signer-${suffix}`,
      algorithm: 'ED25519' as const,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT' as const,
      publicKeySpkiBase64: spki.toString('base64'),
      publicKeySpkiSha256: createHash('sha256').update(spki).digest('hex'),
      minimumSnapshotVersion: 1,
      validFrom: '2029-01-01T00:00:00.000Z',
      validUntil: '2031-01-01T00:00:00.000Z',
      revokedAt: null,
      testOnly: false as const,
    };
    const signedSnapshot = (
      version: number,
      previousSnapshotHash: string | null,
      label = 'canonical',
    ) => {
      const payload = {
        schemaVersion: 1 as const,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION' as const,
        snapshotId: `published-snapshot-${suffix}-${version}-${label}`,
        snapshotVersion: version,
        signerKeyId: root.signerKeyId,
        algorithm: 'ED25519' as const,
        supervisorInstanceId: publicationInstanceId,
        issuedAt: '2030-01-01T11:59:59.000Z',
        validUntil: '2030-01-01T12:04:00.000Z',
        previousSnapshotHash,
        authorizations: [],
      };
      return {
        ...payload,
        signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
      };
    };
    const publicationStore = new PostgresRetainedNativeModuleAuthorizationSnapshotPublicationStore(
      prisma,
    );
    const publisher = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher(
      publicationInstanceId,
      [root],
      publicationStore,
      () => Date.parse('2030-01-01T12:00:00.000Z'),
    );
    const first = signedSnapshot(1, null);
    await expect(publisher.publish(first)).resolves.toBe('APPENDED');
    await expect(publisher.publish(first)).resolves.toBe('REPLAYED');

    const firstHash = retainedNativeSupervisorModuleAuthorizationSnapshotHash(first);
    const competing = [
      signedSnapshot(2, firstHash, 'fork-a'),
      signedSnapshot(2, firstHash, 'fork-b'),
    ];
    const outcomes = await Promise.allSettled(competing.map((value) => publisher.publish(value)));
    expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((value) => value.status === 'rejected')).toHaveLength(1);
    expect(outcomes.find((value) => value.status === 'fulfilled')).toMatchObject({
      value: 'APPENDED',
    });

    const winner = competing[outcomes[0]?.status === 'fulfilled' ? 0 : 1]!;
    await expect(
      publisher.publish(
        signedSnapshot(4, retainedNativeSupervisorModuleAuthorizationSnapshotHash(winner), 'gap'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(
      publisher.publish(signedSnapshot(3, 'f'.repeat(64), 'broken-link')),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });

    const rows = await prisma.$queryRaw<readonly { snapshotVersion: number }[]>(Prisma.sql`
      SELECT "snapshotVersion"
      FROM "acp_retained_native_module_authorization_snapshots"
      WHERE "supervisorInstanceId" = ${publicationInstanceId}
      ORDER BY "snapshotVersion"
    `);
    expect(rows).toEqual([{ snapshotVersion: 1 }, { snapshotVersion: 2 }]);
  });

  it('atomically publishes controller-authenticated snapshots with immutable approval audit evidence', async () => {
    const workspaceId = randomUUID();
    const publicationInstanceId = `native-audited-publisher-${suffix}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const authorizedFrom = new Date(now - 5_000).toISOString();
    const authorizedUntil = new Date(now + 4 * 60_000).toISOString();
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    const signerKeyId = `audited-publisher-root-signer-${suffix}`;
    const root = {
      schemaVersion: 1 as const,
      rootRecordId: `audited-publisher-root-record-${suffix}`,
      rootRecordVersion: 1,
      signerKeyId,
      algorithm: 'ED25519' as const,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT' as const,
      publicKeySpkiBase64: spki.toString('base64'),
      publicKeySpkiSha256: createHash('sha256').update(spki).digest('hex'),
      minimumSnapshotVersion: 1,
      validFrom: new Date(now - 60 * 60_000).toISOString(),
      validUntil: new Date(now + 60 * 60_000).toISOString(),
      revokedAt: null,
      testOnly: false as const,
    };
    const rootContext = Object.freeze({
      workspaceId,
      principalId: `control-plane-owner-${suffix}`,
    });
    const rootCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { ...rootContext, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    const rootRegistry = new PostgresRetainedNativeModuleAuthorizationRootRegistry(prisma);
    await expect(
      rootRegistry.provision(
        {
          schemaVersion: 1,
          purpose: 'RETAINED_NATIVE_MODULE_AUTHORIZATION_PUBLIC_ROOT_PROVISIONING',
          workspaceId,
          supervisorInstanceId: publicationInstanceId,
          root,
          runtimeConnection: 'NOT_CONFIGURED',
        },
        rootCapability,
        rootContext,
        () => now,
      ),
    ).resolves.toBe('APPENDED');
    const authority = {
      async authorize(
        request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest>,
      ) {
        return {
          ...request,
          issuanceAuthorizationId: `issuance-authorization-${suffix}`,
          authorityRequestHash:
            retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash(
              request,
            ),
          approvalId: `approval-${suffix}`,
          approvalEvidenceHash: 'e'.repeat(64),
          authorizedByReference: `ventureos:policy:${suffix}`,
          authorityLevel: 3,
          validFrom: authorizedFrom,
          validUntil: authorizedUntil,
        };
      },
    };
    const signer = {
      async sign(
        request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest>,
      ) {
        return {
          schemaVersion: 1,
          purpose: request.purpose,
          signerKeyId: request.signerKeyId,
          snapshotPayloadHash: request.snapshotPayloadHash,
          signature: sign(null, Buffer.from(canonicalJson(request.payload)), privateKey).toString(
            'base64',
          ),
        };
      },
    };
    const publicationStore = new PostgresRetainedNativeModuleAuthorizationAuditedPublicationStore(
      prisma,
    );
    const publisher = new BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher(
      workspaceId,
      publicationInstanceId,
      [root],
      publicationStore,
      () => now,
    );
    const input = {
      schemaVersion: 1 as const,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE' as const,
      workspaceId,
      supervisorInstanceId: publicationInstanceId,
      snapshotId: `audited-published-snapshot-${suffix}-1`,
      snapshotVersion: 1,
      signerKeyId,
      previousSnapshotHash: null,
      issuedAt: nowIso,
      validUntil: authorizedUntil,
      authorizations: [],
      runtimeConnection: 'NOT_CONFIGURED' as const,
    };
    const controller = () =>
      new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController(
        workspaceId,
        publicationInstanceId,
        authority,
        signer,
        publisher,
        () => now,
      );
    await expect(controller().issue(input, new AbortController().signal)).resolves.toMatchObject({
      publication: 'APPENDED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    await expect(controller().issue(input, new AbortController().signal)).resolves.toMatchObject({
      publication: 'REPLAYED',
    });

    const evidence = await prisma.$queryRaw<
      readonly {
        workspaceId: string;
        snapshotHash: string;
        issuanceAuthorizationId: string;
        approvalId: string;
        approvalEvidenceHash: string;
        authorityLevel: number;
      }[]
    >(Prisma.sql`
      SELECT "workspaceId"::TEXT AS "workspaceId", "snapshotHash", "issuanceAuthorizationId",
        "approvalId", "approvalEvidenceHash", "authorityLevel"
      FROM "acp_retained_native_module_authorization_issuance_evidence"
      WHERE "supervisorInstanceId" = ${publicationInstanceId}
    `);
    expect(evidence).toEqual([
      {
        workspaceId,
        snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        issuanceAuthorizationId: `issuance-authorization-${suffix}`,
        approvalId: `approval-${suffix}`,
        approvalEvidenceHash: 'e'.repeat(64),
        authorityLevel: 3,
      },
    ]);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "acp_retained_native_module_authorization_issuance_evidence" (
          "workspaceId", "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash",
          "signerKeyId", "issuanceRequestHash", "issuanceAuthorizationId",
          "authorityRequestHash", "approvalId", "approvalEvidenceHash", "authorizedByReference",
          "authorityLevel", "authorizedFrom", "authorizedUntil"
        ) SELECT "workspaceId", "supervisorInstanceId", "snapshotVersion", "snapshotId",
          "snapshotHash", "signerKeyId", "issuanceRequestHash", "issuanceAuthorizationId",
          "authorityRequestHash", "approvalId", "approvalEvidenceHash", "authorizedByReference",
          "authorityLevel", clock_timestamp() - INTERVAL '10 minutes',
          clock_timestamp() - INTERVAL '9 minutes'
        FROM "acp_retained_native_module_authorization_issuance_evidence"
        WHERE "supervisorInstanceId" = ${publicationInstanceId}
      `),
    ).rejects.toThrow(/not currently authorized/u);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "acp_retained_native_module_authorization_issuance_evidence" (
          "workspaceId", "supervisorInstanceId", "snapshotVersion", "snapshotId", "snapshotHash",
          "signerKeyId", "issuanceRequestHash", "issuanceAuthorizationId",
          "authorityRequestHash", "approvalId", "approvalEvidenceHash", "authorizedByReference",
          "authorityLevel", "authorizedFrom", "authorizedUntil"
        ) SELECT CAST(${randomUUID()} AS UUID), "supervisorInstanceId", "snapshotVersion",
          "snapshotId", "snapshotHash", "signerKeyId", "issuanceRequestHash",
          "issuanceAuthorizationId", "authorityRequestHash", "approvalId",
          "approvalEvidenceHash", "authorizedByReference", "authorityLevel", "authorizedFrom",
          "authorizedUntil"
        FROM "acp_retained_native_module_authorization_issuance_evidence"
        WHERE "supervisorInstanceId" = ${publicationInstanceId}
      `),
    ).rejects.toThrow(/supervisor workspace binding denied/u);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_retained_native_module_authorization_issuance_evidence"
        SET "approvalEvidenceHash" = ${'f'.repeat(64)}
        WHERE "supervisorInstanceId" = ${publicationInstanceId}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_retained_native_module_authorization_issuance_evidence"
        WHERE "supervisorInstanceId" = ${publicationInstanceId}
      `),
    ).rejects.toThrow();
    await expect(
      rootRegistry.provision(
        {
          schemaVersion: 1,
          purpose: 'RETAINED_NATIVE_MODULE_AUTHORIZATION_PUBLIC_ROOT_PROVISIONING',
          workspaceId,
          supervisorInstanceId: publicationInstanceId,
          root: {
            ...root,
            rootRecordVersion: 2,
            revokedAt: new Date(now - 1).toISOString(),
          },
          runtimeConnection: 'NOT_CONFIGURED',
        },
        rootCapability,
        rootContext,
        () => now + 1,
      ),
    ).resolves.toBe('APPENDED');
    const secondInput = {
      ...input,
      snapshotId: `audited-published-snapshot-${suffix}-2`,
      snapshotVersion: 2,
      previousSnapshotHash: evidence[0]!.snapshotHash,
    };
    await expect(controller().issue(secondInput, new AbortController().signal)).rejects.toThrow(
      /NOT_CONFIGURED/u,
    );
    await expect(
      prisma.$queryRaw(Prisma.sql`
        SELECT 1
        FROM "acp_retained_native_module_authorization_snapshots"
        WHERE "supervisorInstanceId" = ${publicationInstanceId}
          AND "snapshotVersion" = 2
      `),
    ).resolves.toEqual([]);
  });
});
