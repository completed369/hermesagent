import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
} from '@ventureos/agent-bridge';
import { Prisma, prisma } from '@ventureos/database';
import { describe, expect, it } from 'vitest';

import { PostgresTopologyCarrierSignatureRootRegistry } from '../src/modules/agent-control-plane/topology-carrier-signature-root-registry';

describe('durable topology carrier signature public-root registry (PostgreSQL integration)', () => {
  it('persists two exact role grants with Level-3 evidence and denies mutation or scope substitution', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const supervisorInstanceId = `native-supervisor-${randomUUID()}`;
    const carrierId = `carrier-${randomUUID()}`;
    const principalId = `control-plane-owner-${randomUUID()}`;
    const context = Object.freeze({ workspaceId, principalId });
    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { ...context, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    await prisma.$queryRaw(Prisma.sql`SELECT 1`);
    const now = Date.now();
    const binding = Object.freeze({
      schemaVersion: 1 as const,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
      authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
      carrierId,
      coordinatorPrincipalReference: `api-coordinator-${randomUUID()}`,
      workerPrincipalReference: `worker-client-${randomUUID()}`,
      workspaceId,
      supervisorInstanceId,
      provisioningAttemptId: `provisioning-attempt-${randomUUID()}`,
      provisioningPlanHash: createHash('sha256').update(randomUUID()).digest('hex'),
      issuedAt: new Date(now - 100).toISOString(),
      expiresAt: new Date(now + 4_900).toISOString(),
      runtimeConnection: 'NOT_CONFIGURED' as const,
    });
    const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
    const makeRoot = (
      principalRole: 'API_COORDINATOR' | 'WORKER_CLIENT',
      principalReference: string,
    ): Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord> => {
      const publicSpki = generateKeyPairSync('ed25519').publicKey.export({
        format: 'der',
        type: 'spki',
      });
      return Object.freeze({
        schemaVersion: 1,
        rootRecordId: `carrier-root-${randomUUID()}`,
        rootRecordVersion: 1,
        signerKeyId: `carrier-signer-${randomUUID()}`,
        algorithm: 'ED25519',
        purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
        principalRole,
        principalReference,
        bindingHash,
        publicKeySpkiBase64: publicSpki.toString('base64'),
        publicKeySpkiSha256: createHash('sha256').update(publicSpki).digest('hex'),
        validFrom: new Date(now - 1_000).toISOString(),
        validUntil: new Date(now + 10_000).toISOString(),
        revokedAt: null,
        testOnly: false,
      });
    };
    const coordinatorRoot = makeRoot('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const workerRoot = makeRoot('WORKER_CLIENT', binding.workerPrincipalReference);
    const requestFor = (root: typeof coordinatorRoot) =>
      Object.freeze({
        schemaVersion: 1 as const,
        purpose: 'TOPOLOGY_CARRIER_SIGNATURE_PUBLIC_ROOT_PROVISIONING' as const,
        workspaceId,
        supervisorInstanceId,
        binding,
        root,
        runtimeConnection: 'NOT_CONFIGURED' as const,
      });
    const registry = new PostgresTopologyCarrierSignatureRootRegistry(prisma);

    await expect(
      Promise.all(
        Array.from({ length: 4 }, () =>
          registry.provision(requestFor(coordinatorRoot), capability, context),
        ),
      ).then((outcomes) => outcomes.sort()),
    ).resolves.toEqual(['APPENDED', 'REPLAYED', 'REPLAYED', 'REPLAYED']);
    await expect(registry.provision(requestFor(workerRoot), capability, context)).resolves.toBe(
      'APPENDED',
    );
    await expect(registry.read(binding, 'API_COORDINATOR')).resolves.toEqual(coordinatorRoot);
    await expect(registry.read(binding, 'WORKER_CLIENT')).resolves.toEqual(workerRoot);

    await expect(
      registry.provision(
        {
          ...requestFor(coordinatorRoot),
          workspaceId: otherWorkspaceId,
          binding: { ...binding, workspaceId: otherWorkspaceId },
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
      ),
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "acp_topology_carrier_signature_roots"
        SET "principalReference" = ${binding.workerPrincipalReference}
        WHERE "workspaceId" = CAST(${workspaceId} AS UUID) AND "carrierId" = ${carrierId}
      `),
    ).rejects.toThrow(/immutable/iu);
    await expect(
      prisma.$executeRaw(Prisma.sql`
        DELETE FROM "acp_topology_carrier_signature_root_evidence"
        WHERE "workspaceId" = CAST(${workspaceId} AS UUID) AND "carrierId" = ${carrierId}
      `),
    ).rejects.toThrow(/immutable/iu);

    const evidence = await prisma.$queryRaw<
      readonly { principalRole: string; authorityLevel: number }[]
    >(
      Prisma.sql`
        SELECT "principalRole", "authorityLevel"
        FROM "acp_topology_carrier_signature_root_evidence"
        WHERE "workspaceId" = CAST(${workspaceId} AS UUID) AND "carrierId" = ${carrierId}
        ORDER BY "principalRole"
      `,
    );
    expect(evidence).toEqual([
      { principalRole: 'API_COORDINATOR', authorityLevel: 3 },
      { principalRole: 'WORKER_CLIENT', authorityLevel: 3 },
    ]);
  });
});
