import { createHash, generateKeyPairSync } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  BoundedLinuxRetainedNativeSupervisorServiceOwner,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
  type LinuxRetainedNativeSupervisorServiceRequest,
  type LoadedLinuxRetainedNativeSupervisorListenerModule,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import { BoundedLevel3RetainedNativeSupervisorServiceAuthority } from './retained-native-service-authority';
import type { TopologyCarrierSignatureRootSqlClient } from './topology-carrier-signature-root-registry';
import {
  createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner,
  loadLinuxNativeWorkerServiceAuthorityApiServiceOwner,
  runPostgresApiCoordinatorWorkerServiceAuthorityOne,
} from './worker-service-authority-api-composition';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const socketPath = '/run/ventureos/worker-service-authority.sock';
const binding = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
  carrierId: 'carrier-worker-authority-api-composition',
  coordinatorPrincipalReference: 'service:api:worker-authority-composition',
  workerPrincipalReference: 'service:worker:worker-authority-composition',
  workspaceId: 'workspace-worker-authority-composition',
  supervisorInstanceId: 'supervisor-worker-authority-composition',
  provisioningAttemptId: 'attempt-worker-authority-composition',
  provisioningPlanHash: 'd'.repeat(64),
  issuedAt: new Date(NOW - 100).toISOString(),
  expiresAt: new Date(NOW + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED' as const,
});
const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);
const workerPublicSpki = generateKeyPairSync('ed25519').publicKey.export({
  format: 'der',
  type: 'spki',
});
const workerRoot = Object.freeze({
  schemaVersion: 1,
  rootRecordId: 'root:worker:worker-authority-composition',
  rootRecordVersion: 1,
  signerKeyId: 'key:worker:worker-authority-composition',
  algorithm: 'ED25519',
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
  principalRole: 'WORKER_CLIENT',
  principalReference: binding.workerPrincipalReference,
  bindingHash,
  publicKeySpkiBase64: workerPublicSpki.toString('base64'),
  publicKeySpkiSha256: createHash('sha256').update(workerPublicSpki).digest('hex'),
  validFrom: new Date(NOW - 1_000),
  validUntil: new Date(NOW + 10_000),
  revokedAt: null,
  testOnly: false,
});
const context = Object.freeze({
  workspaceId: binding.workspaceId,
  principalId: 'control-plane:worker-service-authority-api',
});

function request(
  serviceKind:
    'TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER' | 'TOPOLOGY_CARRIER_WORKER_LISTENER',
  overrides: Partial<LinuxRetainedNativeSupervisorServiceRequest> = {},
): LinuxRetainedNativeSupervisorServiceRequest {
  const listener = serviceKind === 'TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER';
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE',
    workspaceId: binding.workspaceId,
    supervisorInstanceId: binding.supervisorInstanceId,
    serviceKind,
    provisioningId: listener
      ? 'path-provision:worker-authority-api'
      : 'path-provision:worker-carrier',
    pathProvisionRequestHash: listener ? 'a'.repeat(64) : 'c'.repeat(64),
    pathApprovalEvidenceHash: listener ? 'b'.repeat(64) : 'e'.repeat(64),
    socketDirectory: '/run/ventureos',
    socketDirectoryIdentityReference: 'linux:dev-2b:ino-2455',
    socketDirectoryOwnerUid: 700,
    socketDirectoryOwnerGid: 701,
    socketDirectoryMode: 0o700,
    socketPath: listener ? socketPath : '/run/ventureos/topology-carrier-worker.sock',
    expectedPeerRole: listener ? 'WORKER_CLIENT' : 'API_COORDINATOR',
    expectedPeerPid: listener ? 830 : 831,
    expectedPeerUid: listener ? 702 : 704,
    expectedPeerGid: listener ? 703 : 705,
    maximumSessionDurationMs: 2_000,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

function authority(exact: LinuxRetainedNativeSupervisorServiceRequest) {
  return new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
    OperationalEventCapability.issue('CONTROL_PLANE', [
      { ...context, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]),
    context,
    exact,
    () => NOW,
  );
}

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    moduleKind: 'LISTENER',
    socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
    nativeModule: {
      abiVersion: 1,
      platform: 'LINUX',
      createOwnedListener: vi.fn(),
    },
    ...overrides,
  };
}

