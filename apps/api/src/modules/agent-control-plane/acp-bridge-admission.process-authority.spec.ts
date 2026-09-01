import {
  type CodexValidationDispatchCandidate,
  type CodexValidationProcessCleanupEvidence,
  type SupervisorProcessBinding,
} from '@ventureos/agent-bridge';
import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import { describe, expect, it, vi } from 'vitest';

import {
  AcpBridgeAdmissionDeniedError,
  AcpBridgeAdmissionService,
} from './acp-bridge-admission.service';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const principalId = 'control-plane:process-owner';

describe('Codex validation process-session control-plane authority', () => {
  it('snapshots identity and delegates exact claim and completion requests', async () => {
    const service = Object.create(AcpBridgeAdmissionService.prototype) as AcpBridgeAdmissionService;
    const claim = vi
      .spyOn(service, 'claimCodexValidationProcessSession')
      .mockResolvedValue({} as never);
    const complete = vi
      .spyOn(service, 'completeCodexValidationProcessSession')
      .mockResolvedValue({} as never);
    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    const context = { workspaceId, principalId };
    const identity = {
      claimId: 'codex-process-claim-unit',
      handoffAttemptId: 'codex-process-handoff-unit',
      claimIdempotencyKey: 'codex-process-claim-key-unit',
      completionIdempotencyKey: 'codex-process-completion-key-unit',
    };
    const authority = service.createCodexValidationProcessSessionAuthority(
      capability,
      context,
      identity,
    );
    context.principalId = 'mutated-principal';
    identity.claimId = 'mutated-claim';

    const binding = processBinding('supervision-unit');
    const dispatch = { dispatchId: 'dispatch-unit' } as CodexValidationDispatchCandidate;
    const cleanup = {
      binding,
      cleanupEvidenceHash: 'a'.repeat(64),
    } as CodexValidationProcessCleanupEvidence;
    await authority.claim({ binding, dispatch });
    await authority.complete({ binding, dispatch, cleanup });

    expect(claim).toHaveBeenCalledWith(
      capability,
      { workspaceId, principalId },
      {
        claimId: 'codex-process-claim-unit',
        handoffAttemptId: 'codex-process-handoff-unit',
        dispatch,
        binding,
        idempotencyKey: 'codex-process-claim-key-unit',
      },
    );
    expect(complete).toHaveBeenCalledWith(
      capability,
      { workspaceId, principalId },
      {
        claimId: 'codex-process-claim-unit',
        dispatch,
        cleanup,
        idempotencyKey: 'codex-process-completion-key-unit',
      },
    );
  });

  it('rejects insufficient authority and completion binding drift', async () => {
    const service = Object.create(AcpBridgeAdmissionService.prototype) as AcpBridgeAdmissionService;
    const lowCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'AGENT', authorityLevel: 1 },
    ]);
    expect(() =>
      service.createCodexValidationProcessSessionAuthority(
        lowCapability,
        { workspaceId, principalId },
        {
          claimId: 'codex-process-claim-low',
          handoffAttemptId: 'codex-process-handoff-low',
          claimIdempotencyKey: 'codex-process-claim-key-low',
          completionIdempotencyKey: 'codex-process-completion-key-low',
        },
      ),
    ).toThrow(AcpBridgeAdmissionDeniedError);

    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    const authority = service.createCodexValidationProcessSessionAuthority(
      capability,
      { workspaceId, principalId },
      {
        claimId: 'codex-process-claim-drift',
        handoffAttemptId: 'codex-process-handoff-drift',
        claimIdempotencyKey: 'codex-process-claim-key-drift',
        completionIdempotencyKey: 'codex-process-completion-key-drift',
      },
    );
    const binding = processBinding('supervision-expected');
    await expect(
      authority.complete({
        binding: processBinding('supervision-mutated'),
        dispatch: { dispatchId: 'dispatch-drift' } as CodexValidationDispatchCandidate,
        cleanup: {
          binding,
          cleanupEvidenceHash: 'b'.repeat(64),
        } as CodexValidationProcessCleanupEvidence,
      }),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
  });
});

function processBinding(supervisionId: string): SupervisorProcessBinding {
  return {
    schemaVersion: 1,
    supervisionId,
    launchNonce: 'launch-nonce-unit',
    workspaceId,
    runtimeId: 'runtime-unit',
    connectionId: 'connection-unit',
    platform: 'LINUX',
    manifestHash: '1'.repeat(64),
    admissionEvidenceHash: '2'.repeat(64),
    admissionBindingHash: '3'.repeat(64),
    testOnly: true,
  };
}
