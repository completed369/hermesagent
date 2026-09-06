import { createHash } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  canonicalJson,
  linuxRetainedNativeSupervisorServiceRequestHash,
  type LinuxRetainedNativeSupervisorServiceRequest,
} from '@ventureos/agent-bridge';
import { describe, expect, it } from 'vitest';

import {
  BoundedLevel3RetainedNativeSupervisorServiceAuthority,
  RetainedNativeSupervisorServiceAuthorityDeniedError,
} from './retained-native-service-authority';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const MAX_DATE_MS = 8_640_000_000_000_000;
const context = Object.freeze({ workspaceId: 'workspace-1', principalId: 'control-plane-owner-1' });

function request(
  overrides: Partial<LinuxRetainedNativeSupervisorServiceRequest> = {},
): LinuxRetainedNativeSupervisorServiceRequest {
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE',
    workspaceId: context.workspaceId,
    supervisorInstanceId: 'native-supervisor-1',
    serviceKind: 'RECOVERY',
    provisioningId: 'native-path-provision-1',
    pathProvisionRequestHash: 'a'.repeat(64),
    pathApprovalEvidenceHash: 'b'.repeat(64),
    socketDirectory: '/run/ventureos/supervisor',
    socketDirectoryIdentityReference: 'linux:dev-5:ino-6',
    socketDirectoryOwnerUid: 65_532,
    socketDirectoryOwnerGid: 65_532,
    socketDirectoryMode: 0o700,
    socketPath: '/run/ventureos/supervisor/recovery.sock',
    expectedWorkerPid: 812,
    expectedWorkerUid: 65_532,
    expectedWorkerGid: 65_532,
    maximumSessionDurationMs: 2_000,
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

function capability(
  authorityLevel: 0 | 1 | 2 | 3 | 4 = 3,
  actorKind: 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM' = 'SYSTEM',
  source: 'CONTROL_PLANE' | 'AI_COO' = 'CONTROL_PLANE',
) {
  return OperationalEventCapability.issue(source, [{ ...context, actorKind, authorityLevel }]);
}

describe('BoundedLevel3RetainedNativeSupervisorServiceAuthority', () => {
  it('mints one exact tenant-, supervisor-, path-, peer-, and protocol-bound Level-3 grant', async () => {
    const expectedRequest = request();
    const authority = new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    const result = (await authority.authorize(expectedRequest)) as Record<string, unknown>;
    const evidence = {
      evidencePurpose: 'RETAINED_NATIVE_SUPERVISOR_SERVICE_LEVEL3_AUTHORIZATION',
      policyVersion: 1,
      request: expectedRequest,
      authorizedByReference: context.principalId,
      actorKind: 'SYSTEM',
      authorityLevel: 3,
      validFrom: '2030-01-01T12:00:00.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
    };
    const approvalEvidenceHash = createHash('sha256').update(canonicalJson(evidence)).digest('hex');
    expect(result).toEqual({
      ...expectedRequest,
      serviceRunId: `native-supervisor-service:${approvalEvidenceHash}`,
      requestHash: linuxRetainedNativeSupervisorServiceRequestHash(expectedRequest),
      approvalId: `level3-control-plane:${approvalEvidenceHash}`,
      approvalEvidenceHash,
      authorizedByReference: context.principalId,
      authorityLevel: 3,
      validFrom: '2030-01-01T12:00:00.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
    });
    expect(Object.isFrozen(result)).toBe(true);
    await expect(authority.authorize(expectedRequest)).rejects.toBeInstanceOf(
      RetainedNativeSupervisorServiceAuthorityDeniedError,
    );
  });

  it.each([
    ['wrong source', capability(3, 'SYSTEM', 'AI_COO')],
    ['insufficient authority', capability(2)],
    ['Level-4 authority', capability(4)],
    ['runtime principal', capability(3, 'RUNTIME')],
  ])('rejects %s at construction', (_name, trustedCapability) => {
    expect(
      () =>
        new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
          trustedCapability,
          context,
          request(),
          () => NOW,
        ),
    ).toThrow();
  });

  it('rejects cross-workspace scope before an authorization attempt', () => {
    expect(
      () =>
        new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
          capability(),
          context,
          request({ workspaceId: 'workspace-2' }),
          () => NOW,
        ),
    ).toThrow(/Cross-workspace/u);
  });

  it.each([
    ['tenant', { workspaceId: 'workspace-2' }],
    ['supervisor', { supervisorInstanceId: 'native-supervisor-2' }],
    ['protocol', { serviceKind: 'MODULE_AUTHORIZATION_SIGNING' }],
    ['path evidence', { pathApprovalEvidenceHash: 'c'.repeat(64) }],
    ['socket identity', { socketDirectoryIdentityReference: 'linux:dev-5:ino-7' }],
    ['socket path', { socketPath: '/run/ventureos/supervisor/other.sock' }],
    ['worker principal', { expectedWorkerPid: 813 }],
    ['deadline', { maximumSessionDurationMs: 1_900 }],
  ])('rejects %s request drift and consumes the authority', async (_label, drift) => {
    const expectedRequest = request();
    const authority = new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    await expect(authority.authorize(request(drift as never))).rejects.toThrow(/drifted/u);
    await expect(authority.authorize(expectedRequest)).rejects.toThrow(/one-shot/u);
  });

  it('rejects malformed records and sensitive references', () => {
    expect(
      () =>
        new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
          capability(),
          context,
          { ...request(), extra: true },
          () => NOW,
        ),
    ).toThrow(/invalid/u);
    expect(
      () =>
        new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
          capability(),
          context,
          request({ provisioningId: 'secret-reference' }),
          () => NOW,
        ),
    ).toThrow(/invalid/u);
  });

  it('consumes malformed authorization attempts', async () => {
    const expectedRequest = request();
    const authority = new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    await expect(authority.authorize({ ...expectedRequest, extra: true })).rejects.toThrow(
      /invalid/u,
    );
    await expect(authority.authorize(expectedRequest)).rejects.toThrow(/one-shot/u);
  });

  it.each([Number.NaN, -1, 1.5, MAX_DATE_MS])(
    'rejects invalid clocks without emitting a grant: %s',
    async (invalidClock) => {
      const expectedRequest = request();
      const authority = new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
        capability(),
        context,
        expectedRequest,
        () => invalidClock,
      );
      await expect(authority.authorize(expectedRequest)).rejects.toThrow(/clock/u);
    },
  );

  it('emits distinct evidence for every listener service purpose', async () => {
    const recoveryRequest = request();
    const signingRequest = request({
      serviceKind: 'MODULE_AUTHORIZATION_SIGNING',
      socketPath: '/run/ventureos/supervisor/signing.sock',
    });
    const recovery = (await new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
      capability(),
      context,
      recoveryRequest,
      () => NOW,
    ).authorize(recoveryRequest)) as Record<string, unknown>;
    const signing = (await new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
      capability(),
      context,
      signingRequest,
      () => NOW,
    ).authorize(signingRequest)) as Record<string, unknown>;
    const apiObservationRequest = request({
      serviceKind: 'TOPOLOGY_OBSERVATION_API_LISTENER',
      socketPath: '/run/ventureos/supervisor/topology-api.sock',
    });
    const workerObservationRequest = request({
      serviceKind: 'TOPOLOGY_OBSERVATION_WORKER_CLIENT',
      socketPath: '/run/ventureos/supervisor/topology-worker.sock',
    });
    const apiObservation = (await new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
      capability(),
      context,
      apiObservationRequest,
      () => NOW,
    ).authorize(apiObservationRequest)) as Record<string, unknown>;
    const workerObservation = (await new BoundedLevel3RetainedNativeSupervisorServiceAuthority(
      capability(),
      context,
      workerObservationRequest,
      () => NOW,
    ).authorize(workerObservationRequest)) as Record<string, unknown>;
    const results = [recovery, signing, apiObservation, workerObservation];
    expect(new Set(results.map((result) => result.requestHash))).toHaveLength(4);
    expect(new Set(results.map((result) => result.approvalEvidenceHash))).toHaveLength(4);
    expect(new Set(results.map((result) => result.serviceRunId))).toHaveLength(4);
  });
});
