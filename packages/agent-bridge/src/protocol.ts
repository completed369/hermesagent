export const BRIDGE_PROTOCOL_VERSION = 'ventureos.bridge.v1' as const;
export const MAX_BRIDGE_LINE_BYTES = 65_536;
export const MAX_BRIDGE_BUFFER_BYTES = 131_072;

export type BridgeMessageType =
  | 'CHALLENGE'
  | 'AUTHENTICATE'
  | 'CAPABILITIES'
  | 'HEARTBEAT'
  | 'DISPATCH_ACCEPTED'
  | 'PROGRESS'
  | 'ARTIFACT'
  | 'USAGE'
  | 'CANCELLED'
  | 'RESULT'
  | 'FAILED';

export interface BridgeEnvelope {
  readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly sequence: number;
  readonly messageId: string;
  readonly type: BridgeMessageType;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly payloadDigest: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly mac: string;
}

export type BridgeSessionState =
  'CHALLENGED' | 'AUTHENTICATED' | 'CAPABILITIES_VERIFIED' | 'PARTIAL' | 'CLOSED';

export type BridgeDispatchState =
  'PREPARED' | 'ACCEPTED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';

export const BRIDGE_SESSION_TRANSITIONS: Readonly<
  Record<BridgeSessionState, readonly BridgeSessionState[]>
> = {
  CHALLENGED: ['AUTHENTICATED', 'CLOSED'],
  AUTHENTICATED: ['CAPABILITIES_VERIFIED', 'CLOSED'],
  CAPABILITIES_VERIFIED: ['PARTIAL', 'CLOSED'],
  PARTIAL: ['CLOSED'],
  CLOSED: [],
};

export const BRIDGE_DISPATCH_TRANSITIONS: Readonly<
  Record<BridgeDispatchState, readonly BridgeDispatchState[]>
> = {
  PREPARED: ['ACCEPTED', 'FAILED'],
  ACCEPTED: ['CANCEL_REQUESTED', 'COMPLETED', 'FAILED'],
  CANCEL_REQUESTED: ['CANCELLED'],
  CANCELLED: [],
  COMPLETED: [],
  FAILED: [],
};
