import { createHash, timingSafeEqual } from 'node:crypto';
import { canonicalJson, encodeBridgeLine, BridgeProtocolError } from './codec';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope } from './protocol';

export const MAX_BRIDGE_EGRESS_WRITE_TIMEOUT_MS = 5_000;

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$/u;
const SAFE_OWNER_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const SENSITIVE =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+|\b(?:sk|gh[opusr]|github_pat|npm|glpat|xox[baprs]|hf)[_-][A-Za-z0-9_-]{12,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b|^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$)/iu;

const CLAIM_KEYS = [
  'agentId',
  'assignmentEvidenceHash',
  'assignmentEvidenceId',
  'authenticationTagDigest',
  'authorityLevel',
  'brokerEvidenceHash',
  'brokerEvidenceId',
  'capabilityDigest',
  'capabilityPolicyHash',
  'claimedAt',
  'claimIdempotencyKey',
  'connectionId',
  'dispatchEnvelopeHash',
  'dispatchId',
  'expiresAt',
  'generation',
  'id',
  'messageId',
  'messageType',
  'outboundSequence',
  'outboxExpiresAt',
  'outboxId',
  'outboxIdempotencyKey',
  'outboxIssuedAt',
  'outboxPreparedAt',
  'outboxState',
  'ownerActorKind',
  'ownerReference',
  'payloadDigest',
  'policyHash',
  'protocolVersion',
  'runId',
  'runtimeId',
  'sessionId',
  'signedEnvelopeDigest',
  'taskId',
  'unsignedEnvelopeDigest',
  'workspaceId',
] as const;

const PAYLOAD_KEYS = [
  'agentId',
  'assignmentEvidenceHash',
  'assignmentEvidenceId',
  'authorityLevel',
  'brokerEvidenceHash',
  'brokerEvidenceId',
  'capabilityDigest',
  'capabilityPolicyHash',
  'dispatchEnvelopeHash',
  'dispatchId',
  'policyHash',
  'runId',
  'schemaVersion',
  'taskId',
] as const;

export type BridgeEgressControllerErrorCode =
  | 'INVALID_CLAIM'
  | 'INVALID_FRAME'
  | 'AUTHORITY_EXPIRED'
  | 'INVALID_TIMEOUT'
  | 'CONCURRENT_HANDOFF'
  | 'CANCELLED'
  | 'WRITE_TIMEOUT'
  | 'TRANSPORT_DENIED'
  | 'TRANSPORT_MUTATED_FRAME';

export class BridgeEgressControllerError extends Error {
  constructor(readonly code: BridgeEgressControllerErrorCode) {
    super(`Bridge egress denied: ${code}`);
  }
}

export interface BridgeEgressHandoffClaim {
  readonly id: string;
  readonly workspaceId: string;
  readonly outboxId: string;
  readonly ownerReference: string;
  readonly ownerActorKind: 'HUMAN' | 'AGENT' | 'SYSTEM';
  readonly claimIdempotencyKey: string;
  readonly generation: number;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly authorityLevel: 0 | 1 | 2 | 3;
  readonly outboundSequence: number;
  readonly messageId: string;
  readonly messageType: 'DISPATCH';
  readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  readonly outboxState: 'PREPARED';
  readonly brokerEvidenceId: string;
  readonly brokerEvidenceHash: string;
  readonly assignmentEvidenceId: string;
  readonly assignmentEvidenceHash: string;
  readonly dispatchEnvelopeHash: string;
  readonly policyHash: string;
  readonly capabilityPolicyHash: string;
  readonly capabilityDigest: string;
  readonly payloadDigest: string;
  readonly unsignedEnvelopeDigest: string;
  readonly signedEnvelopeDigest: string;
  readonly authenticationTagDigest: string;
  readonly outboxIdempotencyKey: string;
  readonly outboxIssuedAt: string | Date;
  readonly outboxExpiresAt: string | Date;
  readonly outboxPreparedAt: string | Date;
  readonly claimedAt: string | Date;
  readonly expiresAt: string | Date;
}

type ValidatedBridgeEgressHandoffClaim = Omit<
  BridgeEgressHandoffClaim,
  'outboxIssuedAt' | 'outboxExpiresAt' | 'outboxPreparedAt' | 'claimedAt' | 'expiresAt'
