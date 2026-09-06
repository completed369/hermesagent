import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
  DenyRetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport,
  MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_SIGNING_RESPONSE_BYTES,
  type RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport,
} from './retained-native-supervisor-topology-observation-carrier-keyless-signer';
import { retainedNativeSupervisorTopologyObservationCarrierBindingHash } from './retained-native-supervisor-topology-observation-carrier';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER',
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
  carrierId: 'carrier-keyless-one',
  coordinatorPrincipalReference: 'service:coordinator:keyless-one',
  workerPrincipalReference: 'service:worker:keyless-one',
  workspaceId: 'workspace-keyless-one',
  supervisorInstanceId: 'supervisor-keyless-one',
  provisioningAttemptId: 'attempt-keyless-one',
  provisioningPlanHash: 'a'.repeat(64),
  issuedAt: new Date(now - 100).toISOString(),
  expiresAt: new Date(now + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED',
} as const);

type Role = 'API_COORDINATOR' | 'WORKER_CLIENT';

function code(value: string) {
  return expect.objectContaining({ code: value });
}

function payload(role: Role, drift: Record<string, unknown> = {}) {
  const message = Object.freeze({
    schemaVersion: 1,
    direction: role === 'API_COORDINATOR' ? 'COORDINATOR_TO_WORKER' : 'WORKER_TO_COORDINATOR',
    carrierAttemptId: 'carrier-attempt-keyless-one',
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    requestHash: 'b'.repeat(64),
    runtimeConnection: 'NOT_CONFIGURED',
    ...(role === 'API_COORDINATOR' ? { request: { safe: true } } : { observation: { safe: true } }),
  });
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
    delivery: {
      schemaVersion: 1,
      authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
      carrierId: binding.carrierId,
      bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
      peerPrincipalReference:
        role === 'API_COORDINATOR'
          ? binding.coordinatorPrincipalReference
          : binding.workerPrincipalReference,
      messageHash: createHash('sha256').update(canonicalJson(message)).digest('hex'),
      deliveredAt: new Date(now).toISOString(),
      runtimeConnection: 'NOT_CONFIGURED',
    },
    message,
    ...drift,
  };
}

class SigningTransport implements RetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport {
  readonly close = vi.fn(async () => undefined);
  readonly requests: Readonly<Record<string, unknown>>[] = [];

  constructor(
    private readonly privateKey: KeyObject,
    readonly mutate: (response: Record<string, unknown>) => unknown = (response) => response,
  ) {}

  readonly exchange = vi.fn(async (input: Uint8Array) => {
    const text = new TextDecoder().decode(input);
    const request = JSON.parse(text) as Record<string, unknown>;
    expect(text).toBe(canonicalJson(request));
    this.requests.push(request);
    const response = {
      protocolVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY_SIGNING_RESPONSE',
      principalRole: request.principalRole,
      principalReference: request.principalReference,
      signerKeyId: request.signerKeyId,
      carrierId: request.carrierId,
      bindingHash: request.bindingHash,
      payloadHash: request.payloadHash,
      signingRequestHash: request.signingRequestHash,
      signature: sign(null, Buffer.from(canonicalJson(request.payload)), this.privateKey).toString(
        'base64',
      ),
      runtimeConnection: 'NOT_CONFIGURED',
    };
    return new TextEncoder().encode(canonicalJson(this.mutate(response)));
  });
}

function subject(role: Role, transport?: SigningTransport, timeoutMs = 2_000) {
  const keys = generateKeyPairSync('ed25519');
  const activeTransport = transport ?? new SigningTransport(keys.privateKey);
  return {
    keys,
    transport: activeTransport,
    signer: new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
      binding,
      role,
      `signer:${role.toLowerCase()}:keyless-one`,
      activeTransport,
      () => now,
      timeoutMs,
    ),
  };
}

