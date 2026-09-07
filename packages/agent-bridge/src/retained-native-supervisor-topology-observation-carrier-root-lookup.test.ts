import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import { retainedNativeSupervisorTopologyObservationCarrierBindingHash } from './retained-native-supervisor-topology-observation-carrier';
import {
  BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource,
  DenyRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport,
  type RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization,
} from './retained-native-supervisor-topology-observation-carrier-root-lookup';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER',
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
  carrierId: 'carrier-worker-root-lookup',
  coordinatorPrincipalReference: 'service:api:root-lookup',
  workerPrincipalReference: 'service:worker:root-lookup',
  workspaceId: 'workspace-root-lookup',
  supervisorInstanceId: 'supervisor-root-lookup',
  provisioningAttemptId: 'attempt-root-lookup',
  provisioningPlanHash: 'a'.repeat(64),
  issuedAt: new Date(now - 100).toISOString(),
  expiresAt: new Date(now + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED',
} as const);

function root(overrides: Record<string, unknown> = {}) {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({
    format: 'der',
    type: 'spki',
  });
  return {
    schemaVersion: 1,
    rootRecordId: 'root:api:lookup',
    rootRecordVersion: 1,
    signerKeyId: 'key:api:lookup',
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
    principalRole: 'API_COORDINATOR',
    principalReference: binding.coordinatorPrincipalReference,
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    publicKeySpkiBase64: publicKey.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(publicKey).digest('hex'),
    validFrom: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 10_000).toISOString(),
    revokedAt: null,
    testOnly: false,
    ...overrides,
  };
}

function response(request: Record<string, unknown>, value: unknown = root(), overrides = {}) {
  return new TextEncoder().encode(
    canonicalJson({
      protocolVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_ROOT_LOOKUP_RESPONSE',
      requesterPrincipalRole: request.requesterPrincipalRole,
      requesterPrincipalReference: request.requesterPrincipalReference,
      requestedPrincipalRole: request.requestedPrincipalRole,
      requestedPrincipalReference: request.requestedPrincipalReference,
      carrierId: request.carrierId,
      bindingHash: request.bindingHash,
      challenge: request.challenge,
      requestHash: createHash('sha256').update(canonicalJson(request)).digest('hex'),
      root: value,
      runtimeConnection: 'NOT_CONFIGURED',
      ...overrides,
    }),
  );
}

class Transport implements RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport {
  readonly close = vi.fn(async (): Promise<void> => undefined);
  readonly exchange = vi.fn(
    async (
      bytes: Uint8Array,
      _authorization: Readonly<RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransportAuthorization>,
      _signal: AbortSignal,
    ) => {
      const request = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      return this.produce(request);
    },
  );

  constructor(
    readonly produce: (request: Record<string, unknown>) => unknown = (request) =>
      response(request),
  ) {}
}

function subject<T extends RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport>(
  transport: T,
  clock: () => number = () => now,
  timeoutMs = 2_000,
) {
  return {
    source:
      new BoundedMutuallyAuthenticatedRetainedNativeSupervisorTopologyObservationCarrierWorkerRootSource(
        binding,
        transport,
        clock,
        timeoutMs,
      ),
    transport,
  };
}

function code(value: string) {
  return expect.objectContaining({ code: value });
}

