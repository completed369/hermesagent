import { createHash, randomUUID } from 'node:crypto';

import type { AuthorityLevel, EntityId, WorkspaceContext } from './contracts';

export type VoicePermission = 'NOT_REQUESTED' | 'PROMPTING' | 'GRANTED' | 'DENIED' | 'UNAVAILABLE';
export type VoiceSessionState =
  | 'IDLE'
  | 'REQUESTING_PERMISSION'
  | 'READY'
  | 'RECORDING'
  | 'TRANSCRIBING'
  | 'ROUTING'
  | 'RESPONDING'
  | 'STOPPED'
  | 'FAILED';
export type VoiceAdapterKind = 'STT' | 'TTS' | 'REALTIME';
export type VoiceAdapterStatus =
  'NOT_CONFIGURED' | 'BROWSER_LOCAL_AVAILABLE' | 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
export type VoiceAvailability = 'LOCAL_BROWSER' | 'SELF_HOSTED' | 'EXTERNAL_PROVIDER';
export type VoiceNetworkMode = 'OFFLINE' | 'LOOPBACK' | 'EGRESS';
export type VoiceCredentialMode = 'NONE' | 'SECRET_REFERENCE' | 'SESSION';

export interface VoiceProviderMetadata {
  adapterId: EntityId;
  kind: VoiceAdapterKind;
  provider: string;
  model?: string;
  status: VoiceAdapterStatus;
  availability: VoiceAvailability;
  networkMode: VoiceNetworkMode;
  credentialMode: VoiceCredentialMode;
  isFallback: boolean;
  availabilityEvidenceId: EntityId;
  availabilityVerifiedAt: string;
  maximumInputBytes: number;
  maximumTextBytes: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  qualityScoreBps?: number;
  costMinorUnitsPerMillionInputUnits?: number;
  currency?: string;
  dataPolicy: 'LOCAL_ONLY' | 'NO_TRAINING' | 'PROVIDER_POLICY_REVIEW_REQUIRED';
}

/** Provider ports are contracts only. This foundation never invokes them. */
export interface SpeechToTextAdapter {
  readonly metadata: VoiceProviderMetadata & { kind: 'STT' };
  transcribe(request: Readonly<{ sessionId: EntityId; audioReference: string }>): Promise<unknown>;
}

export interface TextToSpeechAdapter {
  readonly metadata: VoiceProviderMetadata & { kind: 'TTS' };
  synthesize(request: Readonly<{ responseId: EntityId; text: string }>): Promise<unknown>;
}

export interface RealtimeSpeechAdapter {
  readonly metadata: VoiceProviderMetadata & { kind: 'REALTIME' };
  open(request: Readonly<{ sessionId: EntityId }>): Promise<unknown>;
}

export interface BrowserVoiceCapabilities {
  microphonePermissionApi: boolean;
  localSpeechToText: boolean;
  localTextToSpeech: boolean;
  realtimeSpeech: boolean;
}

export interface VoiceSession {
  id: EntityId;
  workspaceId: EntityId;
  principalId: EntityId;
  state: VoiceSessionState;
  permission: VoicePermission;
  sttAdapterId: EntityId;
  ttsAdapterId?: EntityId;
  createdAt: string;
  updatedAt: string;
  stoppedReason?: string;
}

export interface FinalTranscriptEnvelope {
  sessionId: EntityId;
  workspaceId: EntityId;
  principalId: EntityId;
  adapterId: EntityId;
  sequence: number;
  nonce: string;
  observedAt: string;
  final: boolean;
  transcript: string;
  audioBytes: number;
  proof: string;
  retention: 'NONE' | 'REDACTED_SESSION';
}

export interface TranscriptProofVerifier {
  verify(
    context: WorkspaceContext,
    envelope: Readonly<FinalTranscriptEnvelope>,
    adapter: Readonly<VoiceProviderMetadata>,
  ): boolean;
}

export interface VoiceAuthorityDecision {
  allowed: boolean;
  maximumAuthority: AuthorityLevel;
  reason: string;
}

