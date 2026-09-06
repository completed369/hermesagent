import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import type { LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest } from '@ventureos/agent-bridge';
import { describe, expect, it } from 'vitest';

import { BoundedLevel3RetainedNativeRuntimeRootAuthority } from './retained-native-runtime-root-authority';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const context = Object.freeze({ workspaceId: 'workspace-one', principalId: 'principal-one' });
const request: LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION',
  workspaceId: context.workspaceId,
  supervisorInstanceId: 'native-supervisor-1',
  provisioningAttemptId: 'attempt-0001',
  platform: 'LINUX',
  architecture: 'X64',
  runtimeRootParent: '/var/lib/ventureos/runtime/workspace-one/native-supervisor-1',
  runtimeRootParentIdentityReference: 'linux:dev-1:ino-64',
  runtimeRootParentOwnerUid: 10001,
  runtimeRootParentOwnerGid: 10001,
  runtimeRootParentMode: 0o700,
  runtimeRoot: '/var/lib/ventureos/runtime/workspace-one/native-supervisor-1/attempt-0001',
  ownerUid: 10001,
  ownerGid: 10001,
  runtimeConnection: 'NOT_CONFIGURED',
});

function capability(
  authorityLevel: 0 | 1 | 2 | 3 | 4 = 3,
  actorKind: 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM' = 'SYSTEM',
  source: 'CONTROL_PLANE' | 'AI_COO' = 'CONTROL_PLANE',
  boundContext: Readonly<{ workspaceId: string; principalId: string }> = context,
): OperationalEventCapability {
  return OperationalEventCapability.issue(source, [{ ...boundContext, actorKind, authorityLevel }]);
}

describe('retained-native runtime-root Level-3 authority', () => {
  it('mints one exact short-lived digest-only grant', async () => {
    const authority = new BoundedLevel3RetainedNativeRuntimeRootAuthority(
      capability(),
      context,
      request,
      () => now,
    );
    const grant = (await authority.authorize(request)) as Record<string, unknown>;
    expect(grant).toMatchObject({
      ...request,
      authorityLevel: 3,
      authorizedByReference: context.principalId,
      validFrom: new Date(now).toISOString(),
      validUntil: new Date(now + 60_000).toISOString(),
    });
    expect(grant.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(grant.approvalEvidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    await expect(authority.authorize(request)).rejects.toThrow('one-shot');
  });

  it('denies cross-workspace, Level-4, runtime, and AI-COO authority', () => {
    const other = { workspaceId: 'workspace-two', principalId: 'principal-two' };
    expect(
      () =>
        new BoundedLevel3RetainedNativeRuntimeRootAuthority(
          capability(3, 'SYSTEM', 'CONTROL_PLANE', other),
          other,
          request,
          () => now,
        ),
    ).toThrow('Cross-workspace');
    expect(
      () =>
        new BoundedLevel3RetainedNativeRuntimeRootAuthority(
          capability(4),
          context,
          request,
          () => now,
        ),
    ).toThrow('Exact Level-3');
    expect(
      () =>
        new BoundedLevel3RetainedNativeRuntimeRootAuthority(
          capability(3, 'RUNTIME'),
          context,
          request,
          () => now,
        ),
    ).toThrow('Exact Level-3');
    expect(
      () =>
        new BoundedLevel3RetainedNativeRuntimeRootAuthority(
          capability(3, 'SYSTEM', 'AI_COO'),
          context,
          request,
          () => now,
        ),
    ).toThrow();
  });

  it('denies request drift and invalid clocks', async () => {
    const authority = new BoundedLevel3RetainedNativeRuntimeRootAuthority(
      capability(),
      context,
      request,
      () => now,
    );
    await expect(
      authority.authorize({
        ...request,
        provisioningAttemptId: 'attempt-0002',
        runtimeRoot: `${request.runtimeRootParent}/attempt-0002`,
      }),
    ).rejects.toThrow('drifted');
    const badClock = new BoundedLevel3RetainedNativeRuntimeRootAuthority(
      capability(),
      context,
      request,
      () => Number.NaN,
    );
    await expect(badClock.authorize(request)).rejects.toThrow('clock is invalid');
  });
});
