import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import type { RetainedNativeSupervisorModuleAuthorizationRootRecord } from '@ventureos/agent-bridge';
import { Prisma, prisma } from '@ventureos/database';
import { describe, expect, it } from 'vitest';

import { PostgresRetainedNativeModuleAuthorizationRootRegistry } from '../src/modules/agent-control-plane/retained-native-module-authorization-root-registry';

describe('durable retained-native module authorization public-root registry (PostgreSQL integration)', () => {
  it('persists scoped Level-3 roots, advances monotonically, and denies unaudited mutation', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const supervisorInstanceId = `native-supervisor-${randomUUID()}`;
    const principalId = `control-plane-owner-${randomUUID()}`;
    const context = Object.freeze({ workspaceId, principalId });
    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { ...context, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    const publicSpki = generateKeyPairSync('ed25519').publicKey.export({
      format: 'der',
      type: 'spki',
    });
    const now = Date.now();
    const root: Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord> = Object.freeze({
      schemaVersion: 1,
      rootRecordId: `native-module-root-${randomUUID()}`,
      rootRecordVersion: 1,
      signerKeyId: `native-module-signer-${randomUUID()}`,
      algorithm: 'ED25519',
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
      publicKeySpkiBase64: publicSpki.toString('base64'),
      publicKeySpkiSha256: createHash('sha256').update(publicSpki).digest('hex'),
      minimumSnapshotVersion: 1,
      validFrom: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + 86_400_000).toISOString(),
      revokedAt: null,
      testOnly: false,
    });
    const request = Object.freeze({
      schemaVersion: 1 as const,
      purpose: 'RETAINED_NATIVE_MODULE_AUTHORIZATION_PUBLIC_ROOT_PROVISIONING' as const,
      workspaceId,
      supervisorInstanceId,
      root,
      runtimeConnection: 'NOT_CONFIGURED' as const,
    });
    const registry = new PostgresRetainedNativeModuleAuthorizationRootRegistry(prisma);

    await expect(
      Promise.all([
        registry.provision(request, capability, context, () => now),
        registry.provision(request, capability, context, () => now),
      ]).then((outcomes) => outcomes.sort()),
    ).resolves.toEqual(['APPENDED', 'REPLAYED']);
    await expect(registry.provision(request, capability, context, () => now + 1)).resolves.toBe(
      'REPLAYED',
    );
    await expect(registry.read(workspaceId, supervisorInstanceId)).resolves.toEqual([root]);
    await expect(registry.read(otherWorkspaceId, supervisorInstanceId)).resolves.toEqual([]);

    const secondRoot = Object.freeze({
      ...root,
      rootRecordVersion: 2,
      minimumSnapshotVersion: 2,
    });
    await expect(
      registry.provision({ ...request, root: secondRoot }, capability, context, () => now + 2),
    ).resolves.toBe('APPENDED');
    await expect(registry.read(workspaceId, supervisorInstanceId)).resolves.toEqual([secondRoot]);

    await expect(
      registry.provision(
        { ...request, root: { ...root, rootRecordVersion: 4, minimumSnapshotVersion: 4 } },
        capability,
        context,
        () => now + 3,
      ),
    ).rejects.toThrow();
    const revokedRoot = Object.freeze({
      ...secondRoot,
      rootRecordVersion: 3,
      revokedAt: new Date(now - 1).toISOString(),
    });
    await expect(
      registry.provision({ ...request, root: revokedRoot }, capability, context, () => now + 3),
    ).resolves.toBe('APPENDED');
    await expect(registry.read(workspaceId, supervisorInstanceId)).resolves.toEqual([]);
    await expect(
      registry.provision(
        {
          ...request,
          workspaceId: otherWorkspaceId,
          root: { ...root, rootRecordId: `other-root-${randomUUID()}`, rootRecordVersion: 1 },
        },
        OperationalEventCapability.issue('CONTROL_PLANE', [
          {
            workspaceId: otherWorkspaceId,
            principalId,
            actorKind: 'SYSTEM',
            authorityLevel: 3,
          },
        ]),
        { workspaceId: otherWorkspaceId, principalId },
        () => now + 4,
      ),
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_retained_native_module_authorization_roots"
        SET "minimumSnapshotVersion" = 1
        WHERE "workspaceId" = CAST(${workspaceId} AS UUID)
          AND "supervisorInstanceId" = ${supervisorInstanceId}
      `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_retained_native_module_authorization_root_evidence"
        WHERE "workspaceId" = CAST(${workspaceId} AS UUID)
          AND "supervisorInstanceId" = ${supervisorInstanceId}
      `),
    ).rejects.toThrow();

    const unauditedId = `unaudited-root-${randomUUID()}`;
    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "acp_retained_native_module_authorization_roots" (
          "workspaceId", "supervisorInstanceId", "rootRecordId", "rootRecordVersion",
          "signerKeyId", "algorithm", "purpose", "publicKeySpkiBase64",
          "publicKeySpkiSha256", "minimumSnapshotVersion", "validFrom", "validUntil",
          "revokedAt", "testOnly"
        ) VALUES (
          CAST(${workspaceId} AS UUID), ${supervisorInstanceId}, ${unauditedId}, 1,
          ${`unaudited-signer-${randomUUID()}`}, 'ED25519',
          'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
          ${root.publicKeySpkiBase64}, ${'f'.repeat(64)}, 1,
          ${new Date(root.validFrom)}, ${new Date(root.validUntil)}, NULL, false
        )
      `),
    ).rejects.toThrow(/evidence/iu);

    const evidence = await prisma.$queryRaw<readonly { authorityLevel: number }[]>(Prisma.sql`
      SELECT "authorityLevel"
      FROM "acp_retained_native_module_authorization_root_evidence"
      WHERE "workspaceId" = CAST(${workspaceId} AS UUID)
        AND "supervisorInstanceId" = ${supervisorInstanceId}
      ORDER BY "rootRecordVersion"
    `);
    expect(evidence).toEqual([{ authorityLevel: 3 }, { authorityLevel: 3 }, { authorityLevel: 3 }]);
  });
});
