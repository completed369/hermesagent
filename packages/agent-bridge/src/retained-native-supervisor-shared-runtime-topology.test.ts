import { describe, expect, it, vi } from 'vitest';

import {
  BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler,
  DenyLinuxRetainedNativeSupervisorTopologyObservationPort,
  linuxRetainedNativeSupervisorTopologyObservationRequestHash,
  type LinuxRetainedNativeSupervisorTopologyObservationPort,
  type LinuxRetainedNativeSupervisorTopologyObservationRequest,
} from './retained-native-supervisor-shared-runtime-topology';
import type { LinuxRetainedNativeSupervisorProvisioningPlan } from './retained-native-supervisor-provisioning-controller';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const plan: LinuxRetainedNativeSupervisorProvisioningPlan = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING',
  runtimeRootRequest: Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION',
    workspaceId: 'workspace-one',
    supervisorInstanceId: 'supervisor-one',
    provisioningAttemptId: 'attempt-0001',
    platform: 'LINUX',
    architecture: 'X64',
    runtimeRootParent: '/var/lib/ventureos/runtime/workspace-one/supervisor-one',
    runtimeRootParentIdentityReference: 'linux:dev-a:ino-10',
    runtimeRootParentOwnerUid: 65532,
    runtimeRootParentOwnerGid: 65532,
    runtimeRootParentMode: 0o700,
    runtimeRoot: '/var/lib/ventureos/runtime/workspace-one/supervisor-one/attempt-0001',
    ownerUid: 65532,
    ownerGid: 65532,
    runtimeConnection: 'NOT_CONFIGURED',
  }),
  clientSource: Object.freeze({
    moduleKind: 'CLIENT',
    sourceModulePath: '/usr/lib/ventureos/native/linux-retained-native-client.node',
    sourceModuleSha256: 'a'.repeat(64),
    sourceModuleIdentityReference: 'linux:dev-b:ino-20',
    sourceModuleOwnerUid: 0,
    sourceModuleOwnerGid: 0,
    sourceModuleMode: 0o444,
    sourceModuleSizeBytes: 4096,
  }),
  listenerSource: Object.freeze({
    moduleKind: 'LISTENER',
    sourceModulePath: '/usr/lib/ventureos/native/linux-retained-native-listener.node',
    sourceModuleSha256: 'b'.repeat(64),
    sourceModuleIdentityReference: 'linux:dev-c:ino-30',
    sourceModuleOwnerUid: 0,
    sourceModuleOwnerGid: 0,
    sourceModuleMode: 0o444,
    sourceModuleSizeBytes: 4096,
  }),
  socketPath:
    '/var/lib/ventureos/runtime/workspace-one/supervisor-one/attempt-0001/run/supervisor/service.sock',
  runtimeConnection: 'NOT_CONFIGURED',
});

function observation(
  request: LinuxRetainedNativeSupervisorTopologyObservationRequest,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...request,
    observationId: `observation-${request.observerRole.toLowerCase()}`,
    requestHash: linuxRetainedNativeSupervisorTopologyObservationRequestHash(request),
    evidenceAuthority: 'LINUX_RETAINED_DESCRIPTORS',
    principalAuthority: 'LINUX_EFFECTIVE_IDENTITY',
    observerUid: request.runtimeRootParentOwnerUid,
    observerGid: request.runtimeRootParentOwnerGid,
    observedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 4_000).toISOString(),
    topologyState: 'VISIBLE_NOT_PROVISIONED',
    ...overrides,
  };
}

class Observer implements LinuxRetainedNativeSupervisorTopologyObservationPort {
  readonly requests: LinuxRetainedNativeSupervisorTopologyObservationRequest[] = [];
  replacement: Record<string, unknown> = {};

  async observe(input: unknown, _signal: AbortSignal): Promise<unknown> {
    const request = input as LinuxRetainedNativeSupervisorTopologyObservationRequest;
    this.requests.push(request);
    return observation(request, this.replacement);
  }
}

function subject(clock: () => number = () => now) {
  const api = new Observer();
  const worker = new Observer();
  return {
    api,
    worker,
    reconciler: new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
      api,
      worker,
      clock,
    ),
  };
}

