import { createHash, generateKeyPairSync } from 'node:crypto';

import {
  canonicalJson,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import {
  createPostgresApiCoordinatorLinuxLocalTopologyCarrierRootLookupHandler,
  createPostgresApiCoordinatorTopologyCarrierRootLookupHandler,
} from './topology-carrier-root-lookup-composition';
import type { TopologyCarrierSignatureRootSqlClient } from './topology-carrier-signature-root-registry';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
  carrierId: 'carrier-composed-root-lookup',
  coordinatorPrincipalReference: 'service:api:composed-root-lookup',
  workerPrincipalReference: 'service:worker:composed-root-lookup',
  workspaceId: 'workspace-composed-root-lookup',
  supervisorInstanceId: 'supervisor-composed-root-lookup',
  provisioningAttemptId: 'attempt-composed-root-lookup',
  provisioningPlanHash: 'd'.repeat(64),
  issuedAt: new Date(NOW - 100).toISOString(),
  expiresAt: new Date(NOW + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED' as const,
});
const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
const publicSpki = generateKeyPairSync('ed25519').publicKey.export({
  format: 'der',
  type: 'spki',
});
const root = Object.freeze({
  schemaVersion: 1 as const,
  rootRecordId: 'root:api:composed-root-lookup',
  rootRecordVersion: 1 as const,
  signerKeyId: 'key:api:composed-root-lookup',
  algorithm: 'ED25519' as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY' as const,
  principalRole: 'API_COORDINATOR' as const,
  principalReference: binding.coordinatorPrincipalReference,
  bindingHash,
  publicKeySpkiBase64: publicSpki.toString('base64'),
  publicKeySpkiSha256: createHash('sha256').update(publicSpki).digest('hex'),
  validFrom: new Date(NOW - 1_000).toISOString(),
  validUntil: new Date(NOW + 10_000).toISOString(),
  revokedAt: null,
  testOnly: false,
});
const socketPath = '/run/ventureos/carrier-root-lookup.sock';
const endpoint = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_LSTAT_UNIX_SOCKET',
  fileType: 'SOCKET',
  socketPath,
  socketDevice: 43,
  socketInode: 9_301,
  socketOwnerUid: 700,
  socketOwnerGid: 701,
  socketMode: 0o600,
});
const workerPeer = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_SO_PEERCRED',
  peerPid: 830,
  peerUid: 702,
  peerGid: 703,
});
const serverAuthorization = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  socketPath,
  socketDevice: endpoint.socketDevice,
  socketInode: endpoint.socketInode,
  socketOwnerUid: endpoint.socketOwnerUid,
  socketOwnerGid: endpoint.socketOwnerGid,
  socketMode: endpoint.socketMode,
  expectedPeerPid: workerPeer.peerPid,
  expectedPeerUid: workerPeer.peerUid,
  expectedPeerGid: workerPeer.peerGid,
  runtimeConnection: 'NOT_CONFIGURED',
});

class ScriptedSqlClient implements TopologyCarrierSignatureRootSqlClient {
  readonly queries: Prisma.Sql[] = [];

  constructor(private readonly responses: unknown[]) {}

  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.queries.push(query);
    if (this.responses.length === 0) throw new Error('Unexpected SQL call');
    return this.responses.shift() as T;
  }
}

function request() {
  return {
    protocolVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_REQUEST',
    requesterPrincipalRole: 'WORKER_CLIENT',
    requesterPrincipalReference: binding.workerPrincipalReference,
    requestedPrincipalRole: 'API_COORDINATOR',
    requestedPrincipalReference: binding.coordinatorPrincipalReference,
    carrierId: binding.carrierId,
    binding,
    bindingHash,
    challenge: Buffer.alloc(32, 11).toString('base64url'),
    runtimeConnection: 'NOT_CONFIGURED',
  } as const;
}

