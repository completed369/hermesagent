import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { signBridgeEnvelope } from './auth';
import { canonicalJson, decodeBridgeLine } from './codec';
import {
  BoundedCodexValidationEgressController,
  CodexValidationEgressControllerError,
  type CodexValidationEgressHandoffClaim,
} from './codex-validation-egress-controller';
import { CODEX_VALIDATION_CHALLENGE } from './codex-validation-dispatch';
import type { BridgeEgressTransport, BridgeEgressTransportRequest } from './egress-controller';
import { BRIDGE_PROTOCOL_VERSION } from './protocol';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const hashText = (value: string) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const payload = {
    schemaVersion: 1,
    challengeCode: CODEX_VALIDATION_CHALLENGE,
    dispatchId: 'validation-dispatch-1',
    taskId: 'validation-task-1',
    runId: 'validation-run-1',
    agentId: 'agent:codex-validator-1',
    authorityLevel: 3,
    taskPolicyHash: 'a'.repeat(64),
    registrationCandidateHash: 'b'.repeat(64),
    capabilityCandidateHash: 'c'.repeat(64),
    heartbeatCandidateHash: 'd'.repeat(64),
  };
  const unsigned = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    workspaceId: 'workspace-1',
    runtimeId: 'codex.runtime-1',
    connectionId: 'connection-1',
    sessionId: 'session-1',
    principalReference: 'principal:codex-runtime-1',
    sequence: 1,
    messageId: payload.dispatchId,
    type: 'DISPATCH' as const,
    issuedAt: '2026-08-31T20:00:00.000Z',
    expiresAt: '2026-08-31T20:01:00.000Z',
    payloadDigest: hash(payload),
    payload,
  };
  const frame = signBridgeEnvelope(unsigned, new Uint8Array(32).fill(4));
  const claim: CodexValidationEgressHandoffClaim = {
    schemaVersion: 1,
    id: 'validation-attempt-1',
    workspaceId: unsigned.workspaceId,
    validationDispatchCandidateHash: 'e'.repeat(64),
    heartbeatCandidateHash: payload.heartbeatCandidateHash,
    ownerReference: 'control-plane:validation-egress-v1',
    ownerActorKind: 'SYSTEM',
    claimIdempotencyKey: 'validation-claim-1',
    generation: 1,
    state: 'CLAIMED',
    runtimeId: unsigned.runtimeId,
    connectionId: unsigned.connectionId,
    sessionId: unsigned.sessionId,
    dispatchId: payload.dispatchId,
    taskId: payload.taskId,
    runId: payload.runId,
    agentId: payload.agentId,
    authorityLevel: 3,
    taskPolicyHash: payload.taskPolicyHash,
    maximumCostMinorUnits: 0,
    maximumComputeUnits: 10,
    maximumDurationMs: 30_000,
    outboundSequence: 1,
    messageId: payload.dispatchId,
    challengeCode: CODEX_VALIDATION_CHALLENGE,
    payloadDigest: frame.payloadDigest,
    unsignedEnvelopeDigest: hash(unsigned),
    signedEnvelopeDigest: hash(frame),
    authenticationTagDigest: hashText(frame.mac),
    validationIssuedAt: unsigned.issuedAt,
    validationExpiresAt: unsigned.expiresAt,
    claimedAt: '2026-08-31T20:00:10.000Z',
    expiresAt: '2026-08-31T20:00:20.000Z',
  };
  return { claim, frame };
}

class CopyingTransport implements BridgeEgressTransport {
  readonly writes: BridgeEgressTransportRequest[] = [];
  async write(request: Readonly<BridgeEgressTransportRequest>): Promise<void> {
    this.writes.push({ ...request, line: Uint8Array.from(request.line) });
  }
}

describe('bounded Codex validation egress controller', () => {
  it('hands one exact frame to one local transport without delivery claims', async () => {
    const { claim, frame } = fixture();
    const transport = new CopyingTransport();
    const result = await new BoundedCodexValidationEgressController(
      transport,
      () => new Date('2026-08-31T20:00:11.000Z'),
    ).handoff(claim, frame);
    expect(transport.writes).toHaveLength(1);
    expect(decodeBridgeLine(transport.writes[0]!.line)).toEqual(frame);
    expect(result).toMatchObject({
      attemptId: claim.id,
      dispatchId: claim.dispatchId,
      sequence: 1,
    });
    expect(result).not.toHaveProperty('delivered');
    expect(result).not.toHaveProperty('acknowledged');
    const oneUseController = new BoundedCodexValidationEgressController(
      new CopyingTransport(),
      () => new Date('2026-08-31T20:00:11.000Z'),
    );
    await oneUseController.handoff({ ...claim, id: 'validation-attempt-2' }, frame);
    await expect(
      oneUseController.handoff({ ...claim, id: 'validation-attempt-2' }, frame),
    ).rejects.toMatchObject({ code: 'USED_HANDOFF' });
  });

  it('denies binding drift and the production default before claiming success', async () => {
    const { claim, frame } = fixture();
    const transport = new CopyingTransport();
    await expect(
      new BoundedCodexValidationEgressController(
        transport,
        () => new Date('2026-08-31T20:00:11.000Z'),
      ).handoff({ ...claim, runId: 'other-run' }, frame),
    ).rejects.toBeInstanceOf(CodexValidationEgressControllerError);
    expect(transport.writes).toHaveLength(0);
    await expect(
      new BoundedCodexValidationEgressController(
        undefined,
        () => new Date('2026-08-31T20:00:11.000Z'),
      ).handoff(claim, frame),
    ).rejects.toMatchObject({ code: 'TRANSPORT_DENIED' });
  });

  it('denies expired, overlong, cancelled, and mutated authority', async () => {
    const { claim, frame } = fixture();
    for (const changed of [
      { ...claim, maximumCostMinorUnits: 1 },
      { ...claim, authorityLevel: 4 },
      { ...claim, expiresAt: '2026-08-31T20:00:30.001Z' },
      { ...claim, signedEnvelopeDigest: '0'.repeat(64) },
      { ...claim, ownerReference: 'api-key-reference' },
    ])
      await expect(
        new BoundedCodexValidationEgressController(
          new CopyingTransport(),
          () => new Date('2026-08-31T20:00:11.000Z'),
        ).handoff(changed, frame),
      ).rejects.toBeInstanceOf(CodexValidationEgressControllerError);
    await expect(
      new BoundedCodexValidationEgressController(
        new CopyingTransport(),
        () => new Date('2026-08-31T20:00:21.000Z'),
      ).handoff(claim, frame),
    ).rejects.toMatchObject({ code: 'AUTHORITY_EXPIRED' });
    const abort = new AbortController();
    abort.abort();
    await expect(
      new BoundedCodexValidationEgressController(
        new CopyingTransport(),
        () => new Date('2026-08-31T20:00:11.000Z'),
      ).handoff(claim, frame, { signal: abort.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
