import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import { retainedNativeSupervisorTopologyObservationCarrierBindingHash } from './retained-native-supervisor-topology-observation-carrier';
import {
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
} from './retained-native-supervisor-topology-observation-carrier-root-lookup';
import {
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupInboundAuthorization,
} from './retained-native-supervisor-topology-observation-carrier-root-lookup-handler';
import {
  DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource,
} from './retained-native-supervisor-topology-observation-carrier-composition';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER',
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
  carrierId: 'carrier-root-handler',
  coordinatorPrincipalReference: 'service:api:root-handler',
  workerPrincipalReference: 'service:worker:root-handler',
  workspaceId: 'workspace-root-handler',
  supervisorInstanceId: 'supervisor-root-handler',
  provisioningAttemptId: 'attempt-root-handler',
  provisioningPlanHash: 'a'.repeat(64),
  issuedAt: new Date(now - 100).toISOString(),
  expiresAt: new Date(now + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED',
} as const);
const bindingHash = retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding);

function root(overrides: Record<string, unknown> = {}) {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({
    format: 'der',
    type: 'spki',
  });
  return {
    schemaVersion: 1,
    rootRecordId: 'root:api:handler',
    rootRecordVersion: 1,
    signerKeyId: 'key:api:handler',
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
    principalRole: 'API_COORDINATOR',
    principalReference: binding.coordinatorPrincipalReference,
    bindingHash,
    publicKeySpkiBase64: publicKey.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(publicKey).digest('hex'),
    validFrom: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 10_000).toISOString(),
    revokedAt: null,
    testOnly: false,
    ...overrides,
  };
}

function authorization(
  overrides: Partial<RetainedNativeSupervisorTopologyObservationCarrierRootLookupInboundAuthorization> = {},
) {
  return {
    authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT',
    localPrincipalRole: 'API_COORDINATOR',
    localPrincipalReference: binding.coordinatorPrincipalReference,
    peerPrincipalRole: 'WORKER_CLIENT',
    peerPrincipalReference: binding.workerPrincipalReference,
    carrierId: binding.carrierId,
    bindingHash,
    authenticatedAt: new Date(now).toISOString(),
    notAfter: binding.expiresAt,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  } as const;
}

class RootSource implements RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource {
  readonly read = vi.fn(async (): Promise<unknown> => root());
}

function code(value: string) {
  return expect.objectContaining({ code: value });
}