function authorization() {
  return {
    authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT',
    localPrincipalRole: 'API_COORDINATOR',
    localPrincipalReference: binding.coordinatorPrincipalReference,
    peerPrincipalRole: 'WORKER_CLIENT',
    peerPrincipalReference: binding.workerPrincipalReference,
    carrierId: binding.carrierId,
    bindingHash,
    authenticatedAt: new Date(NOW).toISOString(),
    notAfter: binding.expiresAt,
    runtimeConnection: 'NOT_CONFIGURED',
  } as const;
}

describe('PostgreSQL API coordinator carrier-root lookup composition', () => {
  it('is inert at construction and releases only the exact coordinator root after authentication', async () => {
    const database = new ScriptedSqlClient([
      [
        {
          ...root,
          validFrom: new Date(root.validFrom),
          validUntil: new Date(root.validUntil),
        },
      ],
    ]);
    const handler = createPostgresApiCoordinatorTopologyCarrierRootLookupHandler(
      database,
      binding,
      () => NOW,
    );
    expect(database.queries).toHaveLength(0);

    const exactRequest = request();
    const response = await handler.handle(
      new TextEncoder().encode(canonicalJson(exactRequest)),
      authorization(),
      new AbortController().signal,
    );
    expect(JSON.parse(new TextDecoder().decode(response))).toMatchObject({
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_RESPONSE',
      requestHash: createHash('sha256').update(canonicalJson(exactRequest)).digest('hex'),
      root,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]!.values).toContain('API_COORDINATOR');
    await expect(
      handler.handle(
        new TextEncoder().encode(canonicalJson(exactRequest)),
        authorization(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(database.queries).toHaveLength(1);
  });

  it('fails closed on invalid durable access, binding, clock, or timeout before database use', () => {
    const database = new ScriptedSqlClient([]);
    const cases: readonly [unknown, unknown, unknown, unknown][] = [
      [null, binding, () => NOW, 2_000],
      [database, { ...binding, runtimeConnection: 'CONNECTED' }, () => NOW, 2_000],
      [database, binding, () => Number.NaN, 2_000],
      [database, binding, () => NOW, 99],
    ];
    for (const [candidateDatabase, candidateBinding, clock, timeoutMs] of cases) {
      expect(() =>
        createPostgresApiCoordinatorTopologyCarrierRootLookupHandler(
          candidateDatabase as TopologyCarrierSignatureRootSqlClient,
          candidateBinding,
          clock as () => number,
          timeoutMs as number,
        ),
      ).toThrow();
    }
    expect(database.queries).toHaveLength(0);
  });

  it('derives protocol identity from exact Linux endpoint and worker peer evidence before lookup', async () => {
    const storedRoot = {
      ...root,
      validFrom: new Date(root.validFrom),
      validUntil: new Date(root.validUntil),
    };
    const database = new ScriptedSqlClient([[storedRoot]]);
    const handler = createPostgresApiCoordinatorLinuxLocalTopologyCarrierRootLookupHandler(
      database,
      binding,
      serverAuthorization,
      () => NOW,
    );
    expect(database.queries).toHaveLength(0);
    const exactRequest = request();
    const response = await handler.handle(
      {
        endpointIdentity: endpoint,
        peerCredentials: workerPeer,
        requestFrame: Buffer.from(canonicalJson(exactRequest)),
      },
      new AbortController().signal,
    );
    expect(JSON.parse(new TextDecoder().decode(response))).toMatchObject({
      root,
      requestHash: createHash('sha256').update(canonicalJson(exactRequest)).digest('hex'),
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(database.queries).toHaveLength(1);

    const deniedDatabase = new ScriptedSqlClient([[storedRoot]]);
    const deniedHandler = createPostgresApiCoordinatorLinuxLocalTopologyCarrierRootLookupHandler(
      deniedDatabase,
      binding,
      serverAuthorization,
      () => NOW,
    );
    await expect(
      deniedHandler.handle(
        {
          endpointIdentity: endpoint,
          peerCredentials: { ...workerPeer, peerUid: workerPeer.peerUid + 1 },
          requestFrame: Buffer.from(canonicalJson(exactRequest)),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(deniedDatabase.queries).toHaveLength(0);
  });
});
