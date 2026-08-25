import { describe, expect, it } from 'vitest';
import {
  BoundedBridgeLineBuffer,
  BRIDGE_PROTOCOL_VERSION,
  BridgeProtocolError,
  DenyRuntimeProcessLauncher,
  decodeBridgeLine,
  deriveBridgeKeys,
  digestBridgePayload,
  encodeBridgeLine,
  signBridgeEnvelope,
  assertBridgeTransition,
  assertDispatchTransition,
  validateUsageDelta,
  verifyBridgeEnvelope,
} from '.';

const secret = new Uint8Array(32).fill(7);
const context = {
  workspaceId: 'workspace-1',
  runtimeId: 'fixture-runtime',
  connectionId: 'connection-1',
  sessionId: 'session-1',
  principalReference: 'runtime-principal-1',
  parentNonce: 'parent-nonce-1',
  runtimeNonce: 'runtime-nonce-1',
};

function frame(sequence = 1, payload: Readonly<Record<string, unknown>> = { health: 'HEALTHY' }) {
  const keys = deriveBridgeKeys(secret, context);
  const now = new Date('2026-08-25T12:00:00.000Z');
  const envelope = signBridgeEnvelope(
    {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      workspaceId: context.workspaceId,
      runtimeId: context.runtimeId,
      connectionId: context.connectionId,
      sessionId: context.sessionId,
      principalReference: context.principalReference,
      sequence,
      messageId: `message-${sequence}`,
      type: 'HEARTBEAT',
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      payloadDigest: digestBridgePayload(payload),
      payload,
    },
    keys.runtimeToParent,
  );
  return { envelope, keys, now };
}

describe('bounded canonical Agent Bridge protocol', () => {
  it('round-trips a canonical authenticated frame and binds its principal/session direction', () => {
    const { envelope, keys, now } = frame();
    const decoded = decodeBridgeLine(encodeBridgeLine(envelope));
    expect(decoded).toEqual(envelope);
    expect(() => verifyBridgeEnvelope(decoded, keys.runtimeToParent, context, now)).not.toThrow();
    expect(() => verifyBridgeEnvelope(decoded, keys.parentToRuntime, context, now)).toThrow(
      BridgeProtocolError,
    );
    expect(() =>
      verifyBridgeEnvelope(
        decoded,
        keys.runtimeToParent,
        { ...context, workspaceId: 'other' },
        now,
      ),
    ).toThrow(BridgeProtocolError);
  });

  it('rejects non-canonical, duplicate, malformed, oversized, expired, and tampered frames', () => {
    const { envelope, keys } = frame();
    const json = JSON.stringify(envelope);
    expect(() => decodeBridgeLine(Buffer.from(` ${json}\n`))).toThrow(BridgeProtocolError);
    expect(() =>
      decodeBridgeLine(
        Buffer.from(`{"mac":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",${json.slice(1)}\n`),
      ),
    ).toThrow(BridgeProtocolError);
    expect(() => decodeBridgeLine(Buffer.from([0xff, 0x0a]))).toThrow(BridgeProtocolError);
    expect(() => decodeBridgeLine(Buffer.alloc(65_537, 32))).toThrow(BridgeProtocolError);
    expect(() =>
      encodeBridgeLine({ ...envelope, issuedAt: 'August 25, 2026 12:00:00 UTC' }),
    ).toThrow(/canonical UTC/u);
    expect(() => encodeBridgeLine({ ...envelope, expiresAt: '2026-08-25T11:59:59.000Z' })).toThrow(
      /expiry/u,
    );
    expect(() => encodeBridgeLine({ ...envelope, expiresAt: '2026-08-25T12:05:00.001Z' })).toThrow(
      /five minutes/u,
    );
    expect(() =>
      verifyBridgeEnvelope(
        envelope,
        keys.runtimeToParent,
        context,
        new Date('2026-08-25T12:02:00Z'),
      ),
    ).toThrow(/expired/u);
    expect(() =>
      verifyBridgeEnvelope(
        { ...envelope, payload: { health: 'DEGRADED' } },
        keys.runtimeToParent,
        context,
        new Date('2026-08-25T12:00:00Z'),
      ),
    ).toThrow(/digest/u);
  });

  it('rejects sensitive material in payload keys, values, and envelope references', () => {
    expect(() => frame(1, { password: 'synthetic' })).toThrow(BridgeProtocolError);
    expect(() => frame(1, { resultCode: 'chain of thought' })).toThrow(BridgeProtocolError);
    const { envelope } = frame();
    expect(() => encodeBridgeLine({ ...envelope, messageId: 'glpat-secretvalue123' })).toThrow(
      BridgeProtocolError,
    );
  });

  it('bounds partial-line buffering', () => {
    const { envelope } = frame();
    const encoded = encodeBridgeLine(envelope);
    const buffer = new BoundedBridgeLineBuffer();
    expect(buffer.push(encoded.subarray(0, 20))).toEqual([]);
    expect(buffer.push(encoded.subarray(20))).toEqual([envelope]);
    const rejected = new BoundedBridgeLineBuffer();
    expect(() => rejected.push(Buffer.alloc(131_073))).toThrow(BridgeProtocolError);
    expect(rejected.push(encoded)).toEqual([envelope]);
  });

  it('keeps the production launcher deny-only', async () => {
    await expect(
      new DenyRuntimeProcessLauncher().launch({
        executableReference: 'fixture-only',
        runtimeId: 'fixture-runtime',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow(/not enabled/u);
  });

  it('enforces session, dispatch, and usage state policy', () => {
    expect(() => assertBridgeTransition('CHALLENGED', 'AUTHENTICATED')).not.toThrow();
    expect(() => assertBridgeTransition('CHALLENGED', 'PARTIAL')).toThrow(BridgeProtocolError);
    expect(() => assertDispatchTransition('ACCEPTED', 'CANCEL_REQUESTED')).not.toThrow();
    expect(() => assertDispatchTransition('CANCEL_REQUESTED', 'FAILED')).toThrow(
      BridgeProtocolError,
    );
    expect(() => assertDispatchTransition('COMPLETED', 'ACCEPTED')).toThrow(BridgeProtocolError);
    expect(() =>
      validateUsageDelta({ computeUnits: 0, costMinorUnits: 0, currency: 'EUR' }),
    ).not.toThrow();
    expect(() =>
      validateUsageDelta({ computeUnits: -1, costMinorUnits: 0, currency: 'EUR' }),
    ).toThrow(BridgeProtocolError);
  });

  it('binds directional keys to every identity and nonce dimension', () => {
    const baseline = deriveBridgeKeys(secret, context);
    const drifted = deriveBridgeKeys(secret, { ...context, runtimeNonce: 'runtime-nonce-2' });
    expect(
      Buffer.from(baseline.parentToRuntime).equals(Buffer.from(baseline.runtimeToParent)),
    ).toBe(false);
    expect(Buffer.from(baseline.runtimeToParent).equals(Buffer.from(drifted.runtimeToParent))).toBe(
      false,
    );
  });
});
