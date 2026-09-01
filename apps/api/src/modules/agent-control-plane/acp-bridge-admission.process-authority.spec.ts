import {
  BRIDGE_PROTOCOL_VERSION,
  CODEX_APP_SERVER_ADAPTER_KIND,
  canonicalJson,
  codexValidationDispatchPayload,
  createCodexValidationProcessCleanupEvidence,
  createCodexValidationProcessSessionRecoveryExitEvidenceHash,
  type CodexValidationDispatchCandidate,
  type CodexValidationProcessCleanupEvidence,
  type SupervisorProcessBinding,
} from '@ventureos/agent-bridge';
import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import { prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

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

  it('snapshots one exact recovery identity and delegates only its completion request', async () => {
    const service = Object.create(AcpBridgeAdmissionService.prototype) as AcpBridgeAdmissionService;
    const complete = vi
      .spyOn(service, 'completeCodexValidationProcessSessionRecovery')
      .mockResolvedValue({} as never);
    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    const context = { workspaceId, principalId };
    const fixture = recoveryAuthorityFixture();
    const identity = {
      workItem: fixture.workItem,
      dispatch: fixture.dispatch,
      completionIdempotencyKey: 'recovery-authority-completion-unit',
    };
    const authority = service.createCodexValidationProcessSessionRecoveryCompletionAuthority(
      capability,
      context,
      identity,
    );
    context.principalId = 'mutated-principal';
    identity.completionIdempotencyKey = 'mutated-idempotency';

    await authority.complete({
      workItem: fixture.workItem,
      exitEvidence: fixture.exitEvidence,
      runtimeConnection: 'NOT_CONFIGURED',
    });

    expect(Object.isFrozen(authority)).toBe(true);
    expect(complete).toHaveBeenCalledWith(
      capability,
      { workspaceId, principalId },
      {
        workItem: fixture.workItem,
        exitEvidence: fixture.exitEvidence,
        dispatch: fixture.dispatch,
        idempotencyKey: 'recovery-authority-completion-unit',
      },
    );
  });

  it('denies recovery completion authority escalation and identity drift', async () => {
    const service = Object.create(AcpBridgeAdmissionService.prototype) as AcpBridgeAdmissionService;
    vi.spyOn(service, 'completeCodexValidationProcessSessionRecovery').mockResolvedValue(
      {} as never,
    );
    const fixture = recoveryAuthorityFixture();
    const lowCapability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'AGENT', authorityLevel: 1 },
    ]);
    expect(() =>
      service.createCodexValidationProcessSessionRecoveryCompletionAuthority(
        lowCapability,
        { workspaceId, principalId },
        {
          workItem: fixture.workItem,
          dispatch: fixture.dispatch,
          completionIdempotencyKey: 'recovery-authority-low',
        },
      ),
    ).toThrow(AcpBridgeAdmissionDeniedError);

    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    expect(() =>
      service.createCodexValidationProcessSessionRecoveryCompletionAuthority(
        capability,
        { workspaceId, principalId },
        {
          workItem: {
            ...fixture.workItem,
            binding: { ...fixture.workItem.binding, runtimeId: 'runtime-drift' },
          },
          dispatch: fixture.dispatch,
          completionIdempotencyKey: 'recovery-authority-binding-drift',
        },
      ),
    ).toThrow(AcpBridgeAdmissionDeniedError);

    const authority = service.createCodexValidationProcessSessionRecoveryCompletionAuthority(
      capability,
      { workspaceId, principalId },
      {
        workItem: fixture.workItem,
        dispatch: fixture.dispatch,
        completionIdempotencyKey: 'recovery-authority-drift',
      },
    );
    await expect(
      authority.complete({
        workItem: { ...fixture.workItem, claimId: 'claim-recovery-authority-drift' },
        exitEvidence: fixture.exitEvidence,
        runtimeConnection: 'NOT_CONFIGURED',
      }),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
    await expect(
      authority.complete({
        workItem: fixture.workItem,
        exitEvidence: fixture.exitEvidence,
        runtimeConnection: 'CONNECTED',
      } as never),
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
    await expect(
      service.completeCodexValidationProcessSessionRecovery(
        lowCapability,
        { workspaceId, principalId },
        {
          workItem: {} as never,
          exitEvidence: {} as never,
          dispatch: {} as never,
          idempotencyKey: 'recovery-completion-low',
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);

    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    await expect(
      service.completeCodexValidationProcessSessionRecovery(
        capability,
        { workspaceId, principalId },
        {
          workItem: {} as never,
          exitEvidence: {} as never,
          dispatch: {} as never,
          idempotencyKey: 'recovery-completion-invalid',
        },
      ),
    ).rejects.toBeInstanceOf(AcpBridgeAdmissionDeniedError);
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
    const dispatch = recoveryDispatch(claimExpiresAt.toISOString());
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
          validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
          runtimeId: binding.runtimeId,
          connectionId: binding.connectionId,
          sessionId: dispatch.sessionId,
          dispatchId: dispatch.dispatchId,
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
          runId: dispatch.runId,
        },
      ])
      .mockResolvedValueOnce([recoveryDispatchRow(dispatch)])
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
        validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
        sessionId: dispatch.sessionId,
        dispatchId: dispatch.dispatchId,
        runId: dispatch.runId,
        binding,
        processClaimedAt: new Date(claimExpiresAt.getTime() - 1_000).toISOString(),
        processExpiresAt: claimExpiresAt.toISOString(),
        leaseClaimedAt: now.toISOString(),
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        runtimeConnection: 'NOT_CONFIGURED',
      },
      dispatch,
      replayed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lease)).toBe(true);
    expect(Object.isFrozen(result.workItem)).toBe(true);
    expect(Object.isFrozen(result.workItem?.binding)).toBe(true);
    expect(Object.isFrozen(result.dispatch)).toBe(true);
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
    const claimRows = await queryRaw.mock.results[1]?.value;
    const dispatchRows = await queryRaw.mock.results[2]?.value;
    const replayQueryAt = (observedAt: Date) =>
      vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(claimRows)
        .mockResolvedValueOnce(dispatchRows)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([storedLease])
        .mockResolvedValueOnce([storedLease])
        .mockResolvedValueOnce([{ now: observedAt }]);
    const activeReplayQueryRaw = replayQueryAt(new Date(now.getTime() + 1));
    databaseMocks.transaction.mockImplementationOnce(async (operation) =>
      operation({ $queryRaw: activeReplayQueryRaw }),
    );
    const activeReplay = await service.claimCodexValidationProcessSessionRecoveryLease(
      capability,
      { workspaceId, principalId },
      {
        recoveryLeaseId: 'lease-recovery-unit',
        claimId: 'claim-recovery-unit',
        idempotencyKey: 'lease-recovery-unit',
      },
    );
    expect(activeReplay.replayed).toBe(true);
    expect(activeReplay.lease.leaseState).toBe('ACTIVE');
    expect(activeReplay.workItem).toEqual(result.workItem);
    expect(activeReplay.dispatch).toEqual(dispatch);

    const expiredNow = new Date(leaseExpiresAt.getTime() + 1);
    const replayQueryRaw = replayQueryAt(expiredNow);
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
    expect(expiredReplay.dispatch).toBeNull();
    expect(recordOperationalEvent).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('stores retained-identity recovery evidence before one cancellation cleanup', async () => {
    const service = Object.create(AcpBridgeAdmissionService.prototype) as AcpBridgeAdmissionService;
    const recordOperationalEvent = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { auditService: { recordOperationalEvent } });
    const capability = OperationalEventCapability.issue('CONTROL_PLANE', [
      { workspaceId, principalId, actorKind: 'SYSTEM', authorityLevel: 3 },
    ]);
    const binding = processBinding('supervision-recovery-completion-unit');
    const processClaimedAt = new Date('2026-09-01T12:00:00.000Z');
    const processExpiresAt = new Date('2026-09-01T12:01:00.000Z');
    const leaseClaimedAt = new Date('2026-09-01T12:01:01.000Z');
    const leaseExpiresAt = new Date('2026-09-01T12:01:16.000Z');
    const now = new Date('2026-09-01T12:01:03.000Z');
    const dispatch = recoveryDispatch(processExpiresAt.toISOString());
    const workItem = {
      schemaVersion: 1 as const,
      recoveryLeaseId: 'lease-recovery-completion-unit',
      recoveryGeneration: 1,
      claimId: 'claim-recovery-completion-unit',
      handoffAttemptId: 'handoff-recovery-completion-unit',
      validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
      sessionId: dispatch.sessionId,
      dispatchId: dispatch.dispatchId,
      runId: dispatch.runId,
      binding,
      processClaimedAt: processClaimedAt.toISOString(),
      processExpiresAt: processExpiresAt.toISOString(),
      leaseClaimedAt: leaseClaimedAt.toISOString(),
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      runtimeConnection: 'NOT_CONFIGURED' as const,
    };
    const exitValue = {
      schemaVersion: 1 as const,
      evidenceId: 'exit-recovery-completion-unit',
      recoveryLeaseId: workItem.recoveryLeaseId,
      recoveryGeneration: 1,
      claimId: workItem.claimId,
      supervisionId: binding.supervisionId,
      launchNonce: binding.launchNonce,
      sessionId: dispatch.sessionId,
      dispatchId: dispatch.dispatchId,
      validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
      identityEstablishedAt: '2026-09-01T12:00:01.000Z',
      exitedAt: '2026-09-01T12:00:50.000Z',
      verifiedAt: '2026-09-01T12:01:02.000Z',
      processState: 'EXITED' as const,
      exitCode: 0,
      signal: null,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
      runtimeConnection: 'NOT_CONFIGURED' as const,
    };
    const exitEvidence = {
      ...exitValue,
      evidenceHash: createCodexValidationProcessSessionRecoveryExitEvidenceHash(exitValue),
    };
    const cleanup = createCodexValidationProcessCleanupEvidence(
      {
        schemaVersion: 1,
        binding,
        dispatchId: dispatch.dispatchId,
        validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
        sessionId: dispatch.sessionId,
        processState: 'EXITED',
        exitCode: 0,
        signal: null,
        closedAt: exitEvidence.exitedAt,
        runtimeConnection: 'NOT_CONFIGURED',
      },
      {
        schemaVersion: 1,
        binding,
        dispatchId: dispatch.dispatchId,
        validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
        sessionId: dispatch.sessionId,
        issuedAt: dispatch.issuedAt,
        expiresAt: dispatch.expiresAt,
        runtimeConnection: 'NOT_CONFIGURED',
        reason: 'CANCELLED',
      },
      now,
    );
    const storedEvidence = {
      workspaceId,
      evidenceHash: exitEvidence.evidenceHash,
      evidenceId: exitEvidence.evidenceId,
      recoveryLeaseId: workItem.recoveryLeaseId,
      recoveryGeneration: 1,
      claimId: workItem.claimId,
      cleanupEvidenceHash: cleanup.cleanupEvidenceHash,
      ownerReference: principalId,
      ownerActorKind: 'SYSTEM',
      supervisionId: binding.supervisionId,
      launchNonce: binding.launchNonce,
      sessionId: dispatch.sessionId,
      dispatchId: dispatch.dispatchId,
      validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
      identityEstablishedAt: new Date(exitEvidence.identityEstablishedAt),
      exitedAt: new Date(exitEvidence.exitedAt),
      verifiedAt: new Date(exitEvidence.verifiedAt),
      processState: 'EXITED',
      exitCode: 0,
      signal: null,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY',
      runtimeConnection: 'NOT_CONFIGURED',
      recoveryCompletionIdempotencyKey: 'recovery-completion-unit',
      createdAt: now,
    };
    const completion = {
      workspaceId,
      cleanupEvidenceHash: cleanup.cleanupEvidenceHash,
      claimId: workItem.claimId,
      handoffAttemptId: workItem.handoffAttemptId,
      validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
      runtimeId: dispatch.runtimeId,
      connectionId: dispatch.connectionId,
      sessionId: dispatch.sessionId,
      dispatchId: dispatch.dispatchId,
      reason: 'CANCELLED',
      processState: 'EXITED',
      exitCode: 0,
      signal: null,
      closedAt: new Date(exitEvidence.exitedAt),
      runtimeConnection: 'NOT_CONFIGURED',
      completionIdempotencyKey: 'recovery-completion-unit',
      createdAt: now,
    };
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          workspaceId,
          id: workItem.claimId,
          handoffAttemptId: workItem.handoffAttemptId,
          validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
          runtimeId: dispatch.runtimeId,
          connectionId: dispatch.connectionId,
          sessionId: dispatch.sessionId,
          dispatchId: dispatch.dispatchId,
          ownerReference: principalId,
          ownerActorKind: 'SYSTEM',
          supervisionId: binding.supervisionId,
          launchNonce: binding.launchNonce,
          platform: binding.platform,
          manifestHash: binding.manifestHash,
          admissionEvidenceHash: binding.admissionEvidenceHash,
          admissionBindingHash: binding.admissionBindingHash,
          testOnly: binding.testOnly,
          state: 'CLAIMED',
          runtimeConnection: 'NOT_CONFIGURED',
          claimedAt: processClaimedAt,
          expiresAt: processExpiresAt,
          runId: dispatch.runId,
        },
      ])
      .mockResolvedValueOnce([
        {
          workspaceId,
          id: workItem.recoveryLeaseId,
          claimId: workItem.claimId,
          ownerReference: principalId,
          ownerActorKind: 'SYSTEM',
          generation: 1,
          state: 'CLAIMED',
          runtimeConnection: 'NOT_CONFIGURED',
          recoveryIdempotencyKey: 'lease-recovery-completion-unit',
          claimExpiresAt: processExpiresAt,
          claimedAt: leaseClaimedAt,
          expiresAt: leaseExpiresAt,
          createdAt: leaseClaimedAt,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ now }])
      .mockResolvedValueOnce([storedEvidence])
      .mockResolvedValueOnce([completion]);
    databaseMocks.transaction.mockImplementationOnce(async (operation) =>
      operation({ $queryRaw: queryRaw }),
    );

    const result = await service.completeCodexValidationProcessSessionRecovery(
      capability,
      { workspaceId, principalId },
      { workItem, exitEvidence, dispatch, idempotencyKey: 'recovery-completion-unit' },
    );

    expect(result.replayed).toBe(false);
    expect(result.evidence).toMatchObject({
      evidenceHash: exitEvidence.evidenceHash,
      identityAuthority: 'RETAINED_NATIVE_IDENTITY',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(result.completion).toMatchObject({
      cleanupEvidenceHash: cleanup.cleanupEvidenceHash,
      reason: 'CANCELLED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(queryRaw.mock.calls[7]?.[0].strings.join('')).toContain('recovery_exit_evidence');
    expect(queryRaw.mock.calls[8]?.[0].strings.join('')).toContain('process_session_completions');
    expect(recordOperationalEvent).toHaveBeenCalledOnce();

    const claimRow = queryRaw.mock.results[2]?.value;
    const leaseRow = queryRaw.mock.results[3]?.value;
    const replayQueryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(claimRow)
      .mockResolvedValueOnce(leaseRow)
      .mockResolvedValueOnce([storedEvidence])
      .mockResolvedValueOnce([completion])
      .mockResolvedValueOnce([{ now: new Date(now.getTime() + 1) }]);
    databaseMocks.transaction.mockImplementationOnce(async (operation) =>
      operation({ $queryRaw: replayQueryRaw }),
    );
    await expect(
      service.completeCodexValidationProcessSessionRecovery(
        capability,
        { workspaceId, principalId },
        { workItem, exitEvidence, dispatch, idempotencyKey: 'recovery-completion-unit' },
      ),
    ).resolves.toMatchObject({ replayed: true });
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

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function recoveryDispatch(expiresAt: string): CodexValidationDispatchCandidate {
  const issuedAt = new Date(Date.parse(expiresAt) - 60_000).toISOString();
  const base = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND as typeof CODEX_APP_SERVER_ADAPTER_KIND,
    workspaceId,
    runtimeId: 'runtime-unit',
    connectionId: 'connection-unit',
    sessionId: 'session-recovery-completion-unit',
    principalReference: 'principal-recovery-completion-unit',
    authGeneration: 1,
    registrationCandidateHash: '4'.repeat(64),
    capabilityCandidateHash: '5'.repeat(64),
    heartbeatCandidateHash: '6'.repeat(64),
    capabilityDigest: '7'.repeat(64),
    bridgeIdentityHash: '8'.repeat(64),
    secretBindingHash: '9'.repeat(64),
    dispatchId: 'dispatch-recovery-completion-unit',
    taskId: 'task-recovery-completion-unit',
    runId: 'run-recovery-completion-unit',
    agentId: 'agent-recovery-completion-unit',
    authorityLevel: 3 as const,
    taskPolicyHash: 'a'.repeat(64),
    maximumCostMinorUnits: 0 as const,
    maximumComputeUnits: 1,
    maximumDurationMs: 60_000,
    outboundSequence: 1 as const,
    messageId: 'dispatch-recovery-completion-unit',
    challengeCode: 'codex.runtime.round-trip.v1' as const,
    issuedAt,
    expiresAt,
    assignmentState: 'NOT_CONFIGURED' as const,
    deliveryState: 'NOT_SENT' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  const payload = codexValidationDispatchPayload(base);
  const payloadDigest = sha256(payload);
  const unsigned = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    workspaceId: base.workspaceId,
    runtimeId: base.runtimeId,
    connectionId: base.connectionId,
    sessionId: base.sessionId,
    principalReference: base.principalReference,
    sequence: 1,
    messageId: base.messageId,
    type: 'DISPATCH',
    issuedAt,
    expiresAt,
    payloadDigest,
    payload,
  };
  const normalized = { ...base, payloadDigest, unsignedEnvelopeDigest: sha256(unsigned) };
  return { ...normalized, validationDispatchCandidateHash: sha256(normalized) };
}

function recoveryDispatchRow(dispatch: CodexValidationDispatchCandidate) {
  return {
    ...dispatch,
    issuedAt: new Date(dispatch.issuedAt),
    expiresAt: new Date(dispatch.expiresAt),
  };
}

function recoveryAuthorityFixture() {
  const now = Date.now();
  const processClaimedAt = new Date(now - 62_000);
  const processExpiresAt = new Date(now - 2_000);
  const leaseClaimedAt = new Date(now - 1_000);
  const leaseExpiresAt = new Date(now + 14_000);
  const binding = processBinding('supervision-recovery-authority-unit');
  const dispatch = recoveryDispatch(processExpiresAt.toISOString());
  const workItem = {
    schemaVersion: 1 as const,
    recoveryLeaseId: 'lease-recovery-authority-unit',
    recoveryGeneration: 1,
    claimId: 'claim-recovery-authority-unit',
    handoffAttemptId: 'handoff-recovery-authority-unit',
    validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
    sessionId: dispatch.sessionId,
    dispatchId: dispatch.dispatchId,
    runId: dispatch.runId,
    binding,
    processClaimedAt: processClaimedAt.toISOString(),
    processExpiresAt: processExpiresAt.toISOString(),
    leaseClaimedAt: leaseClaimedAt.toISOString(),
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  const exitValue = {
    schemaVersion: 1 as const,
    evidenceId: 'exit-recovery-authority-unit',
    recoveryLeaseId: workItem.recoveryLeaseId,
    recoveryGeneration: workItem.recoveryGeneration,
    claimId: workItem.claimId,
    supervisionId: binding.supervisionId,
    launchNonce: binding.launchNonce,
    sessionId: workItem.sessionId,
    dispatchId: workItem.dispatchId,
    validationDispatchCandidateHash: workItem.validationDispatchCandidateHash,
    identityEstablishedAt: new Date(processClaimedAt.getTime() + 1_000).toISOString(),
    exitedAt: new Date(processExpiresAt.getTime() - 1_000).toISOString(),
    verifiedAt: new Date(leaseClaimedAt.getTime() + 500).toISOString(),
    processState: 'EXITED' as const,
    exitCode: 0,
    signal: null,
    identityAuthority: 'RETAINED_NATIVE_IDENTITY' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  return {
    dispatch,
    workItem,
    exitEvidence: {
      ...exitValue,
      evidenceHash: createCodexValidationProcessSessionRecoveryExitEvidenceHash(exitValue),
    },
  };
}
