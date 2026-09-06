import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  DenyRetainedNativeSupervisorTopologyObservationCarrier,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type ClosableRetainedNativeSupervisorTopologyObservationCarrier,
} from './retained-native-supervisor-topology-observation-carrier';
import {
  DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  type RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
} from './retained-native-supervisor-topology-observation-carrier-signature';
import {
  DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
  RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator,
  RootResolvedRetainedNativeSupervisorTopologyObservationWorker,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
} from './retained-native-supervisor-topology-observation-carrier-composition';
import {
  BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel,
  BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint,
  type RetainedNativeSupervisorTopologyObservationCarrierByteChannel,
} from './retained-native-supervisor-topology-observation-carrier-channel';
import {
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  linuxRetainedNativeSupervisorTopologyObservationRequestHash,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
  type LinuxRetainedNativeSupervisorTopologyObservationRequest,
} from './retained-native-supervisor-shared-runtime-topology';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER',
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
  carrierId: 'carrier-composed-one',
  coordinatorPrincipalReference: 'service:api:one',
  workerPrincipalReference: 'service:worker:one',
  workspaceId: 'workspace-one',
  supervisorInstanceId: 'supervisor-one',
  provisioningAttemptId: 'attempt-0001',
  provisioningPlanHash: 'a'.repeat(64),
  issuedAt: new Date(now - 100).toISOString(),
  expiresAt: new Date(now + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED',
} as const);
const request: LinuxRetainedNativeSupervisorTopologyObservationRequest = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION',
  observerRole: 'WORKER_CLIENT',
  workspaceId: binding.workspaceId,
  supervisorInstanceId: binding.supervisorInstanceId,
  provisioningAttemptId: binding.provisioningAttemptId,
  provisioningPlanHash: binding.provisioningPlanHash,
  platform: 'LINUX',
  architecture: 'X64',
  runtimeRootParent: '/var/lib/ventureos/runtime/workspace-one/supervisor-one',
  runtimeRootParentIdentityReference: 'linux:dev-a:ino-10',
  runtimeRootParentOwnerUid: 65532,
  runtimeRootParentOwnerGid: 65532,
  runtimeRootParentMode: 0o700,
  sourceModulePath: '/usr/lib/ventureos/native/linux-retained-native-client.node',
  sourceModuleSha256: 'b'.repeat(64),
  sourceModuleIdentityReference: 'linux:dev-b:ino-20',
  sourceModuleOwnerUid: 0,
  sourceModuleOwnerGid: 0,
  sourceModuleMode: 0o444,
  sourceModuleSizeBytes: 4096,
  runtimeConnection: 'NOT_CONFIGURED',
});

function code(value: string) {
  return expect.objectContaining({ code: value });
}

function keyFixture(role: 'API_COORDINATOR' | 'WORKER_CLIENT', principalReference: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const signerKeyId = `key:${role.toLowerCase()}:composition`;
  const root = Object.freeze({
    schemaVersion: 1,
    rootRecordId: `root:${role.toLowerCase()}:composition`,
    rootRecordVersion: 1,
    signerKeyId,
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
    principalRole: role,
    principalReference,
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    publicKeySpkiBase64: spki.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(spki).digest('hex'),
    validFrom: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 10_000).toISOString(),
    revokedAt: null,
    testOnly: false,
  } as const);
  const signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner = {
    sign: vi.fn(async (payload: unknown) => ({
      algorithm: 'ED25519',
      signerKeyId,
      payloadHash: createHash('sha256').update(canonicalJson(payload)).digest('hex'),
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    })),
  };
  return { root, signer };
}

class RootSource implements RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource {
  readonly read = vi.fn(
    async (
      _binding: typeof binding,
      role: 'API_COORDINATOR' | 'WORKER_CLIENT',
      _signal: AbortSignal,
    ) => (role === 'API_COORDINATOR' ? this.apiRoot : this.workerRoot),
  );
  constructor(
    readonly apiRoot: unknown,
    readonly workerRoot: unknown,
  ) {}
}

