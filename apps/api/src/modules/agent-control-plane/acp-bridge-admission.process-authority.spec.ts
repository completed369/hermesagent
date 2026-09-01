import {
  type CodexValidationDispatchCandidate,
  type CodexValidationProcessCleanupEvidence,
  type SupervisorProcessBinding,
} from '@ventureos/agent-bridge';
import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import { prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import {
  AcpBridgeAdmissionDeniedError,
  AcpBridgeAdmissionService,
} from './acp-bridge-admission.service';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const principalId = 'control-plane:process-owner';

const databaseMocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock('@ventureos/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ventureos/database')>();
  return { ...actual, prisma: { $transaction: databaseMocks.transaction } };
});

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

  it('rejects recovery discovery without Level-3 authority or bounded input', async () => {
    const service = Object.create(AcpBridgeAdmissionService.prototype) as AcpBridgeAdmissionService;
    const lowCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'AGENT', authorityLevel: 1 },
    ]);
    await expect(
      service.listCodexValidationProcessSessionRecoveryInventory(
        lowCapability,
        { workspaceId, principalId },
        { limit: 1 },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      service.claimCodexValidationProcessSessionRecoveryLease(
        lowCapability,
        { workspaceId, principalId },
        {
          recoveryLeaseId: 'recovery-lease-low',
          claimId: 'recovery-claim-low',
          idempotencyKey: 'recovery-lease-low',
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);

    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    await expect(
      service.listCodexValidationProcessSessionRecoveryInventory(
        capability,
        { workspaceId, principalId },
        { limit: 0 },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      service.listCodexValidationProcessSessionRecoveryInventory(
        capability,
        { workspaceId, principalId },
        { limit: 101 },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
  });

  it('claims a short frozen recovery lease only through exact Level-3 owner authority', async () => {
    const service = Object.create(AcpBridgeAdmissionService.prototype) as AcpBridgeAdmissionService;
    const recordOperationalEvent = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { auditService: { recordOperationalEvent } });
    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    const now = new Date('2026-09-01T15:00:00.000Z');
    const claimExpiresAt = new Date(now.getTime() - 1_000);
    const leaseExpiresAt = new Date(now.getTime() + 15_000);
    const binding = processBinding('supervision-recovery-unit');
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          workspaceId,
          id: 'claim-recovery-unit',
          ownerReference: principalId,
          ownerActorKind: 'SYSTEM',
          handoffAttemptId: 'handoff-recovery-unit',
          validationDispatchCandidateHash: '4'.repeat(64),
          runtimeId: binding.runtimeId,
          connectionId: binding.connectionId,
          sessionId: 'session-recovery-unit',
          dispatchId: 'dispatch-recovery-unit',
          supervisionId: binding.supervisionId,
          launchNonce: binding.launchNonce,
          platform: binding.platform,
          manifestHash: binding.manifestHash,
          admissionEvidenceHash: binding.admissionEvidenceHash,
          admissionBindingHash: binding.admissionBindingHash,
          testOnly: binding.testOnly,
          state: 'CLAIMED',
          runtimeConnection: 'NOT_CONFIGURED',
          claimedAt: new Date(claimExpiresAt.getTime() - 1_000),
          expiresAt: claimExpiresAt,
          runId: 'run-recovery-unit',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([
        {
          workspaceId,
          id: 'lease-recovery-unit',
          claimId: 'claim-recovery-unit',
          ownerReference: principalId,
          ownerActorKind: 'SYSTEM',
          generation: 1,
          state: 'CLAIMED',
          runtimeConnection: 'NOT_CONFIGURED',
          recoveryIdempotencyKey: 'lease-recovery-unit',
          claimExpiresAt,
          claimedAt: now,
          expiresAt: leaseExpiresAt,
          createdAt: now,
        },
      ]);
    databaseMocks.transaction.mockImplementationOnce(async (operation) =>
      operation({ $queryRaw: queryRaw }),
    );

    const result = await service.claimCodexValidationProcessSessionRecoveryLease(
      capability,
      { workspaceId, principalId },
      {
        recoveryLeaseId: 'lease-recovery-unit',
        claimId: 'claim-recovery-unit',
        idempotencyKey: 'lease-recovery-unit',
      },
    );

    expect(result).toEqual({
      lease: {
        schemaVersion: 1,
        recoveryLeaseId: 'lease-recovery-unit',
        claimId: 'claim-recovery-unit',
        ownerReference: principalId,
        ownerActorKind: 'SYSTEM',
        generation: 1,
        leaseState: 'ACTIVE',
        claimExpiresAt: claimExpiresAt.toISOString(),
        claimedAt: now.toISOString(),
        expiresAt: leaseExpiresAt.toISOString(),
        runtimeConnection: 'NOT_CONFIGURED',
      },
      workItem: {
        schemaVersion: 1,
        recoveryLeaseId: 'lease-recovery-unit',
        recoveryGeneration: 1,
        claimId: 'claim-recovery-unit',
        handoffAttemptId: 'handoff-recovery-unit',
        validationDispatchCandidateHash: '4'.repeat(64),
        sessionId: 'session-recovery-unit',
        dispatchId: 'dispatch-recovery-unit',
        runId: 'run-recovery-unit',
        binding,
        processClaimedAt: new Date(claimExpiresAt.getTime() - 1_000).toISOString(),
        processExpiresAt: claimExpiresAt.toISOString(),
        leaseClaimedAt: now.toISOString(),
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        runtimeConnection: 'NOT_CONFIGURED',
      },
      replayed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lease)).toBe(true);
    expect(Object.isFrozen(result.workItem)).toBe(true);
    expect(Object.isFrozen(result.workItem?.binding)).toBe(true);
    const storedLease = {
      workspaceId,
      id: 'lease-recovery-unit',
      claimId: 'claim-recovery-unit',
      ownerReference: principalId,
      ownerActorKind: 'SYSTEM',
      generation: 1,
      state: 'CLAIMED',
      runtimeConnection: 'NOT_CONFIGURED',
      recoveryIdempotencyKey: 'lease-recovery-unit',
      claimExpiresAt,
      claimedAt: now,
      expiresAt: leaseExpiresAt,
      createdAt: now,
    };
    const expiredNow = new Date(leaseExpiresAt.getTime() + 1);
    const replayQueryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          workspaceId,
          id: 'claim-recovery-unit',
          ownerReference: principalId,
          ownerActorKind: 'SYSTEM',
          handoffAttemptId: 'handoff-recovery-unit',
          validationDispatchCandidateHash: '4'.repeat(64),
          runtimeId: binding.runtimeId,
          connectionId: binding.connectionId,
          sessionId: 'session-recovery-unit',
          dispatchId: 'dispatch-recovery-unit',
          supervisionId: binding.supervisionId,
          launchNonce: binding.launchNonce,
          platform: binding.platform,
          manifestHash: binding.manifestHash,
          admissionEvidenceHash: binding.admissionEvidenceHash,
          admissionBindingHash: binding.admissionBindingHash,
          testOnly: binding.testOnly,
          state: 'CLAIMED',
          runtimeConnection: 'NOT_CONFIGURED',
          claimedAt: new Date(claimExpiresAt.getTime() - 1_000),
          expiresAt: claimExpiresAt,
          runId: 'run-recovery-unit',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedLease])
      .mockResolvedValueOnce([storedLease])
      .mockResolvedValueOnce([{ now: expiredNow }]);
    databaseMocks.transaction.mockImplementationOnce(async (operation) =>
      operation({ $queryRaw: replayQueryRaw }),
    );
    const expiredReplay = await service.claimCodexValidationProcessSessionRecoveryLease(
      capability,
      { workspaceId, principalId },
      {
        recoveryLeaseId: 'lease-recovery-unit',
        claimId: 'claim-recovery-unit',
        idempotencyKey: 'lease-recovery-unit',
      },
    );
    expect(expiredReplay.replayed).toBe(true);
    expect(expiredReplay.lease.leaseState).toBe('EXPIRED');
    expect(expiredReplay.workItem).toBeNull();
    expect(recordOperationalEvent).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
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