> & {
  readonly outboxIssuedAt: string;
  readonly outboxExpiresAt: string;
  readonly outboxPreparedAt: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
};

export interface BridgeEgressTransportRequest {
  readonly schemaVersion: 1;
  readonly attemptId: string;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly messageId: string;
  readonly sequence: number;
  /** One owned canonical JSONL frame. The transport must copy all bytes or reject. */
  readonly line: Uint8Array;
  /** A transport must honor cancellation before reporting successful completion. */
  readonly signal: AbortSignal;
}

export interface BridgeEgressTransport {
  /**
   * Completes only after accepting the entire line into its bounded local
   * transport boundary. Completion is not delivery, acknowledgement, runtime
   * acceptance, or durable status evidence.
   */
  write(request: Readonly<BridgeEgressTransportRequest>): Promise<void>;
}

export class DenyBridgeEgressTransport implements BridgeEgressTransport {
  async write(_request: Readonly<BridgeEgressTransportRequest>): Promise<never> {
    throw new BridgeEgressControllerError('TRANSPORT_DENIED');
  }
}

export interface BridgeEgressWriteResult {
  readonly schemaVersion: 1;
  readonly attemptId: string;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly messageId: string;
  readonly sequence: number;
  readonly acceptedBytes: number;
  readonly completedAt: string;
}

export interface BridgeEgressControllerOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  errorCode: 'INVALID_CLAIM' | 'INVALID_FRAME' = 'INVALID_CLAIM',
): Record<string, unknown> {
  if (!plainRecord(value)) throw new BridgeEgressControllerError(errorCode);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new BridgeEgressControllerError(errorCode);
  }
  return value;
}

function reference(value: unknown, ownerSafe = false): string {
  const pattern = ownerSafe ? SAFE_OWNER_REFERENCE : SAFE_REFERENCE;
  if (typeof value !== 'string' || !pattern.test(value) || SENSITIVE.test(value)) {
    throw new BridgeEgressControllerError('INVALID_CLAIM');
  }
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new BridgeEgressControllerError('INVALID_CLAIM');
  }
  return value;
}

