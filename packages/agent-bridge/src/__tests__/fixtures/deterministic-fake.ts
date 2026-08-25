import {
  BRIDGE_PROTOCOL_VERSION,
  deriveBridgeKeys,
  digestBridgePayload,
  signBridgeEnvelope,
  type BridgeEnvelope,
  type BridgeKeyContext,
  type BridgeMessageType,
} from '../..';

/** Test-only fixture. It is deliberately absent from the package root exports. */
export class DeterministicFakeRuntime {
  private sequence = 0;
  private readonly runtimeKey: Uint8Array;

  constructor(
    private readonly context: BridgeKeyContext,
    secret: Uint8Array,
    private readonly now: Date,
  ) {
    this.runtimeKey = deriveBridgeKeys(secret, context).runtimeToParent;
  }

  emit(type: BridgeMessageType, payload: Readonly<Record<string, unknown>>): BridgeEnvelope {
    this.sequence += 1;
    return this.emitAt(this.sequence, type, payload);
  }

  emitAt(
    sequence: number,
    type: BridgeMessageType,
    payload: Readonly<Record<string, unknown>>,
  ): BridgeEnvelope {
    return signBridgeEnvelope(
      {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        workspaceId: this.context.workspaceId,
        runtimeId: this.context.runtimeId,
        connectionId: this.context.connectionId,
        sessionId: this.context.sessionId,
        principalReference: this.context.principalReference,
        sequence,
        messageId: `fixture-message-${sequence}`,
        type,
        issuedAt: this.now.toISOString(),
        expiresAt: new Date(this.now.getTime() + 60_000).toISOString(),
        payloadDigest: digestBridgePayload(payload),
        payload,
      },
      this.runtimeKey,
    );
  }
}
