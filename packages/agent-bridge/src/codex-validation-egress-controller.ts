import { createHash, timingSafeEqual } from 'node:crypto';

import { BridgeProtocolError, canonicalJson, encodeBridgeLine } from './codec';
import { CODEX_VALIDATION_CHALLENGE } from './codex-validation-dispatch';
import {
  DenyBridgeEgressTransport,
  type BridgeEgressTransport,
  type BridgeEgressWriteResult,
} from './egress-controller';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope } from './protocol';

const SHA256 = /^[a-f0-9]{64}$/u;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$/u;
const SENSITIVE =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|transcript|prompt|secret|token|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+|\b(?:sk|gh[opusr]|github_pat|npm|glpat|xox[baprs]|hf)[_-][A-Za-z0-9_-]{12,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b|^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$)/iu;
const MAX_CLAIM_MS = 15_000;
const MAX_WRITE_MS = 5_000;

export interface CodexValidationEgressHandoffClaim {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workspaceId: string;
  readonly validationDispatchCandidateHash: string;
  readonly heartbeatCandidateHash: string;
  readonly ownerReference: string;
  readonly ownerActorKind: 'HUMAN' | 'AGENT' | 'SYSTEM';
  readonly claimIdempotencyKey: string;
  readonly generation: 1;
  readonly state: 'CLAIMED';
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly authorityLevel: 0 | 1 | 2 | 3;
  readonly taskPolicyHash: string;
  readonly maximumCostMinorUnits: 0;
  readonly maximumComputeUnits: number;
  readonly maximumDurationMs: number;
  readonly outboundSequence: 1;
  readonly messageId: string;
  readonly challengeCode: typeof CODEX_VALIDATION_CHALLENGE;
  readonly payloadDigest: string;
  readonly unsignedEnvelopeDigest: string;
  readonly signedEnvelopeDigest: string;
  readonly authenticationTagDigest: string;
  readonly validationIssuedAt: string | Date;
  readonly validationExpiresAt: string | Date;
  readonly claimedAt: string | Date;
  readonly expiresAt: string | Date;
}

export interface CodexValidationEgressControllerOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

type ValidatedCodexValidationEgressHandoffClaim = Readonly<
  Omit<
    CodexValidationEgressHandoffClaim,
    'validationIssuedAt' | 'validationExpiresAt' | 'claimedAt' | 'expiresAt'
  > & {
    readonly validationIssuedAt: string;
    readonly validationExpiresAt: string;
    readonly claimedAt: string;
    readonly expiresAt: string;
  }
>;

export type CodexValidationEgressControllerErrorCode =
  | 'INVALID_CLAIM'
  | 'INVALID_FRAME'
  | 'AUTHORITY_EXPIRED'
  | 'INVALID_TIMEOUT'
  | 'CONCURRENT_HANDOFF'
  | 'USED_HANDOFF'
  | 'CANCELLED'
  | 'WRITE_TIMEOUT'
  | 'TRANSPORT_DENIED'
  | 'TRANSPORT_MUTATED_FRAME';

export class CodexValidationEgressControllerError extends Error {
  constructor(readonly code: CodexValidationEgressControllerErrorCode) {
    super(`Codex validation egress denied: ${code}`);
  }
}

const CLAIM_KEYS = [
  'agentId',
  'authenticationTagDigest',
  'authorityLevel',
  'challengeCode',
  'claimIdempotencyKey',
  'claimedAt',
  'connectionId',
  'dispatchId',
  'expiresAt',
  'generation',
  'heartbeatCandidateHash',
  'id',
  'maximumComputeUnits',
  'maximumCostMinorUnits',
  'maximumDurationMs',
  'messageId',
  'outboundSequence',
  'ownerActorKind',
  'ownerReference',
  'payloadDigest',
  'runId',
  'runtimeId',
  'schemaVersion',
  'sessionId',
  'signedEnvelopeDigest',
  'state',
  'taskId',
  'taskPolicyHash',
  'unsignedEnvelopeDigest',
  'validationDispatchCandidateHash',
  'validationExpiresAt',
  'validationIssuedAt',
  'workspaceId',
] as const;

const PAYLOAD_KEYS = [
  'agentId',
  'authorityLevel',
  'capabilityCandidateHash',
  'challengeCode',
  'dispatchId',
  'heartbeatCandidateHash',
  'registrationCandidateHash',
  'runId',
  'schemaVersion',
  'taskId',
  'taskPolicyHash',
] as const;

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: unknown, keys: readonly string[], code: 'INVALID_CLAIM' | 'INVALID_FRAME') {
  if (!plain(value)) throw new CodexValidationEgressControllerError(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new CodexValidationEgressControllerError(code);
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value) || SENSITIVE.test(value))
    throw new CodexValidationEgressControllerError('INVALID_CLAIM');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CodexValidationEgressControllerError('INVALID_CLAIM');
  return value;
}