function timestamp(value: unknown): string {
  if (!(typeof value === 'string' || value instanceof Date)) {
    throw new BridgeEgressControllerError('INVALID_CLAIM');
  }
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    (typeof value === 'string' && parsed.toISOString() !== value)
  ) {
    throw new BridgeEgressControllerError('INVALID_CLAIM');
  }
  return parsed.toISOString();
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameDigest(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function validateClaim(value: unknown): Readonly<ValidatedBridgeEgressHandoffClaim> {
  const claim = exactRecord(value, CLAIM_KEYS);
  for (const key of [
    'workspaceId',
    'outboxId',
    'claimIdempotencyKey',
    'outboxIdempotencyKey',
    'runtimeId',
    'connectionId',
    'sessionId',
    'dispatchId',
    'taskId',
    'runId',
    'agentId',
    'messageId',
    'brokerEvidenceId',
    'assignmentEvidenceId',
  ] as const) {
    reference(claim[key]);
  }
  reference(claim.id, true);
  reference(claim.ownerReference, true);
  for (const key of [
    'brokerEvidenceHash',
    'assignmentEvidenceHash',
    'dispatchEnvelopeHash',
    'policyHash',
    'capabilityPolicyHash',
    'capabilityDigest',
    'payloadDigest',
    'unsignedEnvelopeDigest',
    'signedEnvelopeDigest',
    'authenticationTagDigest',
  ] as const) {
    digest(claim[key]);
  }
  const outboxIssuedAt = timestamp(claim.outboxIssuedAt);
  const outboxExpiresAt = timestamp(claim.outboxExpiresAt);
  const outboxPreparedAt = timestamp(claim.outboxPreparedAt);
  const claimedAt = timestamp(claim.claimedAt);
  const expiresAt = timestamp(claim.expiresAt);
  if (
    !['HUMAN', 'AGENT', 'SYSTEM'].includes(String(claim.ownerActorKind)) ||
    !Number.isSafeInteger(claim.generation) ||
    (claim.generation as number) < 1 ||
    !Number.isSafeInteger(claim.authorityLevel) ||
    (claim.authorityLevel as number) < 0 ||
    (claim.authorityLevel as number) > 3 ||
    !Number.isSafeInteger(claim.outboundSequence) ||
    (claim.outboundSequence as number) < 1 ||
    claim.messageType !== 'DISPATCH' ||
    claim.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
    claim.outboxState !== 'PREPARED'
  ) {
    throw new BridgeEgressControllerError('INVALID_CLAIM');
  }
  const issuedAt = Date.parse(outboxIssuedAt);
  const outboxExpiry = Date.parse(outboxExpiresAt);
  const preparedAt = Date.parse(outboxPreparedAt);
  const claimTime = Date.parse(claimedAt);
  const claimExpiry = Date.parse(expiresAt);
  if (
    preparedAt !== issuedAt ||
    claimTime < issuedAt ||
    claimExpiry <= claimTime ||
    claimExpiry - claimTime > 15_000 ||
    claimExpiry > outboxExpiry
  ) {
    throw new BridgeEgressControllerError('INVALID_CLAIM');
  }
  return Object.freeze({
    ...(claim as unknown as BridgeEgressHandoffClaim),
    outboxIssuedAt,
    outboxExpiresAt,
    outboxPreparedAt,
    claimedAt,
    expiresAt,
  });
}

function validateBinding(
  claim: Readonly<ValidatedBridgeEgressHandoffClaim>,
  frame: BridgeEnvelope,
): void {
  const payload = exactRecord(frame.payload, PAYLOAD_KEYS, 'INVALID_FRAME');
  if (
    payload.schemaVersion !== 1 ||
    frame.protocolVersion !== claim.protocolVersion ||
    frame.workspaceId !== claim.workspaceId ||
    frame.runtimeId !== claim.runtimeId ||
    frame.connectionId !== claim.connectionId ||
    frame.sessionId !== claim.sessionId ||
    frame.sequence !== claim.outboundSequence ||
    frame.messageId !== claim.messageId ||
    frame.type !== claim.messageType ||
    frame.issuedAt !== claim.outboxIssuedAt ||
    frame.expiresAt !== claim.outboxExpiresAt ||
    payload.dispatchId !== claim.dispatchId ||
    payload.taskId !== claim.taskId ||
    payload.runId !== claim.runId ||
    payload.agentId !== claim.agentId ||
    payload.authorityLevel !== claim.authorityLevel ||
    payload.brokerEvidenceId !== claim.brokerEvidenceId ||
    payload.brokerEvidenceHash !== claim.brokerEvidenceHash ||
    payload.assignmentEvidenceId !== claim.assignmentEvidenceId ||
    payload.assignmentEvidenceHash !== claim.assignmentEvidenceHash ||
    payload.dispatchEnvelopeHash !== claim.dispatchEnvelopeHash ||
    payload.policyHash !== claim.policyHash ||
    payload.capabilityPolicyHash !== claim.capabilityPolicyHash ||
    payload.capabilityDigest !== claim.capabilityDigest
  ) {
    throw new BridgeEgressControllerError('INVALID_FRAME');
  }
  const { mac: _mac, ...unsigned } = frame;
  if (
    !sameDigest(frame.payloadDigest, claim.payloadDigest) ||
    !sameDigest(hash(unsigned), claim.unsignedEnvelopeDigest) ||
    !sameDigest(hash(frame), claim.signedEnvelopeDigest) ||
    !sameDigest(hashText(frame.mac), claim.authenticationTagDigest)
  ) {
    throw new BridgeEgressControllerError('INVALID_FRAME');
  }
}

/**
 * Performs one bounded local write through an injected transport port. This
 * controller creates no socket or process, owns no queue, stores no state, and
 * grants no delivery, acknowledgement, runtime, or status authority.
 */
export class BoundedBridgeEgressController {
  readonly #activeAttempts = new Set<string>();

  constructor(
    private readonly transport: BridgeEgressTransport,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async handoff(
    claimInput: unknown,
    frameInput: unknown,
    options: Readonly<BridgeEgressControllerOptions> = {},
  ): Promise<Readonly<BridgeEgressWriteResult>> {
    const claim = validateClaim(claimInput);
    let frame: BridgeEnvelope;
    let encoded: Uint8Array | undefined;
    try {
      encoded = encodeBridgeLine(frameInput as BridgeEnvelope);
      frame = frameInput as BridgeEnvelope;
      validateBinding(claim, frame);
    } catch (error) {
      encoded?.fill(0);
      if (error instanceof BridgeEgressControllerError) throw error;
      if (error instanceof BridgeProtocolError)
        throw new BridgeEgressControllerError('INVALID_FRAME');
      throw new BridgeEgressControllerError('INVALID_FRAME');
    }
    const observedAt = this.clock();
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
      encoded.fill(0);
      throw new BridgeEgressControllerError('INVALID_CLAIM');
    }
    const remainingMs = Date.parse(claim.expiresAt) - observedAt.getTime();
    if (remainingMs <= 0) {
      encoded.fill(0);
      throw new BridgeEgressControllerError('AUTHORITY_EXPIRED');
    }
    const timeoutMs =
      options.timeoutMs ?? Math.min(MAX_BRIDGE_EGRESS_WRITE_TIMEOUT_MS, remainingMs);
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_BRIDGE_EGRESS_WRITE_TIMEOUT_MS ||
      timeoutMs > remainingMs
    ) {
      encoded.fill(0);
      throw new BridgeEgressControllerError('INVALID_TIMEOUT');
    }
    if (options.signal?.aborted) {
      encoded.fill(0);
      throw new BridgeEgressControllerError('CANCELLED');
    }
    if (this.#activeAttempts.has(claim.id)) {
      encoded.fill(0);
      throw new BridgeEgressControllerError('CONCURRENT_HANDOFF');
    }

    this.#activeAttempts.add(claim.id);
    const controller = new AbortController();
    const line = Uint8Array.from(encoded);
    const expectedLine = Uint8Array.from(line);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeExternalAbort = () => {};
    try {
      const interruption = new Promise<never>((_resolve, reject) => {
        const fail = (code: 'CANCELLED' | 'WRITE_TIMEOUT') => {
          controller.abort();
          reject(new BridgeEgressControllerError(code));
        };
        timeout = setTimeout(() => fail('WRITE_TIMEOUT'), timeoutMs);
        if (options.signal) {
          const onAbort = () => fail('CANCELLED');
          options.signal.addEventListener('abort', onAbort, { once: true });
          removeExternalAbort = () => options.signal?.removeEventListener('abort', onAbort);
        }
      });
      const request = Object.freeze({
        schemaVersion: 1 as const,
        attemptId: claim.id,
        workspaceId: claim.workspaceId,
        runtimeId: claim.runtimeId,
        connectionId: claim.connectionId,
        sessionId: claim.sessionId,
        dispatchId: claim.dispatchId,
        messageId: claim.messageId,
        sequence: claim.outboundSequence,
        line,
        signal: controller.signal,
      });
      try {
        await Promise.race([this.transport.write(request), interruption]);
      } catch (error) {
        if (error instanceof BridgeEgressControllerError) throw error;
        throw new BridgeEgressControllerError('TRANSPORT_DENIED');
      }
      if (!timingSafeEqual(Buffer.from(line), Buffer.from(expectedLine))) {
        throw new BridgeEgressControllerError('TRANSPORT_MUTATED_FRAME');
      }
      const completedAt = this.clock();
      if (
        !(completedAt instanceof Date) ||
        !Number.isFinite(completedAt.getTime()) ||
        completedAt.getTime() >= Date.parse(claim.expiresAt)
      ) {
        throw new BridgeEgressControllerError('AUTHORITY_EXPIRED');
      }
      return Object.freeze({
        schemaVersion: 1,
        attemptId: claim.id,
        workspaceId: claim.workspaceId,
        runtimeId: claim.runtimeId,
        connectionId: claim.connectionId,
        sessionId: claim.sessionId,
        dispatchId: claim.dispatchId,
        messageId: claim.messageId,
        sequence: claim.outboundSequence,
        acceptedBytes: line.byteLength,
        completedAt: completedAt.toISOString(),
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      removeExternalAbort();
      controller.abort();
      encoded.fill(0);
      line.fill(0);
      expectedLine.fill(0);
      this.#activeAttempts.delete(claim.id);
    }
  }
}