export interface VoiceAuthorityEvaluator {
  evaluate(context: WorkspaceContext, action: 'voice.command.route'): VoiceAuthorityDecision;
}

export interface VoiceCommandRoutingRequest {
  id: EntityId;
  workspaceId: EntityId;
  principalId: EntityId;
  sessionId: EntityId;
  transcriptHash: string;
  redactedTranscript: string;
  source: 'VOICE';
  maximumExecutableAuthority: 3;
}

export interface VoiceCommandRoutingDecision {
  requestId: EntityId;
  workspaceId: EntityId;
  sessionId: EntityId;
  commandId: EntityId;
  outcome: 'ROUTINE' | 'LEVEL_4' | 'DENY';
  requiredAuthority: AuthorityLevel;
  exactTarget?: string;
  reason: string;
  responseText: string;
}

export interface VoiceCommandRouter {
  route(
    context: WorkspaceContext,
    request: Readonly<VoiceCommandRoutingRequest>,
  ): VoiceCommandRoutingDecision;
}

export interface SecureConfirmationRequirement {
  status: 'SECURE_CONFIRMATION_REQUIRED';
  commandId: EntityId;
  exactTarget: string;
  permittedChannels: readonly ['PROTECTED_UI', 'WEBAUTHN_OR_MFA'];
  voiceConfirmationAccepted: false;
  reason: string;
}

export interface VoiceHistoryEntry {
  id: EntityId;
  workspaceId: EntityId;
  principalId: EntityId;
  sessionId: EntityId;
  commandId: EntityId;
  transcriptHash: string;
  redactedTranscript?: string;
  redactedResponse: string;
  outcome: VoiceCommandRoutingDecision['outcome'];
  requiredAuthority: AuthorityLevel;
  createdAt: string;
}

export interface VoiceRoutingResult {
  commandId: EntityId;
  outcome: VoiceCommandRoutingDecision['outcome'];
  responseText: string;
  confirmation?: SecureConfirmationRequirement;
}

export interface ReplayPlan {
  responseId: EntityId;
  ttsAdapterId: EntityId;
  redactedText: string;
  providerInvocationRequired: true;
}

export interface VoiceGatewayOptions {
  authorizedPrincipals: readonly EntityId[];
  maximumAudioBytes: number;
  maximumTranscriptBytes: number;
  maximumResponseBytes: number;
  maximumHistoryEntriesPerPrincipal: number;
  transcriptFreshnessMs: number;
  clock?: () => number;
  idFactory?: () => string;
}

export class VoiceGatewayPolicyError extends Error {}

const key = (workspaceId: string, id: string): string => JSON.stringify([workspaceId, id]);

function boundedInteger(value: unknown, field: string, maximum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum)
    throw new VoiceGatewayPolicyError(`${field} is outside policy bounds`);
}

function boundedText(value: unknown, field: string, maximumBytes: number): asserts value is string {
  const hasForbiddenControl =
    typeof value === 'string' &&
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return (
        (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      );
    });
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    Buffer.byteLength(value, 'utf8') > maximumBytes ||
    hasForbiddenControl
  )
    throw new VoiceGatewayPolicyError(`${field} must be bounded printable text`);
}

function exactKeys(value: unknown, expected: readonly string[], field: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new VoiceGatewayPolicyError(`${field} must be an object`);
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((item, index) => item !== allowed[index]))
    throw new VoiceGatewayPolicyError(`${field} contains unsupported fields`);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new VoiceGatewayPolicyError(`${field} is unsupported`);
}

function booleanValue(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new VoiceGatewayPolicyError(`${field} must be boolean`);
}

