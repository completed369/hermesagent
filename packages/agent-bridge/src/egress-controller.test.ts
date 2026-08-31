import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, decodeBridgeLine } from './codec';
import {
  BoundedBridgeEgressController,
  BridgeEgressControllerError,
  DenyBridgeEgressTransport,
  MAX_BRIDGE_EGRESS_WRITE_TIMEOUT_MS,
  type BridgeEgressHandoffClaim,
  type BridgeEgressTransport,
  type BridgeEgressTransportRequest,
} from './egress-controller';
import { deriveBridgeKeys, digestBridgePayload, signBridgeEnvelope } from './auth';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope } from './protocol';

const now = new Date('2026-08-31T08:00:00.000Z');
const context = {
  workspaceId: 'workspace-1',
  runtimeId: 'runtime-1',
  connectionId: 'connection-1',
  sessionId: 'session-1',
  principalReference: 'runtime-principal-1',
  parentNonce: 'parent-nonce-1',
  runtimeNonce: 'runtime-nonce-1',
};

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function fixture(): { claim: BridgeEgressHandoffClaim; frame: BridgeEnvelope } {
  const payload = Object.freeze({
    schemaVersion: 1,
    dispatchId: 'dispatch-1',
    taskId: 'task-1',
    runId: 'run-1',
    agentId: 'agent-1',
    authorityLevel: 3,
    brokerEvidenceId: 'broker-1',
    brokerEvidenceHash: '1'.repeat(64),
    assignmentEvidenceId: 'assignment-1',
    assignmentEvidenceHash: '2'.repeat(64),
    dispatchEnvelopeHash: '3'.repeat(64),
    policyHash: '4'.repeat(64),
    capabilityPolicyHash: '5'.repeat(64),
    capabilityDigest: '6'.repeat(64),
  });
  const keys = deriveBridgeKeys(new Uint8Array(32).fill(7), context);
  const frame = signBridgeEnvelope(
    {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      workspaceId: context.workspaceId,
      runtimeId: context.runtimeId,
      connectionId: context.connectionId,
      sessionId: context.sessionId,
      principalReference: context.principalReference,
      sequence: 1,
      messageId: 'capsule-1',
      type: 'DISPATCH',
      issuedAt: new Date(now.getTime() - 1_000).toISOString(),
      expiresAt: new Date(now.getTime() + 30_000).toISOString(),
      payloadDigest: digestBridgePayload(payload),
      payload,
    },
    keys.parentToRuntime,
  );
  keys.parentToRuntime.fill(0);
  keys.runtimeToParent.fill(0);
  const { mac: _mac, ...unsigned } = frame;
  return {
    frame,
    claim: Object.freeze({
      id: 'attempt-1',
      workspaceId: context.workspaceId,
      outboxId: 'capsule-1',
      ownerReference: 'control-plane-1',
      ownerActorKind: 'SYSTEM',
      claimIdempotencyKey: 'claim@scope-1',
      generation: 1,
      runtimeId: context.runtimeId,
      connectionId: context.connectionId,
      sessionId: context.sessionId,
      dispatchId: payload.dispatchId,
      taskId: payload.taskId,
      runId: payload.runId,
      agentId: payload.agentId,
      authorityLevel: 3,
      outboundSequence: frame.sequence,
      messageId: frame.messageId,
      messageType: 'DISPATCH',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      outboxState: 'PREPARED',
      brokerEvidenceId: payload.brokerEvidenceId,
      brokerEvidenceHash: payload.brokerEvidenceHash,
      assignmentEvidenceId: payload.assignmentEvidenceId,
      assignmentEvidenceHash: payload.assignmentEvidenceHash,
      dispatchEnvelopeHash: payload.dispatchEnvelopeHash,
      policyHash: payload.policyHash,
      capabilityPolicyHash: payload.capabilityPolicyHash,
      capabilityDigest: payload.capabilityDigest,
      payloadDigest: frame.payloadDigest,
      unsignedEnvelopeDigest: sha256(unsigned),
      signedEnvelopeDigest: sha256(frame),
      authenticationTagDigest: createHash('sha256').update(frame.mac).digest('hex'),
      outboxIdempotencyKey: 'outbox@scope-1',
      outboxIssuedAt: new Date(frame.issuedAt),
      outboxExpiresAt: new Date(frame.expiresAt),
      outboxPreparedAt: new Date(frame.issuedAt),
      claimedAt: new Date(now),
      expiresAt: new Date(now.getTime() + 15_000),
    }),
  };
}

class CopyingTransport implements BridgeEgressTransport {
  readonly retainedLines: Uint8Array[] = [];
  readonly writes: Array<
    Omit<BridgeEgressTransportRequest, 'line' | 'signal'> & { line: Uint8Array }
  > = [];

  async write(request: Readonly<BridgeEgressTransportRequest>): Promise<void> {
    this.retainedLines.push(request.line);
    this.writes.push({ ...request, line: Uint8Array.from(request.line) });
  }
}