class Observer implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  readonly observe = vi.fn(async (input: unknown) => ({
    ...(input as LinuxRetainedNativeSupervisorTopologyObservationRequest),
    observationId: 'observation-worker-composition',
    requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(
      input as LinuxRetainedNativeSupervisorTopologyObservationRequest,
    ),
    evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS',
    principalAuthority: 'LINUX_EFFECTIVE_IDENTITY',
    observerUid: 65532,
    observerGid: 65532,
    observedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 3_000).toISOString(),
    topologyState: 'VISIBLE_NOT_PROVISIONED',
  }));
}

class LoopbackCarrier implements ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  worker!: RootResolvedRetainedNativeSupervisorTopologyObservationWorker;
  readonly close = vi.fn(async () => undefined);
  readonly exchange = vi.fn(async (input: unknown, signal: AbortSignal) =>
    this.worker.handle(input, signal),
  );
}

class ByteLoopbackChannel implements RetainedNativeSupervisorTopologyObservationCarrierByteChannel {
  endpoint!: BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint;
  readonly close = vi.fn(async () => undefined);
  readonly exchange = vi.fn((input: Uint8Array, signal: AbortSignal) =>
    this.endpoint.handle(input, signal),
  );
}

function subject(overrides: { apiRoot?: unknown; workerRoot?: unknown } = {}) {
  const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
  const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
  const roots = new RootSource(
    Object.hasOwn(overrides, 'apiRoot') ? overrides.apiRoot : api.root,
    Object.hasOwn(overrides, 'workerRoot') ? overrides.workerRoot : worker.root,
  );
  const observer = new Observer();
  const raw = new LoopbackCarrier();
  raw.worker = new RootResolvedRetainedNativeSupervisorTopologyObservationWorker(
    roots,
    observer,
    worker.signer,
    binding,
    () => now,
  );
  const coordinator = new RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator(
    roots,
    raw,
    api.signer,
    binding,
    'carrier-attempt-composition',
    () => now,
  );
  return { api, worker, roots, observer, raw, coordinator };
}