function timestamp(value: unknown): string {
  if (!(typeof value === 'string' || value instanceof Date))
    throw new CodexValidationEgressControllerError('INVALID_CLAIM');
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    (typeof value === 'string' && parsed.toISOString() !== value)
  )
    throw new CodexValidationEgressControllerError('INVALID_CLAIM');
  return parsed.toISOString();
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function same(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function validateClaim(input: unknown) {
  const claim = exact(input, CLAIM_KEYS, 'INVALID_CLAIM');
  for (const key of [
    'id',
    'workspaceId',
    'ownerReference',
    'claimIdempotencyKey',
    'runtimeId',
    'connectionId',
    'sessionId',
    'dispatchId',
    'taskId',
    'runId',
    'agentId',
    'messageId',
  ] as const)
    reference(claim[key]);
  for (const key of [
    'validationDispatchCandidateHash',
    'heartbeatCandidateHash',
    'taskPolicyHash',
    'payloadDigest',
    'unsignedEnvelopeDigest',
    'signedEnvelopeDigest',
    'authenticationTagDigest',
  ] as const)
    digest(claim[key]);
  const validationIssuedAt = timestamp(claim.validationIssuedAt);
  const validationExpiresAt = timestamp(claim.validationExpiresAt);
  const claimedAt = timestamp(claim.claimedAt);
  const expiresAt = timestamp(claim.expiresAt);
  if (
    claim.schemaVersion !== 1 ||
    claim.generation !== 1 ||
    claim.state !== 'CLAIMED' ||
    !['HUMAN', 'AGENT', 'SYSTEM'].includes(String(claim.ownerActorKind)) ||
    !Number.isSafeInteger(claim.authorityLevel) ||
    (claim.authorityLevel as number) < 0 ||
    (claim.authorityLevel as number) > 3 ||
    claim.maximumCostMinorUnits !== 0 ||
    !Number.isSafeInteger(claim.maximumComputeUnits) ||
    (claim.maximumComputeUnits as number) < 1 ||
    (claim.maximumComputeUnits as number) > 100 ||
    !Number.isSafeInteger(claim.maximumDurationMs) ||
    (claim.maximumDurationMs as number) < 1 ||
    (claim.maximumDurationMs as number) > 60_000 ||
    claim.outboundSequence !== 1 ||
    claim.messageId !== claim.dispatchId ||
    claim.challengeCode !== CODEX_VALIDATION_CHALLENGE ||
    Date.parse(validationExpiresAt) <= Date.parse(validationIssuedAt) ||
    Date.parse(claimedAt) < Date.parse(validationIssuedAt) ||
    Date.parse(expiresAt) <= Date.parse(claimedAt) ||
    Date.parse(expiresAt) - Date.parse(claimedAt) > MAX_CLAIM_MS ||
    Date.parse(expiresAt) > Date.parse(validationExpiresAt)
  )
    throw new CodexValidationEgressControllerError('INVALID_CLAIM');
  return Object.freeze({
    ...claim,
    validationIssuedAt,
    validationExpiresAt,
    claimedAt,
    expiresAt,
  }) as ValidatedCodexValidationEgressHandoffClaim;
}

function validateFrame(claim: ReturnType<typeof validateClaim>, frame: BridgeEnvelope): void {
  const payload = exact(frame.payload, PAYLOAD_KEYS, 'INVALID_FRAME');
  if (
    frame.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
    frame.workspaceId !== claim.workspaceId ||
    frame.runtimeId !== claim.runtimeId ||
    frame.connectionId !== claim.connectionId ||
    frame.sessionId !== claim.sessionId ||
    frame.sequence !== claim.outboundSequence ||
    frame.messageId !== claim.messageId ||
    frame.type !== 'DISPATCH' ||
    frame.issuedAt !== claim.validationIssuedAt ||
    frame.expiresAt !== claim.validationExpiresAt ||
    payload.schemaVersion !== 1 ||
    payload.challengeCode !== claim.challengeCode ||
    payload.dispatchId !== claim.dispatchId ||
    payload.taskId !== claim.taskId ||
    payload.runId !== claim.runId ||
    payload.agentId !== claim.agentId ||
    payload.authorityLevel !== claim.authorityLevel ||
    payload.taskPolicyHash !== claim.taskPolicyHash ||
    payload.heartbeatCandidateHash !== claim.heartbeatCandidateHash
  )
    throw new CodexValidationEgressControllerError('INVALID_FRAME');
  const { mac: _mac, ...unsigned } = frame;
  if (
    !same(frame.payloadDigest, claim.payloadDigest as string) ||
    !same(hash(unsigned), claim.unsignedEnvelopeDigest as string) ||
    !same(hash(frame), claim.signedEnvelopeDigest as string) ||
    !same(hashText(frame.mac), claim.authenticationTagDigest as string)
  )
    throw new CodexValidationEgressControllerError('INVALID_FRAME');
}

/**
 * Performs one bounded local write for one exclusively claimed validation frame.
 * Completion proves only local byte acceptance, never delivery, acknowledgement,
 * task execution, provider access, or runtime connectivity.
 */
export class BoundedCodexValidationEgressController {
  readonly #active = new Set<string>();
  readonly #used = new Map<string, number>();

  constructor(
    private readonly transport: BridgeEgressTransport = new DenyBridgeEgressTransport(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async handoff(
    claimInput: unknown,
    frameInput: unknown,
    options: Readonly<CodexValidationEgressControllerOptions> = {},
  ): Promise<Readonly<BridgeEgressWriteResult>> {
    const claim = validateClaim(claimInput);
    let encoded: Uint8Array | undefined;
    try {
      encoded = encodeBridgeLine(frameInput as BridgeEnvelope);
      validateFrame(claim, frameInput as BridgeEnvelope);
    } catch (error) {
      encoded?.fill(0);
      if (error instanceof CodexValidationEgressControllerError) throw error;
      if (error instanceof BridgeProtocolError)
        throw new CodexValidationEgressControllerError('INVALID_FRAME');
      throw new CodexValidationEgressControllerError('INVALID_FRAME');
    }
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      encoded.fill(0);
      throw new CodexValidationEgressControllerError('INVALID_CLAIM');
    }
    const remaining = Date.parse(claim.expiresAt) - now.getTime();
    if (remaining <= 0) {
      encoded.fill(0);
      throw new CodexValidationEgressControllerError('AUTHORITY_EXPIRED');
    }
    for (const [attemptId, expiresAt] of this.#used) {
      if (expiresAt <= now.getTime()) this.#used.delete(attemptId);
    }
    const timeoutMs = options.timeoutMs ?? Math.min(MAX_WRITE_MS, remaining);
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_WRITE_MS ||
      timeoutMs > remaining
    ) {
      encoded.fill(0);
      throw new CodexValidationEgressControllerError('INVALID_TIMEOUT');
    }
    if (options.signal?.aborted) {
      encoded.fill(0);
      throw new CodexValidationEgressControllerError('CANCELLED');
    }
    if (this.#used.has(claim.id as string)) {
      encoded.fill(0);
      throw new CodexValidationEgressControllerError('USED_HANDOFF');
    }
    if (this.#active.has(claim.id as string)) {
      encoded.fill(0);
      throw new CodexValidationEgressControllerError('CONCURRENT_HANDOFF');
    }
    this.#active.add(claim.id as string);
    this.#used.set(claim.id as string, Date.parse(claim.expiresAt));
    const controller = new AbortController();
    const line = Uint8Array.from(encoded);
    const expected = Uint8Array.from(line);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbort = () => {};
    try {
      const interruption = new Promise<never>((_resolve, reject) => {
        const fail = (code: 'CANCELLED' | 'WRITE_TIMEOUT') => {
          controller.abort();
          reject(new CodexValidationEgressControllerError(code));
        };
        timer = setTimeout(() => fail('WRITE_TIMEOUT'), timeoutMs);
        if (options.signal) {
          const abort = () => fail('CANCELLED');
          options.signal.addEventListener('abort', abort, { once: true });
          removeAbort = () => options.signal?.removeEventListener('abort', abort);
        }
      });
      try {
        await Promise.race([
          this.transport.write(
            Object.freeze({
              schemaVersion: 1 as const,
              attemptId: claim.id as string,
              workspaceId: claim.workspaceId as string,
              runtimeId: claim.runtimeId as string,
              connectionId: claim.connectionId as string,
              sessionId: claim.sessionId as string,
              dispatchId: claim.dispatchId as string,
              messageId: claim.messageId as string,
              sequence: claim.outboundSequence as number,
              line,
              signal: controller.signal,
            }),
          ),
          interruption,
        ]);
      } catch (error) {
        if (error instanceof CodexValidationEgressControllerError) throw error;
        throw new CodexValidationEgressControllerError('TRANSPORT_DENIED');
      }
      if (!timingSafeEqual(Buffer.from(line), Buffer.from(expected)))
        throw new CodexValidationEgressControllerError('TRANSPORT_MUTATED_FRAME');
      const completedAt = this.clock();
      if (
        !(completedAt instanceof Date) ||
        !Number.isFinite(completedAt.getTime()) ||
        completedAt.getTime() >= Date.parse(claim.expiresAt)
      )
        throw new CodexValidationEgressControllerError('AUTHORITY_EXPIRED');
      return Object.freeze({
        schemaVersion: 1,
        attemptId: claim.id as string,
        workspaceId: claim.workspaceId as string,
        runtimeId: claim.runtimeId as string,
        connectionId: claim.connectionId as string,
        sessionId: claim.sessionId as string,
        dispatchId: claim.dispatchId as string,
        messageId: claim.messageId as string,
        sequence: claim.outboundSequence as number,
        acceptedBytes: line.byteLength,
        completedAt: completedAt.toISOString(),
      });
    } finally {
      if (timer) clearTimeout(timer);
      removeAbort();
      controller.abort();
      encoded.fill(0);
      line.fill(0);
      expected.fill(0);
      this.#active.delete(claim.id as string);
    }
  }
}
