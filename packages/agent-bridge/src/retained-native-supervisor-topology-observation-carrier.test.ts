import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler,
  AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport,
  DenyRetainedNativeSupervisorTopologyObservationCarrier,
  DenyRetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type ClosableRetainedNativeSupervisorTopologyObservationCarrier,
  type RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator,
} from './retained-native-supervisor-topology-observation-carrier';
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
  carrierId: 'carrier-one',
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

function hash(input: unknown) {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function delivery(message: unknown, peerPrincipalReference: string, overrides = {}) {
  return {
    schemaVersion: 1,
    authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
    carrierId: binding.carrierId,
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    peerPrincipalReference,
    messageHash: hash(message),
    deliveredAt: new Date(now).toISOString(),
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

function observation(input: LinuxRetainedNativeSupervisorTopologyObservationRequest) {
  return {
    ...input,
    observationId: 'observation-worker-one',
    requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(input),
    evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS',
    principalAuthority: 'LINUX_EFFECTIVE_IDENTITY',
    observerUid: input.runtimeRootParentOwnerUid,
    observerGid: input.runtimeRootParentOwnerGid,
    observedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 3_000).toISOString(),
    topologyState: 'VISIBLE_NOT_PROVISIONED',
  };
}

class Observer implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  observe = vi.fn(async (input: unknown) =>
    observation(input as LinuxRetainedNativeSupervisorTopologyObservationRequest),
  );
}

class InboundAuthenticator implements RetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator {
  authenticate = vi.fn(async (input: unknown) => input);
}

class LoopbackCarrier implements ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  readonly close = vi.fn(async () => undefined);
  exchange = vi.fn(async (message: unknown, signal: AbortSignal) => {
    const response = await this.handler.handle(
      { delivery: delivery(message, binding.coordinatorPrincipalReference), message },
      signal,
    );
    return {
      delivery: delivery(response, binding.workerPrincipalReference),
      message: response,
    };
  });

  constructor(
    readonly handler: AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler,
  ) {}
}

function subject() {
  const observer = new Observer();
  const authenticator = new InboundAuthenticator();
  const handler = new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
    observer,
    authenticator,
    binding,
    () => now,
  );
  const carrier = new LoopbackCarrier(handler);
  const transport =
    new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport(
      carrier,
      binding,
      'carrier-attempt-one',
      () => now,
    );
  return { observer, authenticator, handler, carrier, transport };
}

function code(value: string) {
  return expect.objectContaining({ code: value });
}