describe('root-resolved topology carrier role composition', () => {
  it('resolves exact opposite-role roots before one mutually authenticated observation', async () => {
    const { api, worker, roots, observer, raw, coordinator } = subject();
    await expect(coordinator.observe(request, new AbortController().signal)).resolves.toMatchObject(
      {
        topologyState: 'VISIBLE_NOT_PROVISIONED',
        runtimeConnection: 'NOT_CONFIGURED',
      },
    );
    expect(roots.read.mock.calls.map((call) => call[1])).toEqual([
      'WORKER_CLIENT',
      'API_COORDINATOR',
    ]);
    expect(api.signer.sign).toHaveBeenCalledOnce();
    expect(worker.signer.sign).toHaveBeenCalledOnce();
    expect(observer.observe).toHaveBeenCalledOnce();
    expect(raw.exchange).toHaveBeenCalledOnce();
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it('composes through the bounded canonical byte channel without activating a transport', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const roots = new RootSource(api.root, worker.root);
    const observer = new Observer();
    const workerRole = new RootResolvedRetainedNativeSupervisorTopologyObservationWorker(
      roots,
      observer,
      worker.signer,
      binding,
      () => now,
    );
    const byteChannel = new ByteLoopbackChannel();
    byteChannel.endpoint =
      new BoundedRetainedNativeSupervisorTopologyObservationCarrierWorkerFrameEndpoint(workerRole);
    const carrier = new BoundedRetainedNativeSupervisorTopologyObservationCarrierChannel(
      byteChannel,
    );
    const coordinator = new RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator(
      roots,
      carrier,
      api.signer,
      binding,
      'carrier-attempt-framed-composition',
      () => now,
    );

    await expect(coordinator.observe(request, new AbortController().signal)).resolves.toMatchObject(
      {
        topologyState: 'VISIBLE_NOT_PROVISIONED',
        runtimeConnection: 'NOT_CONFIGURED',
      },
    );
    expect(byteChannel.exchange).toHaveBeenCalledOnce();
    expect(byteChannel.close).toHaveBeenCalledOnce();
    expect(observer.observe).toHaveBeenCalledOnce();
  });

  it('denies substituted or missing roots before outbound exchange or worker observation', async () => {
    const wrongWorker = subject({ workerRoot: subject().api.root });
    await expect(
      wrongWorker.coordinator.observe(request, new AbortController().signal),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(wrongWorker.raw.exchange).not.toHaveBeenCalled();
    expect(wrongWorker.raw.close).toHaveBeenCalledOnce();

    const wrongApi = subject({ apiRoot: null });
    await expect(
      wrongApi.coordinator.observe(request, new AbortController().signal),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(wrongApi.observer.observe).not.toHaveBeenCalled();
    expect(wrongApi.raw.close).toHaveBeenCalledOnce();
  });

  it('denies unconfigured role dependencies before root lookup', () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const roots = new RootSource(api.root, worker.root);
    const raw = new LoopbackCarrier();
    expect(
      () =>
        new RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator(
          new DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource(),
          raw,
          api.signer,
          binding,
          'carrier-attempt-composition',
          () => now,
        ),
    ).toThrow('NOT_CONFIGURED');
    expect(
      () =>
        new RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator(
          roots,
          new DenyRetainedNativeSupervisorTopologyObservationCarrier(),
          api.signer,
          binding,
          'carrier-attempt-composition',
          () => now,
        ),
    ).toThrow('NOT_CONFIGURED');
    expect(
      () =>
        new RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator(
          roots,
          raw,
          new DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(),
          binding,
          'carrier-attempt-composition',
          () => now,
        ),
    ).toThrow('NOT_CONFIGURED');
    expect(
      () =>
        new RootResolvedRetainedNativeSupervisorTopologyObservationWorker(
          roots,
          new DenyLinuxRetainedNativeSupervisorTopologyObservationPort(),
          worker.signer,
          binding,
          () => now,
        ),
    ).toThrow('NOT_CONFIGURED');
    expect(roots.read).not.toHaveBeenCalled();
  });

  it('denies an invalid or private-looking attempt reference before root lookup', () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    const roots = new RootSource(api.root, worker.root);
    const raw = new LoopbackCarrier();
    expect(
      () =>
        new RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator(
          roots,
          raw,
          api.signer,
          binding,
          'secret-token',
          () => now,
        ),
    ).toThrow('INVALID_AUTHORIZATION');
    expect(roots.read).not.toHaveBeenCalled();
  });

  it('propagates cancellation into root lookup, closes the carrier, and performs no exchange', async () => {
    let lookupSignal: AbortSignal | undefined;
    const roots: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource = {
      read: vi.fn(async (_binding, _role, signal) => {
        lookupSignal = signal;
        return await new Promise<never>(() => undefined);
      }),
    };
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const raw = new LoopbackCarrier();
    const coordinator = new RootResolvedRetainedNativeSupervisorTopologyObservationCoordinator(
      roots,
      raw,
      api.signer,
      binding,
      'carrier-attempt-composition',
      () => now,
    );
    const cancellation = new AbortController();
    const pending = coordinator.observe(request, cancellation.signal);
    cancellation.abort();
    await expect(pending).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(lookupSignal?.aborted).toBe(true);
    expect(raw.exchange).not.toHaveBeenCalled();
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it('is one-use at both roles and preserves close-on-invalid-request', async () => {
    const { coordinator, raw } = subject();
    await expect(
      coordinator.observe(
        { ...request, observerRole: 'API_LISTENER' },
        new AbortController().signal,
      ),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(raw.close).toHaveBeenCalledOnce();
    await expect(coordinator.observe(request, new AbortController().signal)).rejects.toEqual(
      code('INVALID_AUTHORIZATION'),
    );

    const second = subject();
    await expect(second.raw.worker.handle({}, new AbortController().signal)).rejects.toEqual(
      code('INVALID_ATTESTATION'),
    );
    await expect(second.raw.worker.handle({}, new AbortController().signal)).rejects.toEqual(
      code('INVALID_AUTHORIZATION'),
    );
    expect(second.observer.observe).not.toHaveBeenCalled();
  });
});
