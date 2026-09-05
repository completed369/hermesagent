import { createHash } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance,
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController,
  canonicalJson,
  retainedNativeSupervisorModuleAuthorizationSnapshotIssueRequestHash,
  retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest,
} from '@ventureos/agent-bridge';
import { describe, expect, it } from 'vitest';

import {
  BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority,
  RetainedNativeModuleAuthorizationIssuanceAuthorityDeniedError,
} from './retained-native-module-authorization-issuance-authority';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const context = Object.freeze({ workspaceId: 'workspace-1', principalId: 'control-plane-owner-1' });
const expectedRequest: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest> =
  Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE',
    workspaceId: context.workspaceId,
    supervisorInstanceId: 'native-supervisor-1',
    snapshotId: 'native-module-snapshot-1',
    snapshotVersion: 1,
    signerKeyId: 'native-module-root-signer-1',
    issuanceRequestHash: 'a'.repeat(64),
    runtimeConnection: 'NOT_CONFIGURED',
  });

function capability(
  authorityLevel: 0 | 1 | 2 | 3 | 4 = 3,
  actorKind: 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM' = 'SYSTEM',
  source: 'CONTROL_PLANE' | 'AI_COO' = 'CONTROL_PLANE',
) {
  return OperationalEventCapability.issue(source, [{ ...context, actorKind, authorityLevel }]);
}

describe('BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority', () => {
  it('mints one exact, short-lived, digest-only Level-3 grant', async () => {
    const authority = new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    const result = (await authority.authorize(expectedRequest)) as Record<string, unknown>;
    const evidence = {
      evidencePurpose: 'RETAINED_NATIVE_MODULE_SNAPSHOT_LEVEL3_AUTHORIZATION',
      policyVersion: 1,
      request: expectedRequest,
      authorizedByReference: context.principalId,
      actorKind: 'SYSTEM',
      authorityLevel: 3,
      validFrom: '2030-01-01T12:00:00.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
    };
    const evidenceHash = createHash('sha256').update(canonicalJson(evidence)).digest('hex');
    expect(result).toEqual({
      ...expectedRequest,
      issuanceAuthorizationId: `native-module-issuance:${evidenceHash}`,
      authorityRequestHash:
        retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash(
          expectedRequest,
        ),
      approvalId: `level3-control-plane:${evidenceHash}`,
      approvalEvidenceHash: evidenceHash,
      authorizedByReference: context.principalId,
      authorityLevel: 3,
      validFrom: '2030-01-01T12:00:00.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
    });
    expect(Object.isFrozen(result)).toBe(true);
    await expect(authority.authorize(expectedRequest)).rejects.toBeInstanceOf(
      RetainedNativeModuleAuthorizationIssuanceAuthorityDeniedError,
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
        new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
          trustedCapability,
          context,
          expectedRequest,
          () => NOW,
        ),
    ).toThrow();
  });

  it('rejects cross-workspace, malformed, drifted, and invalid-clock requests', async () => {
    expect(
      () =>
        new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
          capability(),
          context,
          { ...expectedRequest, workspaceId: 'workspace-2' },
          () => NOW,
        ),
    ).toThrow(/Cross-workspace/u);
    expect(
      () =>
        new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
          capability(),
          context,
          { ...expectedRequest, extra: true },
          () => NOW,
        ),
    ).toThrow(/shape/u);
    const accessor = Object.defineProperty({ ...expectedRequest }, 'snapshotId', {
      enumerable: true,
      get: () => expectedRequest.snapshotId,
    });
    expect(
      () =>
        new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
          capability(),
          context,
          accessor,
          () => NOW,
        ),
    ).toThrow(/inert plain record/u);

    const drifted = new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
      capability(),
      context,
      expectedRequest,
      () => NOW,
    );
    await expect(drifted.authorize({ ...expectedRequest, snapshotVersion: 2 })).rejects.toThrow(
      /drifted/u,
    );
    await expect(drifted.authorize(expectedRequest)).rejects.toThrow(/one-shot/u);

    const invalidClock = new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
      capability(),
      context,
      expectedRequest,
      () => Number.NaN,
    );
    await expect(invalidClock.authorize(expectedRequest)).rejects.toThrow(/clock/u);
    const outOfRangeClock = new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
      capability(),
      context,
      expectedRequest,
      () => Number.MAX_SAFE_INTEGER,
    );
    await expect(outOfRangeClock.authorize(expectedRequest)).rejects.toThrow(/clock/u);
  });

  it('is accepted by the one-shot controller without gaining signer or publisher authority', async () => {
    const issueRequest: RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest = {
      schemaVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE',
      workspaceId: context.workspaceId,
      supervisorInstanceId: 'native-supervisor-1',
      snapshotId: 'native-module-snapshot-1',
      snapshotVersion: 1,
      signerKeyId: 'native-module-root-signer-1',
      previousSnapshotHash: null,
      issuedAt: '2030-01-01T12:00:00.000Z',
      validUntil: '2030-01-01T12:02:00.000Z',
      authorizations: [],
      runtimeConnection: 'NOT_CONFIGURED',
    };
    const authorityRequest = {
      schemaVersion: 1 as const,
      purpose: issueRequest.purpose,
      workspaceId: issueRequest.workspaceId,
      supervisorInstanceId: issueRequest.supervisorInstanceId,
      snapshotId: issueRequest.snapshotId,
      snapshotVersion: issueRequest.snapshotVersion,
      signerKeyId: issueRequest.signerKeyId,
      issuanceRequestHash:
        retainedNativeSupervisorModuleAuthorizationSnapshotIssueRequestHash(issueRequest),
      runtimeConnection: 'NOT_CONFIGURED' as const,
    };
    const authority = new BoundedLevel3RetainedNativeModuleAuthorizationIssuanceAuthority(
      capability(),
      context,
      authorityRequest,
      () => NOW,
    );
    let published = false;
    const controller = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController(
      context.workspaceId,
      issueRequest.supervisorInstanceId,
      authority,
      {
        async sign(request: RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest) {
          return {
            schemaVersion: 1,
            purpose: request.purpose,
            signerKeyId: request.signerKeyId,
            snapshotPayloadHash: request.snapshotPayloadHash,
            signature: `${'A'.repeat(86)}==`,
          };
        },
      },
      {
        async publish(_snapshot, issuance) {
          AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance.assertAuthenticated(
            issuance,
          );
          published = true;
          return 'APPENDED' as const;
        },
      },
      () => NOW,
    );
    await expect(
      controller.issue(issueRequest, new AbortController().signal),
    ).resolves.toMatchObject({ publication: 'APPENDED', runtimeConnection: 'NOT_CONFIGURED' });
    expect(published).toBe(true);
  });
});
