import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { canonicalJson, validateBridgeEnvelope, BridgeProtocolError } from './codec';
import type { BridgeEnvelope } from './protocol';

export interface BridgeDirectionalKeys {
  readonly parentToRuntime: Uint8Array;
  readonly runtimeToParent: Uint8Array;
}

export interface BridgeKeyContext {
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly parentNonce: string;
  readonly runtimeNonce: string;
}

export function assertBridgeSecretStrength(secret: Uint8Array): void {
  if (secret.byteLength < 32)
    throw new BridgeProtocolError('Bridge secret must contain at least 256 bits');
}

export function deriveBridgeKeys(
  secret: Uint8Array,
  context: BridgeKeyContext,
): BridgeDirectionalKeys {
  assertBridgeSecretStrength(secret);
  const salt = createHash('sha256').update(canonicalJson(context)).digest();
  const derive = (direction: string) =>
    new Uint8Array(
      hkdfSync('sha256', secret, salt, Buffer.from(`ventureos.bridge.v1:${direction}`), 32),
    );
  return {
    parentToRuntime: derive('parent-to-runtime'),
    runtimeToParent: derive('runtime-to-parent'),
  };
}

export function digestBridgePayload(payload: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function unsignedEnvelope(envelope: BridgeEnvelope): Omit<BridgeEnvelope, 'mac'> {
  const { mac: _mac, ...unsigned } = envelope;
  return unsigned;
}

export function signBridgeEnvelope(
  envelope: Omit<BridgeEnvelope, 'mac'>,
  key: Uint8Array,
): BridgeEnvelope {
  if (digestBridgePayload(envelope.payload) !== envelope.payloadDigest) {
    throw new BridgeProtocolError('Payload digest does not match payload');
  }
  const mac = createHmac('sha256', key).update(canonicalJson(envelope)).digest('base64url');
  const signed = { ...envelope, mac };
  validateBridgeEnvelope(signed);
  return signed;
}

export function verifyBridgeEnvelope(
  envelope: BridgeEnvelope,
  key: Uint8Array,
  expected: Pick<
    BridgeEnvelope,
    'workspaceId' | 'runtimeId' | 'connectionId' | 'sessionId' | 'principalReference'
  >,
  now = new Date(),
): void {
  validateBridgeEnvelope(envelope);
  for (const field of [
    'workspaceId',
    'runtimeId',
    'connectionId',
    'sessionId',
    'principalReference',
  ] as const) {
    if (envelope[field] !== expected[field])
      throw new BridgeProtocolError(`Envelope ${field} mismatch`);
  }
  if (new Date(envelope.issuedAt).getTime() > now.getTime() + 30_000) {
    throw new BridgeProtocolError('Envelope is issued too far in the future');
  }
  if (new Date(envelope.expiresAt).getTime() <= now.getTime()) {
    throw new BridgeProtocolError('Envelope expired');
  }
  if (digestBridgePayload(envelope.payload) !== envelope.payloadDigest) {
    throw new BridgeProtocolError('Payload digest mismatch');
  }
  const expectedMac = createHmac('sha256', key)
    .update(canonicalJson(unsignedEnvelope(envelope)))
    .digest();
  const actualMac = Buffer.from(envelope.mac, 'base64url');
  if (actualMac.byteLength !== expectedMac.byteLength || !timingSafeEqual(actualMac, expectedMac)) {
    throw new BridgeProtocolError('Envelope authentication failed');
  }
}

export function digestSecretReference(secret: Uint8Array): string {
  return createHash('sha256').update(secret).digest('hex');
}