describe('bounded shared retained-runtime topology reconciler', () => {
  it('requires two role-local observations of one exact retained parent', async () => {
    const { api, worker, reconciler } = subject();
    const result = await reconciler.attest(plan, new AbortController().signal);

    expect(api.requests).toHaveLength(1);
    expect(worker.requests).toHaveLength(1);
    expect(api.requests[0]).toMatchObject({
      observerRole: 'API_LISTENER',
      sourceModulePath: plan.listenerSource.sourceModulePath,
    });
    expect(worker.requests[0]).toMatchObject({
      observerRole: 'WORKER_CLIENT',
      sourceModulePath: plan.clientSource.sourceModulePath,
    });
    expect(result).toMatchObject({
      workspaceId: 'workspace-one',
      supervisorInstanceId: 'supervisor-one',
      provisioningAttemptId: 'attempt-0001',
      runtimeRootParentIdentityReference: 'linux:dev-a:ino-10',
      topologyState: 'SHARED_RUNTIME_VISIBLE_NOT_PROVISIONED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('denies absent ports and invalid timeout configuration', () => {
    expect(
      () => new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(),
    ).toThrowError(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
          new Observer(),
          new Observer(),
          () => now,
          99,
        ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
          new DenyLinuxRetainedNativeSupervisorTopologyObservationPort(),
          new Observer(),
        ),
    ).toThrowError(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    const aliased = new Observer();
    expect(
      () =>
        new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(aliased, aliased),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORIZATION' }));
  });

  it('validates the complete plan before observing either role', async () => {
    const { api, worker, reconciler } = subject();
    const invalid = {
      ...plan,
      listenerSource: {
        ...plan.listenerSource,
        sourceModulePath: '/usr/lib/ventureos/native/linux-retained-native-client.node',
      },
    };
    await expect(reconciler.attest(invalid, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    expect(api.requests).toHaveLength(0);
    expect(worker.requests).toHaveLength(0);
  });

  it.each([
    ['parent identity', { runtimeRootParentIdentityReference: 'linux:dev-a:ino-11' }],
    ['plan hash', { provisioningPlanHash: 'f'.repeat(64) }],
    ['request hash', { requestHash: 'f'.repeat(64) }],
    ['principal identity', { observerUid: 0 }],
    ['wrong role', { observerRole: 'WORKER_CLIENT' }],
    ['unknown field', { unexpected: true }],
  ])('denies %s drift without returning partial topology', async (_label, replacement) => {
    const { api, reconciler } = subject();
    api.replacement = replacement;
    await expect(reconciler.attest(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
  });

  it('denies stale evidence, duplicate observation identity, and backward clocks', async () => {
    const stale = subject();
    stale.api.replacement = { validUntil: new Date(now).toISOString() };
    await expect(stale.reconciler.attest(plan, new AbortController().signal)).rejects.toMatchObject(
      { code: 'INVALID_ATTESTATION' },
    );

    const duplicate = subject();
    duplicate.worker.replacement = { observationId: 'observation-api_listener' };
    await expect(
      duplicate.reconciler.attest(plan, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });

    const times = [now, now - 1];
    const backwards = subject(() => times.shift()!);
    await expect(
      backwards.reconciler.attest(plan, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
  });

  it('rejects accessor-bearing evidence without evaluating it', async () => {
    let evaluated = false;
    const accessor: LinuxRetainedNativeSupervisorTopologyObservationPort = {
      async observe(input) {
        const result = observation(
          input as LinuxRetainedNativeSupervisorTopologyObservationRequest,
        );
        Object.defineProperty(result, 'observedAt', {
          enumerable: true,
          get() {
            evaluated = true;
            return new Date(now).toISOString();
          },
        });
        return result;
      },
    };
    const reconciler = new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
      accessor,
      new Observer(),
      () => now,
    );
    await expect(reconciler.attest(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    expect(evaluated).toBe(false);
  });

  it('is one-attempt, cancellation-aware, bounded, and captures port methods', async () => {
    const captured = subject();
    captured.api.observe = vi.fn(async () => ({ replaced: true }));
    await expect(
      captured.reconciler.attest(plan, new AbortController().signal),
    ).resolves.toMatchObject({ topologyState: 'SHARED_RUNTIME_VISIBLE_NOT_PROVISIONED' });
    expect(captured.api.observe).not.toHaveBeenCalled();
    await expect(
      captured.reconciler.attest(plan, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });

    const cancelled = subject();
    const controller = new AbortController();
    controller.abort();
    await expect(cancelled.reconciler.attest(plan, controller.signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });

    const blocking = (): LinuxRetainedNativeSupervisorTopologyObservationPort => ({
      observe: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const bounded = new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
      blocking(),
      blocking(),
      () => now,
      100,
    );
    await expect(bounded.attest(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
  });
});