describe('bounded mutually authenticated worker topology root source', () => {
  it('fetches one exact coordinator root with independent transport identity and closes before release', async () => {
    const { source, transport } = subject(new Transport());
    await expect(
      source.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).resolves.toMatchObject({
      principalRole: 'API_COORDINATOR',
      principalReference: binding.coordinatorPrincipalReference,
      revokedAt: null,
    });
    expect(transport.exchange).toHaveBeenCalledOnce();
    const [bytes, authorization] = transport.exchange.mock.calls[0]!;
    const request = JSON.parse(new TextDecoder().decode(bytes));
    expect(request).toMatchObject({
      requesterPrincipalRole: 'WORKER_CLIENT',
      requestedPrincipalRole: 'API_COORDINATOR',
      binding,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(request.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(authorization).toEqual({
      authority: 'INDEPENDENT_MUTUALLY_AUTHENTICATED_CROSS_ROLE_TRANSPORT',
      localPrincipalRole: 'WORKER_CLIENT',
      localPrincipalReference: binding.workerPrincipalReference,
      peerPrincipalRole: 'API_COORDINATOR',
      peerPrincipalReference: binding.coordinatorPrincipalReference,
      carrierId: binding.carrierId,
      bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
      notAfter: binding.expiresAt,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('does not release the root until transport close finishes', async () => {
    let releaseClose!: () => void;
    const transport = new Transport();
    transport.close.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseClose = resolve)),
    );
    const { source } = subject(transport);
    const pending = source.read(binding, 'API_COORDINATOR', new AbortController().signal);
    await vi.waitFor(() => expect(transport.close).toHaveBeenCalledOnce());
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseClose();
    await expect(pending).resolves.toMatchObject({ principalRole: 'API_COORDINATOR' });
  });

  it.each([
    ['wrong requested role', 'WORKER_CLIENT', binding, 'INVALID_AUTHORIZATION'],
    [
      'changed binding',
      'API_COORDINATOR',
      { ...binding, carrierId: 'carrier-other' },
      'INVALID_AUTHORIZATION',
    ],
  ])('denies %s and still consumes and closes', async (_name, role, candidate, expected) => {
    const { source, transport } = subject(new Transport());
    await expect(
      source.read(
        candidate as typeof binding,
        role as 'API_COORDINATOR',
        new AbortController().signal,
      ),
    ).rejects.toEqual(code(expected));
    expect(transport.exchange).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
    await expect(
      source.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
  });

  it.each([
    ['challenge replay', (_request: Record<string, unknown>) => ({ challenge: 'A'.repeat(43) })],
    [
      'request hash drift',
      (_request: Record<string, unknown>) => ({ requestHash: 'b'.repeat(64) }),
    ],
    [
      'runtime promotion',
      (_request: Record<string, unknown>) => ({ runtimeConnection: 'CONNECTED' }),
    ],
    [
      'role drift',
      (_request: Record<string, unknown>) => ({ requestedPrincipalRole: 'WORKER_CLIENT' }),
    ],
  ])('denies malformed response scope: %s', async (_name, mutate) => {
    const transport = new Transport((request) => response(request, root(), mutate(request)));
    const { source } = subject(transport);
    await expect(
      source.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong root role', { principalRole: 'WORKER_CLIENT' }],
    ['wrong root principal', { principalReference: 'service:api:other' }],
    ['wrong binding', { bindingHash: 'b'.repeat(64) }],
    ['revoked root', { revokedAt: new Date(now).toISOString() }],
    ['late root start', { validFrom: new Date(now).toISOString() }],
    ['early root end', { validUntil: new Date(now + 1_000).toISOString() }],
    ['malformed public key', { publicKeySpkiBase64: 'not-a-public-key' }],
  ])('denies invalid coordinator root scope: %s', async (_name, overrides) => {
    const transport = new Transport((request) => response(request, root(overrides)));
    const { source } = subject(transport);
    await expect(
      source.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('propagates cancellation and withholds a late response', async () => {
    let release!: (value: unknown) => void;
    const transport = new Transport(() => new Promise((resolve) => (release = resolve)));
    const { source } = subject(transport);
    const controller = new AbortController();
    const pending = source.read(binding, 'API_COORDINATOR', controller.signal);
    controller.abort();
    await expect(pending).rejects.toEqual(code('EXCHANGE_DENIED'));
    release(new Uint8Array());
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('withholds a root when the binding expires during exchange or close', async () => {
    let current = now;
    const transport = new Transport((request) => {
      current = Date.parse(binding.expiresAt);
      return response(request);
    });
    const { source } = subject(transport, () => current);
    await expect(
      source.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('fails closed on transport, close, timeout, oversized and non-canonical responses', async () => {
    const cases: Array<
      [RetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport, string]
    > = [
      [
        new Transport(() => {
          throw new Error('transport detail');
        }),
        'EXCHANGE_DENIED',
      ],
      [
        Object.assign(new Transport(), {
          close: vi.fn(async () => {
            throw new Error('close detail');
          }),
        }),
        'EXCHANGE_DENIED',
      ],
      [new Transport(() => new Promise<never>(() => undefined)), 'EXCHANGE_DENIED'],
      [new Transport(() => new Uint8Array(4 * 1_024 + 1)), 'INVALID_ATTESTATION'],
      [
        new Transport((request) =>
          new TextEncoder().encode(
            JSON.stringify({ z: 1, ...JSON.parse(new TextDecoder().decode(response(request))) }),
          ),
        ),
        'INVALID_ATTESTATION',
      ],
    ];
    for (const [transport, expected] of cases) {
      const { source } = subject(transport, () => now, 100);
      await expect(
        source.read(binding, 'API_COORDINATOR', new AbortController().signal),
      ).rejects.toEqual(code(expected));
    }
  });

  it('rejects the deny transport before use', () => {
    expect(() =>
      subject(new DenyRetainedNativeSupervisorTopologyObservationCarrierRootLookupTransport()),
    ).toThrow(code('NOT_CONFIGURED'));
  });
});