describe('keyless topology carrier delivery signer', () => {
  it.each(['API_COORDINATOR', 'WORKER_CLIENT'] as const)(
    'signs one exact %s payload and closes before releasing the proof',
    async (role) => {
      const { keys, transport, signer: keyless } = subject(role);
      const input = payload(role);
      const proof = await keyless.sign(input, new AbortController().signal);
      expect(proof).toMatchObject({
        algorithm: 'ED25519',
        signerKeyId: `signer:${role.toLowerCase()}:keyless-one`,
        payloadHash: createHash('sha256').update(canonicalJson(input)).digest('hex'),
      });
      expect(transport.close).toHaveBeenCalledOnce();
      expect(transport.requests[0]).toMatchObject({
        principalRole: role,
        principalReference:
          role === 'API_COORDINATOR'
            ? binding.coordinatorPrincipalReference
            : binding.workerPrincipalReference,
        carrierId: binding.carrierId,
        bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
        runtimeConnection: 'NOT_CONFIGURED',
      });
      expect(
        verify(
          null,
          Buffer.from(canonicalJson(input)),
          keys.publicKey,
          Buffer.from((proof as { signature: string }).signature, 'base64'),
        ),
      ).toBe(true);
      await expect(keyless.sign(input, new AbortController().signal)).rejects.toEqual(
        code('INVALID_AUTHORIZATION'),
      );
      expect(transport.close).toHaveBeenCalledOnce();
    },
  );

  it('denies role, principal, binding, direction, hash, time, and runtime drift before exchange', async () => {
    const cases: unknown[] = [
      payload('API_COORDINATOR', { schemaVersion: 2 }),
      {
        ...payload('API_COORDINATOR'),
        delivery: { ...payload('API_COORDINATOR').delivery, carrierId: 'carrier-other' },
      },
      {
        ...payload('API_COORDINATOR'),
        delivery: {
          ...payload('API_COORDINATOR').delivery,
          peerPrincipalReference: binding.workerPrincipalReference,
        },
      },
      {
        ...payload('API_COORDINATOR'),
        delivery: { ...payload('API_COORDINATOR').delivery, messageHash: '0'.repeat(64) },
      },
      {
        ...payload('API_COORDINATOR'),
        delivery: {
          ...payload('API_COORDINATOR').delivery,
          deliveredAt: binding.expiresAt,
        },
      },
      {
        ...payload('API_COORDINATOR'),
        delivery: { ...payload('API_COORDINATOR').delivery, runtimeConnection: 'CONNECTED' },
      },
      {
        ...payload('API_COORDINATOR'),
        message: { ...payload('API_COORDINATOR').message, direction: 'WORKER_TO_COORDINATOR' },
      },
    ];
    for (const input of cases) {
      const { signer: keyless, transport } = subject('API_COORDINATOR');
      await expect(keyless.sign(input, new AbortController().signal)).rejects.toEqual(
        code('INVALID_ATTESTATION'),
      );
      expect(transport.exchange).not.toHaveBeenCalled();
      expect(transport.close).toHaveBeenCalledOnce();
    }
  });

  it('denies non-canonical, substituted, malformed, and oversized signing responses', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const mutations: ((response: Record<string, unknown>) => unknown)[] = [
      (response) => ({ ...response, signerKeyId: 'signer:substituted' }),
      (response) => ({ ...response, payloadHash: '0'.repeat(64) }),
      (response) => ({ ...response, signingRequestHash: '0'.repeat(64) }),
      (response) => ({ ...response, runtimeConnection: 'CONNECTED' }),
      (response) => ({ ...response, signature: 'invalid' }),
      (response) => ({ ...response, extra: true }),
    ];
    for (const mutate of mutations) {
      const transport = new SigningTransport(privateKey, mutate);
      const { signer: keyless } = subject('API_COORDINATOR', transport);
      await expect(
        keyless.sign(payload('API_COORDINATOR'), new AbortController().signal),
      ).rejects.toEqual(code('INVALID_ATTESTATION'));
      expect(transport.close).toHaveBeenCalledOnce();
    }

    const oversized = {
      exchange: vi.fn(
        async () => new Uint8Array(MAX_RETAINED_NATIVE_TOPOLOGY_CARRIER_SIGNING_RESPONSE_BYTES + 1),
      ),
      close: vi.fn(async () => undefined),
    };
    const keyless =
      new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
        binding,
        'API_COORDINATOR',
        'signer:api:oversized',
        oversized,
        () => now,
      );
    await expect(
      keyless.sign(payload('API_COORDINATOR'), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(oversized.close).toHaveBeenCalledOnce();

    const sensitive = {
      exchange: vi.fn(async (input: Uint8Array) => {
        const request = JSON.parse(new TextDecoder().decode(input)) as Record<string, unknown>;
        const response = {
          protocolVersion: 1,
          purpose:
            'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY_SIGNING_RESPONSE',
          principalRole: request.principalRole,
          principalReference: request.principalReference,
          signerKeyId: 'api:key',
          carrierId: request.carrierId,
          bindingHash: request.bindingHash,
          payloadHash: request.payloadHash,
          signingRequestHash: request.signingRequestHash,
          signature: `${'A'.repeat(86)}==`,
          runtimeConnection: 'NOT_CONFIGURED',
        };
        const sorted = Object.fromEntries(
          Object.entries(response).sort(([left], [right]) => left.localeCompare(right)),
        );
        return new TextEncoder().encode(JSON.stringify(sorted));
      }),
      close: vi.fn(async () => undefined),
    };
    const sensitiveSigner =
      new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
        binding,
        'API_COORDINATOR',
        'signer:coordinator:sensitive-response',
        sensitive,
        () => now,
      );
    await expect(
      sensitiveSigner.sign(payload('API_COORDINATOR'), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(sensitive.close).toHaveBeenCalledOnce();
  });

  it('propagates cancellation, bounds a non-cooperating exchange, and closes', async () => {
    let exchangeSignal: AbortSignal | undefined;
    const blocked = {
      exchange: vi.fn(async (_input: Uint8Array, signal: AbortSignal) => {
        exchangeSignal = signal;
        return await new Promise<never>(() => undefined);
      }),
      close: vi.fn(async () => undefined),
    };
    const cancelled =
      new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
        binding,
        'API_COORDINATOR',
        'signer:api:cancelled',
        blocked,
        () => now,
        100,
      );
    const cancellation = new AbortController();
    const pending = cancelled.sign(payload('API_COORDINATOR'), cancellation.signal);
    cancellation.abort();
    await expect(pending).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(exchangeSignal?.aborted).toBe(true);
    expect(blocked.close).toHaveBeenCalledOnce();

    const timedOut =
      new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
        binding,
        'API_COORDINATOR',
        'signer:api:timeout',
        blocked,
        () => now,
        100,
      );
    await expect(
      timedOut.sign(payload('API_COORDINATOR'), new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(blocked.close).toHaveBeenCalledTimes(2);
  });

  it('normalizes synchronous exchange failure and withholds a response when close fails', async () => {
    const throwing = {
      exchange: vi.fn(() => {
        throw new Error('untrusted signing transport detail');
      }),
      close: vi.fn(async () => undefined),
    };
    const failed =
      new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
        binding,
        'WORKER_CLIENT',
        'signer:worker:throwing',
        throwing,
        () => now,
      );
    await expect(
      failed.sign(payload('WORKER_CLIENT'), new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(throwing.close).toHaveBeenCalledOnce();

    const { privateKey } = generateKeyPairSync('ed25519');
    const transport = new SigningTransport(privateKey);
    transport.close.mockImplementationOnce(async () => {
      throw new Error('untrusted close detail');
    });
    const { signer: keyless } = subject('WORKER_CLIENT', transport);
    await expect(
      keyless.sign(payload('WORKER_CLIENT'), new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));
  });

  it('bounds non-cooperating close and withholds proof after carrier authority expires', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const blockedClose = new SigningTransport(privateKey);
    blockedClose.close.mockImplementationOnce(
      async () => await new Promise<never>(() => undefined),
    );
    const bounded =
      new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
        binding,
        'API_COORDINATOR',
        'signer:coordinator:blocked-close',
        blockedClose,
        () => now,
        100,
      );
    await expect(
      bounded.sign(payload('API_COORDINATOR'), new AbortController().signal),
    ).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(blockedClose.close).toHaveBeenCalledOnce();

    let current = now;
    const expiresDuringAttempt = new SigningTransport(privateKey);
    expiresDuringAttempt.close.mockImplementationOnce(async () => {
      current = Date.parse(binding.expiresAt);
    });
    const expiring =
      new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
        binding,
        'API_COORDINATOR',
        'signer:coordinator:expiring',
        expiresDuringAttempt,
        () => current,
      );
    await expect(
      expiring.sign(payload('API_COORDINATOR'), new AbortController().signal),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(expiresDuringAttempt.close).toHaveBeenCalledOnce();
  });

  it('rejects deny-default transport and closes even when input is already invalid', async () => {
    expect(
      () =>
        new BoundedKeylessRetainedNativeSupervisorTopologyObservationCarrierDeliverySigner(
          binding,
          'API_COORDINATOR',
          'signer:api:deny',
          new DenyRetainedNativeSupervisorTopologyObservationCarrierKeylessSigningTransport(),
          () => now,
        ),
    ).toThrow(code('NOT_CONFIGURED'));

    const { signer: keyless, transport } = subject('API_COORDINATOR');
    await expect(keyless.sign({ unsafe: true }, new AbortController().signal)).rejects.toEqual(
      code('INVALID_ATTESTATION'),
    );
    expect(transport.exchange).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
  });
});