describe('bounded bridge egress controller', () => {
  it('copies exactly one canonical DISPATCH line and returns only local write evidence', async () => {
    const { claim, frame } = fixture();
    const transport = new CopyingTransport();
    const result = await new BoundedBridgeEgressController(transport, () => now).handoff(
      claim,
      frame,
      { timeoutMs: 1_000 },
    );
    expect(transport.writes).toHaveLength(1);
    expect(decodeBridgeLine(transport.writes[0]!.line)).toEqual(frame);
    expect(result).toEqual({
      schemaVersion: 1,
      attemptId: claim.id,
      workspaceId: claim.workspaceId,
      runtimeId: claim.runtimeId,
      connectionId: claim.connectionId,
      sessionId: claim.sessionId,
      dispatchId: claim.dispatchId,
      messageId: claim.messageId,
      sequence: claim.outboundSequence,
      acceptedBytes: transport.writes[0]!.line.byteLength,
      completedAt: now.toISOString(),
    });
    expect(result).not.toHaveProperty('delivered');
    expect(result).not.toHaveProperty('acknowledged');
    expect(result).not.toHaveProperty('status');
    expect([...transport.retainedLines[0]!].every((byte) => byte === 0)).toBe(true);
  });

  it('denies drift across every durable frame-binding layer before transport', async () => {
    const { claim, frame } = fixture();
    const transport = new CopyingTransport();
    const controller = new BoundedBridgeEgressController(transport, () => now);
    for (const [driftedClaim, driftedFrame] of [
      [{ ...claim, workspaceId: 'workspace-2' }, frame],
      [{ ...claim, signedEnvelopeDigest: '0'.repeat(64) }, frame],
      [claim, { ...frame, messageId: 'capsule-2' }],
      [claim, { ...frame, payload: { ...frame.payload, runId: 'run-2' } }],
      [{ ...claim, authorityLevel: 4 }, frame],
    ] as const) {
      await expect(controller.handoff(driftedClaim, driftedFrame)).rejects.toBeInstanceOf(
        BridgeEgressControllerError,
      );
    }
    expect(transport.writes).toHaveLength(0);
  });

  it('rejects expired, oversized-timeout, cancelled, and concurrent handoffs', async () => {
    const { claim, frame } = fixture();
    await expect(
      new BoundedBridgeEgressController(
        new CopyingTransport(),
        () => new Date(new Date(claim.expiresAt).getTime()),
      ).handoff(claim, frame),
    ).rejects.toMatchObject({ code: 'AUTHORITY_EXPIRED' });
    await expect(
      new BoundedBridgeEgressController(new CopyingTransport(), () => now).handoff(claim, frame, {
        timeoutMs: MAX_BRIDGE_EGRESS_WRITE_TIMEOUT_MS + 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TIMEOUT' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      new BoundedBridgeEgressController(new CopyingTransport(), () => now).handoff(claim, frame, {
        signal: aborted.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });

    let releaseWrite!: () => void;
    const blocking: BridgeEgressTransport = {
      write: () => new Promise<void>((resolve) => (releaseWrite = resolve)),
    };
    const controller = new BoundedBridgeEgressController(blocking, () => now);
    const first = controller.handoff(claim, frame, { timeoutMs: 1_000 });
    await expect(controller.handoff(claim, frame)).rejects.toMatchObject({
      code: 'CONCURRENT_HANDOFF',
    });
    releaseWrite();
    await expect(first).resolves.toMatchObject({ attemptId: claim.id });
  });

  it('fails closed on timeout, transport error, mutation, and the production default', async () => {
    const { claim, frame } = fixture();
    let timedOutRequest: Readonly<BridgeEgressTransportRequest> | undefined;
    const timeoutController = new BoundedBridgeEgressController(
      {
        write: (request) => {
          timedOutRequest = request;
          return new Promise<void>(() => {});
        },
      },
      () => now,
    );
    await expect(timeoutController.handoff(claim, frame, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'WRITE_TIMEOUT',
    });
    expect(timedOutRequest?.signal.aborted).toBe(true);
    expect([...(timedOutRequest?.line ?? [])].every((byte) => byte === 0)).toBe(true);
    await expect(
      new BoundedBridgeEgressController(
        {
          async write() {
            throw new Error('sensitive provider detail');
          },
        },
        () => now,
      ).handoff(claim, frame),
    ).rejects.toMatchObject({ code: 'TRANSPORT_DENIED' });
    await expect(
      new BoundedBridgeEgressController(
        {
          async write(request) {
            request.line[0] = 0;
          },
        },
        () => now,
      ).handoff(claim, frame),
    ).rejects.toMatchObject({ code: 'TRANSPORT_MUTATED_FRAME' });
    await expect(
      new BoundedBridgeEgressController(new DenyBridgeEgressTransport(), () => now).handoff(
        claim,
        frame,
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_DENIED' });
  });
});