function request(overrides: Record<string, unknown> = {}) {
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
    challenge: Buffer.alloc(32, 7).toString('base64url'),
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

function bytes(value: unknown = request()) {
  return new TextEncoder().encode(canonicalJson(value));
}

describe('authenticated topology carrier root lookup handler', () => {
  it('completes the worker protocol using independent inbound identity and the exact coordinator root', async () => {
    const roots = new RootSource();
    const handler =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        roots,
        () => now,
      );
    const transport: RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport = {
      async exchange(input, outbound, signal) {
        expect(outbound).toMatchObject({
          localPrincipalRole: 'WORKER_CLIENT',
          peerPrincipalRole: 'API_COORDINATOR',
          carrierId: binding.carrierId,
          bindingHash,
          runtimeConnection: 'NOT_CONFIGURED',
        });
        return handler.handle(input, authorization(), signal);
      },
      async close() {},
    };
    const worker =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
        binding,
        transport,
        () => now,
      );

    await expect(
      worker.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).resolves.toMatchObject({
      principalRole: 'API_COORDINATOR',
      principalReference: binding.coordinatorPrincipalReference,
      bindingHash,
      revokedAt: null,
    });
    expect(roots.read).toHaveBeenCalledWith(binding, 'API_COORDINATOR', expect.any(AbortSignal));
    expect(roots.read).toHaveBeenCalledOnce();
  });

  it('denies sideband role, peer, carrier, binding, time, runtime, and shape drift before lookup', async () => {
    const mutations: Record<string, unknown>[] = [
      { localPrincipalRole: 'WORKER_CLIENT' },
      { localPrincipalReference: 'service:api:other' },
      { peerPrincipalRole: 'API_COORDINATOR' },
      { peerPrincipalReference: 'service:worker:other' },
      { carrierId: 'carrier-other' },
      { bindingHash: '0'.repeat(64) },
      { authenticatedAt: new Date(now + 1).toISOString() },
      { authenticatedAt: new Date(now - 101).toISOString() },
      { authenticatedAt: '2030-01-01T12:00:00Z' },
      { authenticatedAt: { toString: () => new Date(now).toISOString() } },
      { notAfter: new Date(now + 3_999).toISOString() },
      { notAfter: null },
      { runtimeConnection: 'CONNECTED' },
      { extra: true },
    ];
    for (const mutation of mutations) {
      const roots = new RootSource();
      const handler =
        new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
          binding,
          roots,
          () => now,
        );
      await expect(
        handler.handle(bytes(), { ...authorization(), ...mutation }, new AbortController().signal),
      ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
      expect(roots.read).not.toHaveBeenCalled();
    }
  });

  it('denies request scope, binding, challenge, runtime, canonical, and framing drift before lookup', async () => {
    const mutations: Record<string, unknown>[] = [
      { requesterPrincipalRole: 'API_COORDINATOR' },
      { requesterPrincipalReference: 'service:worker:other' },
      { requestedPrincipalRole: 'WORKER_CLIENT' },
      { requestedPrincipalReference: 'service:api:other' },
      { carrierId: 'carrier-other' },
      { bindingHash: '0'.repeat(64) },
      { binding: { ...binding, provisioningAttemptId: 'attempt-other' } },
      { challenge: 'not-a-challenge' },
      { runtimeConnection: 'CONNECTED' },
      { extra: true },
    ];
    for (const mutation of mutations) {
      const roots = new RootSource();
      const handler =
        new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
          binding,
          roots,
          () => now,
        );
      await expect(
        handler.handle(bytes(request(mutation)), authorization(), new AbortController().signal),
      ).rejects.toEqual(code('INVALID_ATTESTATION'));
      expect(roots.read).not.toHaveBeenCalled();
    }

    const roots = new RootSource();
    const nonCanonical = new TextEncoder().encode(JSON.stringify(request(), null, 1));
    await expect(
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        roots,
        () => now,
      ).handle(nonCanonical, authorization(), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(roots.read).not.toHaveBeenCalled();

    const oversizedRoots = new RootSource();
    await expect(
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        oversizedRoots,
        () => now,
      ).handle(new Uint8Array(2 * 1_024 + 1), authorization(), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(oversizedRoots.read).not.toHaveBeenCalled();
  });

  it('denies malformed, substituted, revoked, or under-scoped roots', async () => {
    const candidates = [
      { unsafe: true },
      root({ principalRole: 'WORKER_CLIENT' }),
      root({ principalReference: binding.workerPrincipalReference }),
      root({ bindingHash: '0'.repeat(64) }),
      root({ revokedAt: new Date(now).toISOString() }),
      root({ validFrom: new Date(now).toISOString() }),
      root({ validUntil: new Date(now + 3_999).toISOString() }),
    ];
    for (const candidate of candidates) {
      const roots = new RootSource();
      roots.read.mockResolvedValueOnce(candidate);
      const handler =
        new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
          binding,
          roots,
          () => now,
        );
      await expect(
        handler.handle(bytes(), authorization(), new AbortController().signal),
      ).rejects.toEqual(code('INVALID_ATTESTATION'));
    }
  });

  it('propagates cancellation, bounds lookup, and withholds a response after binding expiry', async () => {
    let lookupSignal: AbortSignal | undefined;
    const blocked: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource = {
      async read(_binding, _role, signal) {
        lookupSignal = signal;
        return await new Promise<never>(() => undefined);
      },
    };
    const cancelled =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        blocked,
        () => now,
        100,
      );
    const cancellation = new AbortController();
    const pending = cancelled.handle(bytes(), authorization(), cancellation.signal);
    cancellation.abort();
    await expect(pending).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(lookupSignal?.aborted).toBe(true);

    await expect(
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        blocked,
        () => now,
        100,
      ).handle(bytes(), authorization(), new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));

    let current = now;
    const expiring = new RootSource();
    expiring.read.mockImplementationOnce(async () => {
      current = Date.parse(binding.expiresAt);
      return root();
    });
    await expect(
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        expiring,
        () => current,
      ).handle(bytes(), authorization(), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
  });

  it('normalizes source failure and consumes every attempted handler', async () => {
    const failing: RetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource = {
      async read() {
        throw new Error('untrusted registry detail');
      },
    };
    await expect(
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        failing,
        () => now,
      ).handle(bytes(), authorization(), new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));

    const roots = new RootSource();
    const handler =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        roots,
        () => now,
      );
    await handler.handle(bytes(), authorization(), new AbortController().signal);
    await expect(
      handler.handle(bytes(), authorization(), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(roots.read).toHaveBeenCalledOnce();
  });

  it('rejects deny-default sources and invalid signals without querying a root', async () => {
    expect(
      () =>
        new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
          binding,
          new DenyRetainedNativeSupervisorTopologyObservationCarrierSignatureRootSource(),
          () => now,
        ),
    ).toThrow(code('NOT_CONFIGURED'));

    const roots = new RootSource();
    const handler =
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierRootLookupHandler(
        binding,
        roots,
        () => now,
      );
    await expect(handler.handle(bytes(), authorization(), null as never)).rejects.toEqual(
      code('EXCHANGE_DENIED'),
    );
    expect(roots.read).not.toHaveBeenCalled();
  });
});