function loadRequest(
  overrides: Partial<LinuxRetainedNativeSupervisorModuleLoadRequest> = {},
): LinuxRetainedNativeSupervisorModuleLoadRequest {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: 'LISTENER',
    canonicalModulePath: '/opt/ventureos/worker-service-authority-listener.node',
    socketPath,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

class ScriptedSqlClient implements TopologyCarrierSignatureRootSqlClient {
  readonly queries: Prisma.Sql[] = [];
  constructor(private readonly responses: unknown[]) {}
  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.queries.push(query);
    if (this.responses.length === 0) throw new Error('Unexpected SQL call');
    return this.responses.shift() as T;
  }
}

describe('worker service-authority API composition', () => {
  it('inertly binds the distinct listener purpose without native use', () => {
    const listenerRequest = request('TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER');
    const listener = loaded();
    const owner = createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
      listener,
      authority(listenerRequest),
      listenerRequest,
      () => NOW,
    );
    expect(owner).toBeInstanceOf(BoundedLinuxRetainedNativeSupervisorServiceOwner);
    expect(listener.nativeModule.createOwnedListener).not.toHaveBeenCalled();
  });

  it('rejects envelope, purpose, socket, and authority substitution before native use', () => {
    const exact = request('TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER');
    for (const [listener, candidate, authorityInput] of [
      [loaded({ runtimeConnection: 'CONNECTED' }), exact, authority(exact)],
      [loaded({ unexpected: true }), exact, authority(exact)],
      [loaded(), request('TOPOLOGY_CARRIER_WORKER_LISTENER'), authority(exact)],
      [loaded(), { ...exact, socketPath: '/run/ventureos/other.sock' }, authority(exact)],
      [loaded(), exact, {}],
    ] as const) {
      expect(() =>
        createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
          listener,
          authorityInput as BoundedLevel3RetainedNativeSupervisorServiceAuthority,
          candidate,
          () => NOW,
        ),
      ).toThrow();
      expect(listener.nativeModule.createOwnedListener).not.toHaveBeenCalled();
    }
  });

  it('loads exactly one matching listener and remains inactive', async () => {
    const listenerRequest = request('TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER');
    const listener = loaded();
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();
    const load = vi
      .spyOn(loader, 'load')
      .mockResolvedValue(
        listener as unknown as Readonly<LoadedLinuxRetainedNativeSupervisorListenerModule>,
      );
    const signal = new AbortController().signal;
    await expect(
      loadLinuxNativeWorkerServiceAuthorityApiServiceOwner(
        loader,
        loadRequest(),
        signal,
        authority(listenerRequest),
        listenerRequest,
        () => NOW,
      ),
    ).resolves.toBeInstanceOf(BoundedLinuxRetainedNativeSupervisorServiceOwner);
    expect(load).toHaveBeenCalledWith(loadRequest(), signal);
    expect(listener.nativeModule.createOwnedListener).not.toHaveBeenCalled();
  });

  it('joins the durable worker root, signer, issuer, and exact listener only at one-shot run', async () => {
    const listenerRequest = request('TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER');
    const workerRequest = request('TOPOLOGY_CARRIER_WORKER_LISTENER');
    const owner = createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
      loaded(),
      authority(listenerRequest),
      listenerRequest,
      () => NOW,
    );
    const run = vi
      .spyOn(owner, 'runTopologyCarrierWorkerServiceAuthorityApiOne')
      .mockResolvedValue();
    const database = new ScriptedSqlClient([[workerRoot]]);
    const signer = { sign: vi.fn() };
    const signal = new AbortController().signal;

    await runPostgresApiCoordinatorWorkerServiceAuthorityOne(
      owner,
      database,
      listenerRequest,
      workerRequest,
      authority(workerRequest),
      signer,
      binding,
      signal,
      () => NOW,
    );

    expect(database.queries).toHaveLength(1);
    expect(signer.sign).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      listenerRequest,
      expect.any(BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint),
      binding,
      signal,
    );
  });

  it('denies scope, role, cancellation, and owner forgery before root lookup or listener use', async () => {
    const listenerRequest = request('TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER');
    const workerRequest = request('TOPOLOGY_CARRIER_WORKER_LISTENER');
    for (const [owner, listener, worker, signal] of [
      [
        Object.create(BoundedLinuxRetainedNativeSupervisorServiceOwner.prototype),
        listenerRequest,
        workerRequest,
        new AbortController().signal,
      ],
      [
        createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
          loaded(),
          authority(listenerRequest),
          listenerRequest,
          () => NOW,
        ),
        { ...listenerRequest, workspaceId: 'workspace-other' },
        workerRequest,
        new AbortController().signal,
      ],
      [
        createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
          loaded(),
          authority(listenerRequest),
          listenerRequest,
          () => NOW,
        ),
        listenerRequest,
        { ...workerRequest, expectedPeerRole: 'WORKER_CLIENT' },
        new AbortController().signal,
      ],
      [
        createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
          loaded(),
          authority(listenerRequest),
          listenerRequest,
          () => NOW,
        ),
        listenerRequest,
        workerRequest,
        AbortSignal.abort(),
      ],
    ] as const) {
      const database = new ScriptedSqlClient([[workerRoot]]);
      await expect(
        runPostgresApiCoordinatorWorkerServiceAuthorityOne(
          owner as BoundedLinuxRetainedNativeSupervisorServiceOwner,
          database,
          listener,
          worker,
          authority(workerRequest),
          { sign: vi.fn() },
          binding,
          signal,
          () => NOW,
        ),
      ).rejects.toMatchObject({ code: expect.any(String) });
      expect(database.queries).toHaveLength(0);
    }
  });

  it('denies signer and timeout drift before root lookup and normalizes root failures', async () => {
    const listenerRequest = request('TOPOLOGY_CARRIER_WORKER_SERVICE_AUTHORITY_API_LISTENER');
    const workerRequest = request('TOPOLOGY_CARRIER_WORKER_LISTENER');
    for (const [signer, timeoutMs] of [
      [new DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(), 2_000],
      [{}, 2_000],
      [{ sign: vi.fn() }, 99],
      [{ sign: vi.fn() }, 5_001],
    ] as const) {
      const owner = createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
        loaded(),
        authority(listenerRequest),
        listenerRequest,
        () => NOW,
      );
      const run = vi.spyOn(owner, 'runTopologyCarrierWorkerServiceAuthorityApiOne');
      const database = new ScriptedSqlClient([[workerRoot]]);
      await expect(
        runPostgresApiCoordinatorWorkerServiceAuthorityOne(
          owner,
          database,
          listenerRequest,
          workerRequest,
          authority(workerRequest),
          signer as never,
          binding,
          new AbortController().signal,
          () => NOW,
          timeoutMs,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
      expect(database.queries).toHaveLength(0);
      expect(run).not.toHaveBeenCalled();
    }

    const owner = createLoadedLinuxNativeWorkerServiceAuthorityApiServiceOwner(
      loaded(),
      authority(listenerRequest),
      listenerRequest,
      () => NOW,
    );
    const run = vi.spyOn(owner, 'runTopologyCarrierWorkerServiceAuthorityApiOne');
    await expect(
      runPostgresApiCoordinatorWorkerServiceAuthorityOne(
        owner,
        new ScriptedSqlClient([[]]),
        listenerRequest,
        workerRequest,
        authority(workerRequest),
        { sign: vi.fn() },
        binding,
        new AbortController().signal,
        () => NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(run).not.toHaveBeenCalled();
  });
});