describe('authenticated cross-container topology observation carrier', () => {
  it('carries one exact worker observation and closes the carrier', async () => {
    const { observer, carrier, transport } = subject();
    await expect(transport.observe(request, new AbortController().signal)).resolves.toMatchObject({
      observerRole: 'WORKER_CLIENT',
      requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
      topologyState: 'VISIBLE_NOT_PROVISIONED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(observer.observe).toHaveBeenCalledOnce();
    expect(carrier.exchange).toHaveBeenCalledOnce();
    expect(carrier.close).toHaveBeenCalledOnce();
  });

  it('denies unconfigured dependencies and expired or oversized bindings', () => {
    expect(
      () =>
        new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport(
          new DenyRetainedNativeSupervisorTopologyObservationCarrier(),
          binding,
          'attempt',
          () => now,
        ),
    ).toThrow(code('NOT_CONFIGURED'));
    expect(
      () =>
        new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
          new DenyLinuxRetainedNativeSupervisorTopologyObservationPort(),
          new InboundAuthenticator(),
          binding,
          () => now,
        ),
    ).toThrow(code('NOT_CONFIGURED'));
    expect(
      () =>
        new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
          new Observer(),
          new DenyRetainedNativeSupervisorTopologyObservationCarrierInboundAuthenticator(),
          binding,
          () => now,
        ),
    ).toThrow(code('NOT_CONFIGURED'));
    expect(
      () =>
        new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
          new Observer(),
          new InboundAuthenticator(),
          { ...binding, expiresAt: new Date(now).toISOString() },
          () => now,
        ),
    ).toThrow(code('INVALID_AUTHORIZATION'));
    expect(
      () =>
        new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
          new Observer(),
          new InboundAuthenticator(),
          { ...binding, issuedAt: new Date(now - 6_000).toISOString() },
          () => now,
        ),
    ).toThrow(code('INVALID_AUTHORIZATION'));
  });

  it('denies non-worker role and cross-scope drift before carrier exchange', async () => {
    for (const drift of [
      { observerRole: 'API_LISTENER' },
      { workspaceId: 'workspace-two' },
      { supervisorInstanceId: 'supervisor-two' },
      { provisioningPlanHash: 'c'.repeat(64) },
    ]) {
      const { carrier, transport } = subject();
      await expect(
        transport.observe({ ...request, ...drift }, new AbortController().signal),
      ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
      expect(carrier.exchange).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['wrong coordinator peer', { peerPrincipalReference: 'service:api:other' }],
    ['wrong carrier', { carrierId: 'carrier-other' }],
    ['wrong binding', { bindingHash: 'c'.repeat(64) }],
    ['message substitution', { messageHash: 'd'.repeat(64) }],
    ['late delivery', { deliveredAt: binding.expiresAt }],
  ])('worker denies %s before observing', async (_label, drift) => {
    const observer = new Observer();
    const handler =
      new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
        observer,
        new InboundAuthenticator(),
        binding,
        () => now,
      );
    const message = {
      schemaVersion: 1,
      direction: 'COORDINATOR_TO_WORKER',
      carrierAttemptId: 'attempt-one',
      bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
      requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
      request,
      runtimeConnection: 'NOT_CONFIGURED',
    };
    await expect(
      handler.handle(
        { delivery: delivery(message, binding.coordinatorPrincipalReference, drift), message },
        new AbortController().signal,
      ),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong worker peer', { peerPrincipalReference: 'service:worker:other' }],
    ['wrong message hash', { messageHash: 'd'.repeat(64) }],
    ['late result', { deliveredAt: binding.expiresAt }],
  ])('coordinator denies %s and closes', async (_label, drift) => {
    const { carrier, transport } = subject();
    carrier.exchange.mockImplementationOnce(async (message, signal) => {
      const response = await carrier.handler.handle(
        { delivery: delivery(message, binding.coordinatorPrincipalReference), message },
        signal,
      );
      return {
        delivery: delivery(response, binding.workerPrincipalReference, drift),
        message: response,
      };
    });
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      code('INVALID_ATTESTATION'),
    );
    expect(carrier.close).toHaveBeenCalledOnce();
  });

  it('denies response-envelope substitution even with matching delivery evidence', async () => {
    const { carrier, transport } = subject();
    carrier.exchange.mockImplementationOnce(async (message, signal) => {
      const response = await carrier.handler.handle(
        { delivery: delivery(message, binding.coordinatorPrincipalReference), message },
        signal,
      );
      const substituted = { ...response, carrierAttemptId: 'attempt-other' };
      return {
        delivery: delivery(substituted, binding.workerPrincipalReference),
        message: substituted,
      };
    });
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      code('INVALID_ATTESTATION'),
    );
    expect(carrier.close).toHaveBeenCalledOnce();
  });

  it('denies an observation whose freshness exceeds the carrier grant', async () => {
    const observer = new Observer();
    observer.observe.mockResolvedValue({
      ...observation(request),
      validUntil: new Date(now + 5_000).toISOString(),
    });
    const handler =
      new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
        observer,
        new InboundAuthenticator(),
        binding,
        () => now,
      );
    const carrier = new LoopbackCarrier(handler);
    const transport =
      new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationTransport(
        carrier,
        binding,
        'carrier-attempt-one',
        () => now,
      );
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      code('INVALID_ATTESTATION'),
    );
    expect(carrier.close).toHaveBeenCalledOnce();
  });

  it('propagates cancellation immediately and closes a stuck carrier', async () => {
    const { carrier, transport } = subject();
    carrier.exchange.mockImplementationOnce(
      async (_message, signal) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        }),
    );
    const controller = new AbortController();
    const pending = transport.observe(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toEqual(code('EXCHANGE_DENIED'));
    expect(carrier.close).toHaveBeenCalledOnce();
  });

  it('denies clock rollback before the worker observer is reached', async () => {
    const observer = new Observer();
    const times = [now, now, now - 1];
    const handler =
      new AuthenticatedCrossContainerRetainedNativeSupervisorTopologyObservationHandler(
        observer,
        new InboundAuthenticator(),
        binding,
        () => times.shift() ?? now,
      );
    const message = {
      schemaVersion: 1,
      direction: 'COORDINATOR_TO_WORKER',
      carrierAttemptId: 'attempt-one',
      bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
      requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
      request,
      runtimeConnection: 'NOT_CONFIGURED',
    };
    await expect(
      handler.handle(
        { delivery: delivery(message, binding.coordinatorPrincipalReference), message },
        new AbortController().signal,
      ),
    ).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it('denies replay at both coordinator and worker boundaries', async () => {
    const { handler, transport } = subject();
    await transport.observe(request, new AbortController().signal);
    await expect(transport.observe(request, new AbortController().signal)).rejects.toEqual(
      code('CONCURRENT_EXCHANGE'),
    );
    await expect(handler.handle({}, new AbortController().signal)).rejects.toEqual(
      code('CONCURRENT_EXCHANGE'),
    );
  });

  it('captures carrier and observer methods before asynchronous work', async () => {
    const { observer, authenticator, carrier, transport } = subject();
    carrier.exchange = vi.fn(async () => {
      throw new Error('substituted');
    });
    observer.observe = vi.fn(async () => {
      throw new Error('substituted');
    });
    authenticator.authenticate = vi.fn(async () => {
      throw new Error('substituted');
    });
    await expect(transport.observe(request, new AbortController().signal)).resolves.toMatchObject({
      observerRole: 'WORKER_CLIENT',
    });
  });
});