function parsedTime(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new VoiceGatewayPolicyError(`${field} must be ISO-8601`);
  return parsed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const REDACTIONS: readonly RegExp[] = [
  /\bgh[op]_[A-Za-z0-9]{20,}\b/giu,
  /\bsk-[A-Za-z0-9_-]{20,}\b/giu,
  /-----BEGIN [^-]{0,40}PRIVATE KEY-----/giu,
  /\b(?:bearer|authorization)\s*[:=]?\s*[A-Za-z0-9._~+/-]{12,}/giu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
];

function redact(value: string): string {
  let result = value;
  for (const pattern of REDACTIONS) result = result.replace(pattern, '[REDACTED]');
  return result;
}

function validateMetadata(metadata: VoiceProviderMetadata): VoiceProviderMetadata {
  exactKeys(
    metadata,
    [
      'adapterId',
      'availability',
      'availabilityEvidenceId',
      'availabilityVerifiedAt',
      'costMinorUnitsPerMillionInputUnits',
      'credentialMode',
      'currency',
      'dataPolicy',
      'isFallback',
      'kind',
      'latencyP50Ms',
      'latencyP95Ms',
      'maximumInputBytes',
      'maximumTextBytes',
      'model',
      'networkMode',
      'provider',
      'qualityScoreBps',
      'status',
    ].filter((field) => Object.hasOwn(metadata, field)),
    'adapterMetadata',
  );
  boundedText(metadata.adapterId, 'adapterId', 256);
  boundedText(metadata.provider, 'provider', 256);
  boundedText(metadata.availabilityEvidenceId, 'availabilityEvidenceId', 256);
  parsedTime(metadata.availabilityVerifiedAt, 'availabilityVerifiedAt');
  oneOf(metadata.kind, ['STT', 'TTS', 'REALTIME'], 'kind');
  oneOf(
    metadata.status,
    ['NOT_CONFIGURED', 'BROWSER_LOCAL_AVAILABLE', 'AVAILABLE', 'DEGRADED', 'UNAVAILABLE'],
    'status',
  );
  oneOf(
    metadata.availability,
    ['LOCAL_BROWSER', 'SELF_HOSTED', 'EXTERNAL_PROVIDER'],
    'availability',
  );
  oneOf(metadata.networkMode, ['OFFLINE', 'LOOPBACK', 'EGRESS'], 'networkMode');
  oneOf(metadata.credentialMode, ['NONE', 'SECRET_REFERENCE', 'SESSION'], 'credentialMode');
  oneOf(
    metadata.dataPolicy,
    ['LOCAL_ONLY', 'NO_TRAINING', 'PROVIDER_POLICY_REVIEW_REQUIRED'],
    'dataPolicy',
  );
  booleanValue(metadata.isFallback, 'isFallback');
  if (metadata.model !== undefined) boundedText(metadata.model, 'model', 256);
  boundedInteger(metadata.maximumInputBytes, 'maximumInputBytes', 100 * 1024 * 1024);
  boundedInteger(metadata.maximumTextBytes, 'maximumTextBytes', 1024 * 1024);
  for (const [field, value] of [
    ['latencyP50Ms', metadata.latencyP50Ms],
    ['latencyP95Ms', metadata.latencyP95Ms],
    ['qualityScoreBps', metadata.qualityScoreBps],
    ['costMinorUnitsPerMillionInputUnits', metadata.costMinorUnitsPerMillionInputUnits],
  ] as const)
    if (value !== undefined) boundedInteger(value, field, Number.MAX_SAFE_INTEGER);
  if (
    (metadata.costMinorUnitsPerMillionInputUnits === undefined) !==
    (metadata.currency === undefined)
  )
    throw new VoiceGatewayPolicyError('Cost metadata requires both amount and currency');
  if (metadata.currency !== undefined) boundedText(metadata.currency, 'currency', 16);
  if (metadata.qualityScoreBps !== undefined && metadata.qualityScoreBps > 10_000)
    throw new VoiceGatewayPolicyError('qualityScoreBps exceeds 10000');
  if (
    (metadata.availability === 'EXTERNAL_PROVIDER' || metadata.availability === 'SELF_HOSTED') &&
    metadata.status === 'BROWSER_LOCAL_AVAILABLE'
  )
    throw new VoiceGatewayPolicyError('Non-browser adapters cannot claim browser-local status');
  if (metadata.availability === 'LOCAL_BROWSER' && metadata.status !== 'BROWSER_LOCAL_AVAILABLE')
    throw new VoiceGatewayPolicyError('Browser-local adapters require browser-local status');
  if (
    metadata.availability === 'LOCAL_BROWSER' &&
    (metadata.networkMode !== 'OFFLINE' || metadata.credentialMode !== 'NONE')
  )
    throw new VoiceGatewayPolicyError('Browser-local adapters must be offline and credential-free');
  if (
    metadata.availability === 'EXTERNAL_PROVIDER' &&
    (metadata.networkMode !== 'EGRESS' || metadata.credentialMode === 'NONE')
  )
    throw new VoiceGatewayPolicyError('External providers require egress and scoped credentials');
  return structuredClone(metadata);
}

export class GovernedVoiceGateway {
  readonly #options: Omit<VoiceGatewayOptions, 'authorizedPrincipals' | 'clock' | 'idFactory'>;
  readonly #authorizedPrincipals: ReadonlySet<EntityId>;
  readonly #clock: () => number;
  readonly #idFactory: () => string;
  readonly #proofVerifier: TranscriptProofVerifier;
  readonly #authority: VoiceAuthorityEvaluator;
  readonly #router: VoiceCommandRouter;
  readonly #adapters = new Map<string, VoiceProviderMetadata>();
  readonly #sessions = new Map<string, VoiceSession>();
  readonly #history = new Map<string, VoiceHistoryEntry[]>();
  readonly #usedTranscriptProofs = new Set<string>();
  readonly #usedSequences = new Set<string>();

  constructor(
    options: VoiceGatewayOptions,
    dependencies: {
      proofVerifier: TranscriptProofVerifier;
      authority: VoiceAuthorityEvaluator;
      router: VoiceCommandRouter;
    },
  ) {
    this.#authorizedPrincipals = new Set(options.authorizedPrincipals);
    this.#clock = options.clock ?? Date.now;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#proofVerifier = dependencies.proofVerifier;
    this.#authority = dependencies.authority;
    this.#router = dependencies.router;
    this.#options = {
      maximumAudioBytes: options.maximumAudioBytes,
      maximumTranscriptBytes: options.maximumTranscriptBytes,
      maximumResponseBytes: options.maximumResponseBytes,
      maximumHistoryEntriesPerPrincipal: options.maximumHistoryEntriesPerPrincipal,
      transcriptFreshnessMs: options.transcriptFreshnessMs,
    };
    boundedInteger(options.maximumAudioBytes, 'maximumAudioBytes', 100 * 1024 * 1024);
    boundedInteger(options.maximumTranscriptBytes, 'maximumTranscriptBytes', 1024 * 1024);
    boundedInteger(options.maximumResponseBytes, 'maximumResponseBytes', 1024 * 1024);
    boundedInteger(
      options.maximumHistoryEntriesPerPrincipal,
      'maximumHistoryEntriesPerPrincipal',
      10_000,
    );
    boundedInteger(options.transcriptFreshnessMs, 'transcriptFreshnessMs', 60 * 60 * 1_000);
    if (
      !options.maximumAudioBytes ||
      !options.maximumTranscriptBytes ||
      !options.maximumResponseBytes
    )
      throw new VoiceGatewayPolicyError('Voice payload limits must be positive');
  }

  registerAdapter(context: WorkspaceContext, untrusted: VoiceProviderMetadata): void {
    this.#assertAuthorized(context);
    const metadata = validateMetadata(untrusted);
    if (this.#adapters.has(key(context.workspaceId, metadata.adapterId)))
      throw new VoiceGatewayPolicyError('Adapter already registered');
    this.#adapters.set(key(context.workspaceId, metadata.adapterId), metadata);
  }

  listAdapters(context: WorkspaceContext): readonly VoiceProviderMetadata[] {
    this.#assertAuthorized(context);
    return [...this.#adapters.entries()]
      .filter(([entry]) => JSON.parse(entry)[0] === context.workspaceId)
      .map(([, metadata]) => structuredClone(metadata));
  }

  createSession(
    context: WorkspaceContext,
    request: Readonly<{
      id: EntityId;
      sttAdapterId: EntityId;
      ttsAdapterId?: EntityId;
      browser: BrowserVoiceCapabilities;
    }>,
  ): VoiceSession {
    this.#assertAuthorized(context);
    exactKeys(
      request,
      [
        'browser',
        'id',
        'sttAdapterId',
        ...(request.ttsAdapterId === undefined ? [] : ['ttsAdapterId']),
      ],
      'sessionRequest',
    );
    exactKeys(
      request.browser,
      ['localSpeechToText', 'localTextToSpeech', 'microphonePermissionApi', 'realtimeSpeech'],
      'browserCapabilities',
    );
    for (const [field, value] of Object.entries(request.browser)) booleanValue(value, field);
    boundedText(request.id, 'sessionId', 256);
    const sessionKey = key(context.workspaceId, request.id);
    if (this.#sessions.has(sessionKey)) throw new VoiceGatewayPolicyError('Session already exists');
    const stt = this.#requireAdapter(context, request.sttAdapterId, 'STT');
    this.#assertAdapterUsable(stt, request.browser);
    if (request.ttsAdapterId !== undefined) {
      const tts = this.#requireAdapter(context, request.ttsAdapterId, 'TTS');
      this.#assertAdapterUsable(tts, request.browser);
    }
    if (!request.browser.microphonePermissionApi)
      throw new VoiceGatewayPolicyError('Microphone permission API is unavailable');
    const now = new Date(this.#clock()).toISOString();
    const session: VoiceSession = {
      id: request.id,
      workspaceId: context.workspaceId,
      principalId: context.principalId,
      state: 'IDLE',
      permission: 'NOT_REQUESTED',
      sttAdapterId: request.sttAdapterId,
      ...(request.ttsAdapterId === undefined ? {} : { ttsAdapterId: request.ttsAdapterId }),
      createdAt: now,
      updatedAt: now,
    };
    this.#sessions.set(sessionKey, session);
    return structuredClone(session);
  }

  requestMicrophonePermission(context: WorkspaceContext, sessionId: EntityId): VoiceSession {
    const session = this.#requireSession(context, sessionId);
    if (session.state !== 'IDLE' || session.permission !== 'NOT_REQUESTED')
      throw new VoiceGatewayPolicyError('Microphone permission transition is invalid');
    session.state = 'REQUESTING_PERMISSION';
    session.permission = 'PROMPTING';
    return this.#touch(session);
  }

  recordMicrophonePermission(
    context: WorkspaceContext,
    sessionId: EntityId,
    result: 'GRANTED' | 'DENIED' | 'UNAVAILABLE',
  ): VoiceSession {
    oneOf(result, ['GRANTED', 'DENIED', 'UNAVAILABLE'], 'microphonePermissionResult');
    const session = this.#requireSession(context, sessionId);
    if (session.state !== 'REQUESTING_PERMISSION' || session.permission !== 'PROMPTING')
      throw new VoiceGatewayPolicyError('Microphone permission result is unsolicited');
    session.permission = result;
    session.state = result === 'GRANTED' ? 'READY' : 'FAILED';
    if (result !== 'GRANTED') session.stoppedReason = `MICROPHONE_${result}`;
    return this.#touch(session);
  }

  pressToTalk(context: WorkspaceContext, sessionId: EntityId): VoiceSession {
    const session = this.#requireSession(context, sessionId);
    if (session.permission !== 'GRANTED' || session.state !== 'READY')
      throw new VoiceGatewayPolicyError('Push-to-talk requires granted permission and READY state');
    session.state = 'RECORDING';
    return this.#touch(session);
  }

  releaseToTalk(context: WorkspaceContext, sessionId: EntityId): VoiceSession {
    const session = this.#requireSession(context, sessionId);
    if (session.state !== 'RECORDING')
      throw new VoiceGatewayPolicyError('Push-to-talk release requires RECORDING state');
    session.state = 'TRANSCRIBING';
    return this.#touch(session);
  }

  routeFinalTranscript(
    context: WorkspaceContext,
    untrusted: FinalTranscriptEnvelope,
  ): VoiceRoutingResult {
    this.#assertAuthorized(context);
    exactKeys(
      untrusted,
      [
        'adapterId',
        'audioBytes',
        'final',
        'nonce',
        'observedAt',
        'principalId',
        'proof',
        'retention',
        'sequence',
        'sessionId',
        'transcript',
        'workspaceId',
      ],
      'transcriptEnvelope',
    );
    const session = this.#requireSession(context, untrusted.sessionId);
    if (session.state !== 'TRANSCRIBING')
      throw new VoiceGatewayPolicyError('Session is not accepting a transcript');
    if (
      untrusted.workspaceId !== context.workspaceId ||
      untrusted.principalId !== context.principalId ||
      session.principalId !== context.principalId ||
      untrusted.adapterId !== session.sttAdapterId
    )
      throw new VoiceGatewayPolicyError('Transcript linkage is invalid');
    if (untrusted.final !== true)
      throw new VoiceGatewayPolicyError('Only final transcripts may route');
    if (!['NONE', 'REDACTED_SESSION'].includes(untrusted.retention))
      throw new VoiceGatewayPolicyError('Sensitive or raw transcript retention is forbidden');
    boundedInteger(untrusted.sequence, 'sequence', Number.MAX_SAFE_INTEGER);
    if (untrusted.sequence < 1) throw new VoiceGatewayPolicyError('sequence must be positive');
    boundedText(untrusted.nonce, 'nonce', 256);
    boundedText(untrusted.proof, 'proof', 4_096);
    boundedText(untrusted.transcript, 'transcript', this.#options.maximumTranscriptBytes);
    boundedInteger(untrusted.audioBytes, 'audioBytes', this.#options.maximumAudioBytes);
    const observedAt = parsedTime(untrusted.observedAt, 'observedAt');
    if (Math.abs(this.#clock() - observedAt) > this.#options.transcriptFreshnessMs)
      throw new VoiceGatewayPolicyError('Transcript is stale or from the future');
    const proofKey = key(context.workspaceId, untrusted.proof);
    const sequenceKey = key(context.workspaceId, `${untrusted.sessionId}:${untrusted.sequence}`);
    if (this.#usedTranscriptProofs.has(proofKey) || this.#usedSequences.has(sequenceKey))
      throw new VoiceGatewayPolicyError('Transcript replay rejected');
    const adapter = this.#requireAdapter(context, untrusted.adapterId, 'STT');
    if (!this.#proofVerifier.verify(context, structuredClone(untrusted), adapter))
      throw new VoiceGatewayPolicyError('Final transcript proof is invalid');

    const redactedTranscript = redact(untrusted.transcript.trim());
    boundedText(redactedTranscript, 'redactedTranscript', this.#options.maximumTranscriptBytes);
    this.#usedTranscriptProofs.add(proofKey);
    this.#usedSequences.add(sequenceKey);
    session.state = 'ROUTING';
    this.#touch(session);

    const authority = this.#authority.evaluate(context, 'voice.command.route');
    exactKeys(authority, ['allowed', 'maximumAuthority', 'reason'], 'authorityDecision');
    booleanValue(authority.allowed, 'authorityAllowed');
    boundedInteger(authority.maximumAuthority, 'maximumAuthority', 4);
    boundedText(authority.reason, 'authorityReason', 2_048);
    if (!authority.allowed)
      return this.#deny(session, untrusted, redactedTranscript, 'Voice authority denied');

    const request: VoiceCommandRoutingRequest = {
      id: this.#idFactory(),
      workspaceId: context.workspaceId,
      principalId: context.principalId,
      sessionId: session.id,
      transcriptHash: sha256(untrusted.transcript),
      redactedTranscript,
      source: 'VOICE',
      maximumExecutableAuthority: 3,
    };
    const decision = this.#router.route(context, Object.freeze(structuredClone(request)));
    this.#validateDecision(context, session, request, decision);
    if (decision.requiredAuthority > authority.maximumAuthority && decision.outcome !== 'LEVEL_4')
      throw new VoiceGatewayPolicyError('Routed command exceeds principal authority');
    if (decision.requiredAuthority === 4 && decision.outcome !== 'LEVEL_4')
      throw new VoiceGatewayPolicyError('Level-4 commands must require secure confirmation');
    if (decision.outcome === 'LEVEL_4' && decision.requiredAuthority !== 4)
      throw new VoiceGatewayPolicyError('Secure confirmation is reserved for Level-4 commands');

    const redactedResponse = redact(decision.responseText.trim());
    boundedText(redactedResponse, 'responseText', this.#options.maximumResponseBytes);
    session.state = 'RESPONDING';
    this.#touch(session);
    this.#storeHistory(context, session, untrusted, decision, redactedTranscript, redactedResponse);
    return {
      commandId: decision.commandId,
      outcome: decision.outcome,
      responseText: redactedResponse,
      ...(decision.outcome === 'LEVEL_4'
        ? {
            confirmation: {
              status: 'SECURE_CONFIRMATION_REQUIRED',
              commandId: decision.commandId,
              exactTarget: decision.exactTarget!,
              permittedChannels: ['PROTECTED_UI', 'WEBAUTHN_OR_MFA'],
              voiceConfirmationAccepted: false,
              reason: decision.reason,
            } satisfies SecureConfirmationRequirement,
          }
        : {}),
    };
  }

  stop(context: WorkspaceContext, sessionId: EntityId, reason: string): VoiceSession {
    boundedText(reason, 'stopReason', 2_048);
    const session = this.#requireSession(context, sessionId);
    if (session.state === 'STOPPED') return structuredClone(session);
    if (session.state === 'FAILED') throw new VoiceGatewayPolicyError('Failed session is terminal');
    session.state = 'STOPPED';
    session.stoppedReason = redact(reason);
    return this.#touch(session);
  }

  replay(context: WorkspaceContext, historyEntryId: EntityId): ReplayPlan {
    this.#assertAuthorized(context);
    const entry = this.listHistory(context).find(({ id }) => id === historyEntryId);
    if (!entry) throw new VoiceGatewayPolicyError('History entry not found');
    const session = this.#requireSession(context, entry.sessionId);
    if (!session.ttsAdapterId) throw new VoiceGatewayPolicyError('No TTS adapter selected');
    const adapter = this.#requireAdapter(context, session.ttsAdapterId, 'TTS');
    if (!['AVAILABLE', 'BROWSER_LOCAL_AVAILABLE'].includes(adapter.status))
      throw new VoiceGatewayPolicyError('TTS adapter is unavailable');
    return {
      responseId: entry.id,
      ttsAdapterId: adapter.adapterId,
      redactedText: entry.redactedResponse,
      providerInvocationRequired: true,
    };
  }

  listHistory(context: WorkspaceContext): readonly VoiceHistoryEntry[] {
    this.#assertAuthorized(context);
    return structuredClone(this.#history.get(key(context.workspaceId, context.principalId)) ?? []);
  }

  getSession(context: WorkspaceContext, sessionId: EntityId): VoiceSession | undefined {
    this.#assertAuthorized(context);
    const session = this.#sessions.get(key(context.workspaceId, sessionId));
    if (!session || session.principalId !== context.principalId) return undefined;
    return structuredClone(session);
  }

  #assertAuthorized(context: WorkspaceContext): void {
    if (!this.#authorizedPrincipals.has(context.principalId))
      throw new VoiceGatewayPolicyError('Voice Gateway authority required');
  }

  #requireAdapter(
    context: WorkspaceContext,
    adapterId: EntityId,
    kind: VoiceAdapterKind,
  ): VoiceProviderMetadata {
    const adapter = this.#adapters.get(key(context.workspaceId, adapterId));
    if (!adapter || adapter.kind !== kind)
      throw new VoiceGatewayPolicyError(`Supported ${kind} adapter is required`);
    return adapter;
  }

  #assertAdapterUsable(adapter: VoiceProviderMetadata, browser: BrowserVoiceCapabilities): void {
    if (!['AVAILABLE', 'BROWSER_LOCAL_AVAILABLE'].includes(adapter.status))
      throw new VoiceGatewayPolicyError('Voice adapter is unavailable');
    if (adapter.status === 'BROWSER_LOCAL_AVAILABLE') {
      const supported =
        (adapter.kind === 'STT' && browser.localSpeechToText) ||
        (adapter.kind === 'TTS' && browser.localTextToSpeech) ||
        (adapter.kind === 'REALTIME' && browser.realtimeSpeech);
      if (!supported || adapter.availability !== 'LOCAL_BROWSER')
        throw new VoiceGatewayPolicyError('Browser/local fallback is not available');
    }
  }

  #requireSession(context: WorkspaceContext, sessionId: EntityId): VoiceSession {
    this.#assertAuthorized(context);
    const session = this.#sessions.get(key(context.workspaceId, sessionId));
    if (!session || session.principalId !== context.principalId)
      throw new VoiceGatewayPolicyError('Session is outside the authenticated principal scope');
    return session;
  }

  #touch(session: VoiceSession): VoiceSession {
    session.updatedAt = new Date(this.#clock()).toISOString();
    return structuredClone(session);
  }

  #validateDecision(
    context: WorkspaceContext,
    session: VoiceSession,
    request: VoiceCommandRoutingRequest,
    decision: VoiceCommandRoutingDecision,
  ): void {
    exactKeys(
      decision,
      [
        'commandId',
        'exactTarget',
        'outcome',
        'reason',
        'requestId',
        'requiredAuthority',
        'responseText',
        'sessionId',
        'workspaceId',
      ].filter((field) => Object.hasOwn(decision, field)),
      'routingDecision',
    );
    if (
      decision.requestId !== request.id ||
      decision.workspaceId !== context.workspaceId ||
      decision.sessionId !== session.id
    )
      throw new VoiceGatewayPolicyError('Routing decision linkage is invalid');
    boundedText(decision.commandId, 'commandId', 256);
    boundedInteger(decision.requiredAuthority, 'requiredAuthority', 4);
    oneOf(decision.outcome, ['ROUTINE', 'LEVEL_4', 'DENY'], 'routingOutcome');
    boundedText(decision.reason, 'decisionReason', 2_048);
    boundedText(decision.responseText, 'responseText', this.#options.maximumResponseBytes);
    if (decision.outcome === 'LEVEL_4') {
      boundedText(decision.exactTarget, 'exactTarget', 2_048);
    } else if (decision.exactTarget !== undefined) {
      throw new VoiceGatewayPolicyError('Only Level-4 decisions may name an exact target');
    }
  }

  #deny(
    session: VoiceSession,
    envelope: FinalTranscriptEnvelope,
    redactedTranscript: string,
    reason: string,
  ): VoiceRoutingResult {
    const decision: VoiceCommandRoutingDecision = {
      requestId: this.#idFactory(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      commandId: this.#idFactory(),
      outcome: 'DENY',
      requiredAuthority: 0,
      reason,
      responseText: 'Voice command denied by policy.',
    };
    session.state = 'RESPONDING';
    this.#touch(session);
    this.#storeHistory(
      { workspaceId: session.workspaceId, principalId: session.principalId },
      session,
      envelope,
      decision,
      redactedTranscript,
      decision.responseText,
    );
    return { commandId: decision.commandId, outcome: 'DENY', responseText: decision.responseText };
  }

  #storeHistory(
    context: WorkspaceContext,
    session: VoiceSession,
    envelope: FinalTranscriptEnvelope,
    decision: VoiceCommandRoutingDecision,
    redactedTranscript: string,
    redactedResponse: string,
  ): void {
    const historyKey = key(context.workspaceId, context.principalId);
    const entries = this.#history.get(historyKey) ?? [];
    const entry: VoiceHistoryEntry = {
      id: this.#idFactory(),
      workspaceId: context.workspaceId,
      principalId: context.principalId,
      sessionId: session.id,
      commandId: decision.commandId,
      transcriptHash: sha256(envelope.transcript),
      ...(envelope.retention === 'REDACTED_SESSION' ? { redactedTranscript } : {}),
      redactedResponse,
      outcome: decision.outcome,
      requiredAuthority: decision.requiredAuthority,
      createdAt: new Date(this.#clock()).toISOString(),
    };
    entries.push(entry);
    while (entries.length > this.#options.maximumHistoryEntriesPerPrincipal) entries.shift();
    this.#history.set(historyKey, entries);
  }
}
