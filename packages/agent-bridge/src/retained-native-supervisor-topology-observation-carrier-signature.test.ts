import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler,
  AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport,
  DenyRetainedNativeSupervisorTopologyObservationCarrier,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type ClosableRetainedNativeSupervisorTopologyObservationCarrier,
} from './retained-native-supervisor-topology-observation-carrier';
import {
  DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationCarrier,
  Ed25519RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator,
  Ed25519RetainedNativeSupervisorTopologyObservationWorkerEndpoint,
  validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
  type RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
} from './retained-native-supervisor-topology-observation-carrier-signature';
import {
  linuxRetainedNativeSupervisorTopologyObservationRequestHash,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
  type LinuxRetainedNativeSupervisorTopologyObservationRequest,
} from './retained-native-supervisor-shared-runtime-topology';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER',
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
  carrierId: 'carrier-signed-one',
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
  const signerKeyId = `key:${role.toLowerCase()}:one`;
  const root = Object.freeze({
    schemaVersion: 1,
    rootRecordId: `root:${role.toLowerCase()}:one`,
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

class Observer implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  observe = vi.fn(async (input: unknown) => ({
    ...(input as LinuxRetainedNativeSupervisorTopologyObservationRequest),
    observationId: 'observation-worker-one',
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

class RawLoopbackCarrier implements ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  endpoint!: Ed25519RetainedNativeSupervisorTopologyObservationWorkerEndpoint;
  readonly close = vi.fn(async () => undefined);
  exchange = vi.fn(async (input: unknown, signal: AbortSignal) =>
    this.endpoint.handle(this.mutateRequest(input), signal),
  );

  constructor(readonly mutateRequest: (input: unknown) => unknown = (input) => input) {}
}

function subject(
  workerRootOverrides: Record<string, unknown> = {},
  apiRootOverrides: Record<string, unknown> = {},
  mutateRequest?: (input: unknown) => unknown,
) {
  const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
  const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
  const observer = new Observer();
  const authenticator =
    new Ed25519RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator(
      { ...api.root, ...apiRootOverrides },
      () => now,
    );
  const handler = new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
    observer,
    authenticator,
    binding,
    () => now,
  );
  const endpoint = new Ed25519RetainedNativeSupervisorTopologyObservationWorkerEndpoint(
    handler,
    worker.signer,
    binding,
    () => now,
  );
  const raw = new RawLoopbackCarrier(mutateRequest);
  raw.endpoint = endpoint;
  const signedCarrier = new Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationCarrier(
    raw,
    api.signer,
    { ...worker.root, ...workerRootOverrides },
    binding,
    () => now,
  );
  const transport =
    new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport(
      signedCarrier,
      binding,
      'carrier-attempt-one',
      () => now,
    );
  return { api, worker, observer, raw, transport };
}

describe('signed topology observation carrier delivery', () => {
  it('authenticates both directions over an otherwise untrusted carrier', async () => {
    const { api, worker, observer, raw, transport } = subject();
    await expect(transport.observe(request, new AbortController().signal)).resolves.toMatchObject({
      topologyState: 'VISIBLE_NOT_PROVISIONED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(api.signer.sign).toHaveBeenCalledOnce();
    expect(worker.signer.sign).toHaveBeenCalledOnce();
    expect(observer.observe).toHaveBeenCalledOnce();
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it('rejects substituted messages and signatures before worker observation', async () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    const observer = new Observer();
    const authenticator =
      new Ed25519RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator(
        api.root,
        () => now,
      );
    const message = { direction: 'COORDINATOR_TO_WORKER' };
    const evidence = {
      schemaVersion: 1,
      authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
      carrierId: binding.carrierId,
      bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
      peerPrincipalReference: binding.coordinatorPrincipalReference,
      messageHash: createHash('sha256').update(canonicalJson(message)).digest('hex'),
      deliveredAt: new Date(now).toISOString(),
      runtimeConnection: 'NOT_CONFIGURED',
    };
    const payload = {
      schemaVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
      delivery: evidence,
      message,
    };
    const proof = await api.signer.sign(payload, new AbortController().signal);
    await expect(
      authenticator.authenticate(
        { delivery: evidence, message: { ...message, extra: true }, proof },
        binding,
        binding.coordinatorPrincipalReference,
        new AbortController().signal,
      ),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it('rejects a cryptographically substituted request before worker observation', async () => {
    const mutateRequest = (input: unknown) => {
      const envelope = input as {
        delivery: unknown;
        message: unknown;
        proof: { signature: string };
      };
      return {
        ...envelope,
        proof: {
          ...envelope.proof,
          signature: `${envelope.proof.signature[0] === 'A' ? 'B' : 'A'}${envelope.proof.signature.slice(1)}`,
        },
      };
    };
    const { observer, raw, transport } = subject({}, {}, mutateRequest);
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      code('INVALID_ATTESTATION'),
    );
    expect(observer.observe).not.toHaveBeenCalled();
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'accessor-bearing',
      () => {
        const message = {};
        Object.defineProperty(message, 'direction', {
          enumerable: true,
          get: () => {
            throw new Error('must not execute');
          },
        });
        return message;
      },
    ],
    ['oversized', () => ({ direction: 'COORDINATOR_TO_WORKER', padding: 'x'.repeat(70_000) })],
  ])('rejects an %s carrier message before parsing it', async (_label, hostileMessage) => {
    const mutateRequest = (input: unknown) => ({
      ...(input as Record<string, unknown>),
      message: hostileMessage(),
    });
    const { observer, transport } = subject({}, {}, mutateRequest);
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      code('INVALID_ATTESTATION'),
    );
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong role', { principalRole: 'API_COORDINATOR' }],
    ['wrong binding', { bindingHash: 'f'.repeat(64) }],
    ['revoked root', { revokedAt: new Date(now).toISOString() }],
  ])('rejects a %s worker trust record before exchange', (_label, drift) => {
    expect(() => subject(drift)).toThrow(code('INVALID_AUTHORIZATION'));
  });

  it.each([
    ['wrong role', { principalRole: 'WORKER_CLIENT' }],
    ['wrong binding', { bindingHash: 'f'.repeat(64) }],
    ['revoked root', { revokedAt: new Date(now).toISOString() }],
  ])('rejects a %s coordinator trust record before worker observation', async (_label, drift) => {
    const { observer, transport } = subject({}, drift);
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      code('INVALID_AUTHORIZATION'),
    );
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it('rejects non-Ed25519 and test-only roots at admission', () => {
    const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
    for (const drift of [{ algorithm: 'RSA' }, { testOnly: true }]) {
      expect(() =>
        validateRetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord({
          ...api.root,
          ...drift,
        }),
      ).toThrow(code('INVALID_AUTHORIZATION'));
    }
  });

  it('denies unconfigured carrier and signer dependencies', () => {
    const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
    expect(
      () =>
        new Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationCarrier(
          new DenyRetainedNativeSupervisorTopologyObservationCarrier(),
          worker.signer,
          worker.root,
          binding,
          () => now,
        ),
    ).toThrow(code('NOT_CONFIGURED'));
    expect(
      () =>
        new Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationCarrier(
          new RawLoopbackCarrier(),
          new DenyRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(),
          worker.root,
          binding,
          () => now,
        ),
    ).toThrow(code('NOT_CONFIGURED'));
  });
});
