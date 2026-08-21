import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../contracts';
import {
  GovernedVoiceGateway,
  type FinalTranscriptEnvelope,
  type TranscriptProofVerifier,
  type VoiceAuthorityEvaluator,
  type VoiceAdapterEvidenceVerifier,
  type VoiceCommandRoutingRequest,
  type VoiceCommandRouter,
  type VoiceProviderMetadata,
  VoiceGatewayPolicyError,
} from '../voice-gateway';

const now = Date.parse('2026-08-21T06:00:00.000Z');
const context: WorkspaceContext = { workspaceId: 'workspace-a', principalId: 'founder-a' };
const browser = {
  microphonePermissionApi: true,
  localSpeechToText: true,
  localTextToSpeech: true,
  realtimeSpeech: false,
};

function metadata(overrides: Partial<VoiceProviderMetadata> = {}): VoiceProviderMetadata {
  return {
    adapterId: 'browser-stt',
    kind: 'STT',
    provider: 'browser-local',
    status: 'BROWSER_LOCAL_AVAILABLE',
    availability: 'LOCAL_BROWSER',
    networkMode: 'OFFLINE',
    credentialMode: 'NONE',
    isFallback: true,
    availabilityEvidenceId: 'browser-capability-check-1',
    availabilityVerifiedAt: '2026-08-21T06:00:00.000Z',
    maximumInputBytes: 10_000,
    maximumTextBytes: 1_000,
    latencyP50Ms: 100,
    latencyP95Ms: 300,
    qualityScoreBps: 8_000,
    dataPolicy: 'LOCAL_ONLY',
    ...overrides,
  };
}

function setup(
  route: VoiceCommandRouter['route'] = vi.fn(
    (_context: WorkspaceContext, request: VoiceCommandRoutingRequest) => ({
      requestId: request.id,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      commandId: 'command-1',
      outcome: 'ROUTINE' as const,
      requiredAuthority: 3 as const,
      reason: 'bounded routine request',
      responseText: 'Prepared safely.',
    }),
  ),
  authority: VoiceAuthorityEvaluator['evaluate'] = vi.fn(() => ({
    allowed: true,
    maximumAuthority: 4 as const,
    reason: 'founder',
  })),
  proofVerifier: TranscriptProofVerifier['verify'] = vi.fn(() => true),
  adapterEvidenceVerifier: VoiceAdapterEvidenceVerifier['verify'] = vi.fn(() => true),
) {
  let id = 0;
  const gateway = new GovernedVoiceGateway(
    {
      authorizedPrincipals: ['founder-a'],
      maximumAudioBytes: 10_000,
      maximumTranscriptBytes: 1_000,
      maximumResponseBytes: 1_000,
      maximumHistoryEntriesPerPrincipal: 2,
      transcriptFreshnessMs: 30_000,
      availabilityEvidenceFreshnessMs: 30_000,
      clock: () => now,
      idFactory: () => `id-${++id}`,
    },
    {
      router: { route },
      authority: { evaluate: authority },
      proofVerifier: { verify: proofVerifier },
      adapterEvidenceVerifier: { verify: adapterEvidenceVerifier },
    },
  );
  gateway.registerAdapter(context, metadata());
  gateway.registerAdapter(
    context,
    metadata({ adapterId: 'browser-tts', kind: 'TTS', maximumInputBytes: 1_000 }),
  );
  return { gateway, route, authority, proofVerifier };
}

function ready(gateway: GovernedVoiceGateway, sessionId = 'session-1') {
  gateway.createSession(context, {
    id: sessionId,
    sttAdapterId: 'browser-stt',
    ttsAdapterId: 'browser-tts',
    browser,
  });
  gateway.requestMicrophonePermission(context, sessionId);
  gateway.recordMicrophonePermission(context, sessionId, 'GRANTED');
  gateway.pressToTalk(context, sessionId);
  gateway.releaseToTalk(context, sessionId);
}

function transcript(overrides: Partial<FinalTranscriptEnvelope> = {}): FinalTranscriptEnvelope {
  return {
    sessionId: 'session-1',
    workspaceId: 'workspace-a',
    principalId: 'founder-a',
    adapterId: 'browser-stt',
    sequence: 1,
    nonce: 'nonce-1',
    observedAt: '2026-08-21T06:00:00.000Z',
    final: true,
    transcript: 'Prepare the release evidence',
    audioBytes: 100,
    proof: 'proof-1',
    retention: 'REDACTED_SESSION',
    ...overrides,
  };
}

describe('GovernedVoiceGateway', () => {
  it('enforces microphone permission and push-to-talk transitions', () => {
    const { gateway } = setup();
    const created = gateway.createSession(context, {
      id: 'session-1',
      sttAdapterId: 'browser-stt',
      browser,
    });
    expect(created).toMatchObject({ state: 'IDLE', permission: 'NOT_REQUESTED' });
    expect(() => gateway.pressToTalk(context, 'session-1')).toThrow(/granted permission/);
    expect(gateway.requestMicrophonePermission(context, 'session-1').state).toBe(
      'REQUESTING_PERMISSION',
    );
    expect(gateway.recordMicrophonePermission(context, 'session-1', 'GRANTED').state).toBe('READY');
    expect(gateway.pressToTalk(context, 'session-1').state).toBe('RECORDING');
    expect(gateway.releaseToTalk(context, 'session-1').state).toBe('TRANSCRIBING');
  });

  it.each(['DENIED', 'UNAVAILABLE'] as const)('fails closed on microphone %s', (result) => {
    const { gateway } = setup();
    gateway.createSession(context, { id: 'session-1', sttAdapterId: 'browser-stt', browser });
    gateway.requestMicrophonePermission(context, 'session-1');
    expect(gateway.recordMicrophonePermission(context, 'session-1', result)).toMatchObject({
      state: 'FAILED',
      permission: result,
    });
    expect(() => gateway.pressToTalk(context, 'session-1')).toThrow();
  });

  it('routes only a proof-verified final transcript through bounded AI COO input', () => {
    const { gateway, route, proofVerifier } = setup();
    ready(gateway);
    expect(gateway.routeFinalTranscript(context, transcript())).toEqual({
      commandId: 'command-1',
      outcome: 'ROUTINE',
      responseText: 'Prepared safely.',
    });
    expect(proofVerifier).toHaveBeenCalledOnce();
    expect(route).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        source: 'VOICE',
        maximumExecutableAuthority: 3,
        redactedTranscript: 'Prepare the release evidence',
      }),
    );
  });

  it.each([
    ['spoofed interim transcript', { final: false }, /final transcripts/],
    ['oversized audio', { audioBytes: 10_001 }, /audioBytes/],
    ['oversized transcript', { transcript: 'x'.repeat(1_001) }, /transcript/],
    ['stale transcript', { observedAt: '2026-08-21T05:59:00.000Z' }, /stale/],
    ['future transcript', { observedAt: '2026-08-21T06:01:00.000Z' }, /future/],
    ['cross-workspace transcript', { workspaceId: 'workspace-b' }, /linkage/],
    ['wrong principal', { principalId: 'attacker' }, /linkage/],
    ['wrong adapter', { adapterId: 'browser-tts' }, /linkage/],
  ])('rejects %s before routing', (_label, overrides, error) => {
    const { gateway, route } = setup();
    ready(gateway);
    expect(() => gateway.routeFinalTranscript(context, transcript(overrides))).toThrow(error);
    expect(route).not.toHaveBeenCalled();
  });

  it('rejects invalid proof and exact proof/sequence replay', () => {
    const invalid = setup(
      undefined,
      undefined,
      vi.fn(() => false),
    );
    ready(invalid.gateway);
    expect(() => invalid.gateway.routeFinalTranscript(context, transcript())).toThrow(/proof/);

    const valid = setup();
    ready(valid.gateway);
    valid.gateway.routeFinalTranscript(context, transcript());
    ready(valid.gateway, 'session-2');
    expect(() =>
      valid.gateway.routeFinalTranscript(
        context,
        transcript({ sessionId: 'session-2', sequence: 2, proof: 'proof-1' }),
      ),
    ).toThrow(/replay/);
  });

  it('requires Level-4 commands to leave voice and enter secure confirmation', () => {
    const route = vi.fn((_context: WorkspaceContext, request: VoiceCommandRoutingRequest) => ({
      requestId: request.id,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      commandId: 'deploy-1',
      outcome: 'LEVEL_4' as const,
      requiredAuthority: 4 as const,
      exactTarget: 'production/release-1',
      reason: 'production deployment requires Founder confirmation',
      responseText: 'Prepared release evidence. Confirm in the protected interface.',
    }));
    const { gateway } = setup(route);
    ready(gateway);
    expect(gateway.routeFinalTranscript(context, transcript())).toMatchObject({
      outcome: 'LEVEL_4',
      confirmation: {
        status: 'SECURE_CONFIRMATION_REQUIRED',
        exactTarget: 'production/release-1',
        voiceConfirmationAccepted: false,
        permittedChannels: ['PROTECTED_UI', 'WEBAUTHN_OR_MFA'],
      },
    });
  });

  it('rejects authority bypass and malformed Level-4 decisions', () => {
    const bypass = vi.fn((_context: WorkspaceContext, request: VoiceCommandRoutingRequest) => ({
      requestId: request.id,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      commandId: 'deploy-1',
      outcome: 'ROUTINE' as const,
      requiredAuthority: 4 as const,
      reason: 'bypass',
      responseText: 'Deploying.',
    }));
    const { gateway } = setup(bypass);
    ready(gateway);
    expect(() => gateway.routeFinalTranscript(context, transcript())).toThrow(/Level-4/);
  });

  it('denies before AI COO routing when deterministic voice authority rejects', () => {
    const { gateway, route } = setup(
      undefined,
      vi.fn(() => ({ allowed: false, maximumAuthority: 0 as const, reason: 'not permitted' })),
    );
    ready(gateway);
    expect(gateway.routeFinalTranscript(context, transcript())).toMatchObject({ outcome: 'DENY' });
    expect(route).not.toHaveBeenCalled();
  });

  it('redacts secrets and personal contact data and never retains raw transcript', () => {
    const { gateway, route } = setup();
    ready(gateway);
    const raw = 'Email founder@example.com and use sk-abcdefghijklmnopqrstuvwxyz123456';
    gateway.routeFinalTranscript(context, transcript({ transcript: raw }));
    expect(route).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ redactedTranscript: '[REDACTED_SENSITIVE_TRANSCRIPT]' }),
    );
    const history = gateway.listHistory(context);
    expect(history[0]?.redactedTranscript).toBe('[REDACTED_SENSITIVE_TRANSCRIPT]');
    expect(JSON.stringify(history)).not.toContain(raw);
  });

  it.each([
    'password=hunter2-and-more',
    '-----BEGIN PRIVATE KEY-----\nSUPERSECRETKEYBODY\n-----END PRIVATE KEY-----',
    'Authorization: opaquecredentialvalue12345',
  ])('fails closed instead of retaining sensitive transcript content: %s', (raw) => {
    const { gateway, route } = setup();
    ready(gateway);
    gateway.routeFinalTranscript(context, transcript({ transcript: raw }));
    expect(route).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ redactedTranscript: '[REDACTED_SENSITIVE_TRANSCRIPT]' }),
    );
    expect(JSON.stringify(gateway.listHistory(context))).not.toContain(raw);
    expect(JSON.stringify(gateway.listHistory(context))).not.toContain('SUPERSECRETKEYBODY');
  });

  it('supports no-transcript retention, bounded history, stop and replay plans', () => {
    const { gateway } = setup();
    for (let index = 1; index <= 3; index += 1) {
      const sessionId = `session-${index}`;
      ready(gateway, sessionId);
      gateway.routeFinalTranscript(
        context,
        transcript({
          sessionId,
          sequence: index,
          nonce: `nonce-${index}`,
          proof: `proof-${index}`,
          retention: 'NONE',
        }),
      );
    }
    const history = gateway.listHistory(context);
    expect(history).toHaveLength(2);
    expect(history.every((entry) => entry.redactedTranscript === undefined)).toBe(true);
    expect(gateway.replay(context, history[0]!.id)).toMatchObject({
      ttsAdapterId: 'browser-tts',
      providerInvocationRequired: true,
    });
    expect(gateway.stop(context, 'session-3', 'Founder stopped playback').state).toBe('STOPPED');
  });

  it('rejects unsupported providers, false browser fallback and raw retention', () => {
    const { gateway } = setup();
    expect(() =>
      gateway.createSession(context, { id: 'missing', sttAdapterId: 'unsupported', browser }),
    ).toThrow(/Supported STT adapter/);
    expect(() =>
      gateway.createSession(context, {
        id: 'no-local',
        sttAdapterId: 'browser-stt',
        browser: { ...browser, localSpeechToText: false },
      }),
    ).toThrow(/fallback/);
    ready(gateway);
    expect(() =>
      gateway.routeFinalTranscript(context, transcript({ retention: 'RAW' as never })),
    ).toThrow(/retention/);
  });

  it('rejects forged adapter enums, capability flags, and fallback status', () => {
    const { gateway } = setup();
    expect(() =>
      gateway.registerAdapter(
        context,
        metadata({ adapterId: 'forged-kind', kind: 'COMMAND' as never }),
      ),
    ).toThrow(/kind/);
    expect(() =>
      gateway.registerAdapter(context, metadata({ adapterId: 'false-local', status: 'AVAILABLE' })),
    ).toThrow(/browser-local status/);
    expect(() =>
      gateway.createSession(context, {
        id: 'forged-browser',
        sttAdapterId: 'browser-stt',
        browser: { ...browser, localSpeechToText: 'yes' as never },
      }),
    ).toThrow(/boolean/);
  });

  it('requires fresh verified adapter evidence and enforces adapter-specific limits', () => {
    const rejected = setup(
      undefined,
      undefined,
      undefined,
      vi.fn((_context, adapter) => adapter.adapterId !== 'unverified'),
    );
    expect(() =>
      rejected.gateway.registerAdapter(
        context,
        metadata({ adapterId: 'unverified', kind: 'REALTIME' }),
      ),
    ).toThrow(/evidence/);

    const { gateway } = setup();
    expect(() =>
      gateway.registerAdapter(
        context,
        metadata({
          adapterId: 'future',
          kind: 'REALTIME',
          availabilityVerifiedAt: '2026-08-21T06:01:00.000Z',
        }),
      ),
    ).toThrow(/evidence/);
    gateway.registerAdapter(
      context,
      metadata({ adapterId: 'limited-stt', maximumInputBytes: 100, maximumTextBytes: 100 }),
    );
    gateway.createSession(context, {
      id: 'limited-session',
      sttAdapterId: 'limited-stt',
      browser,
    });
    gateway.requestMicrophonePermission(context, 'limited-session');
    gateway.recordMicrophonePermission(context, 'limited-session', 'GRANTED');
    gateway.pressToTalk(context, 'limited-session');
    gateway.releaseToTalk(context, 'limited-session');
    expect(() =>
      gateway.routeFinalTranscript(
        context,
        transcript({
          sessionId: 'limited-session',
          adapterId: 'limited-stt',
          transcript: 'x'.repeat(101),
          audioBytes: 101,
        }),
      ),
    ).toThrow(/adapter-specific/);
  });

  it('rejects malformed authority and routing enum values from injected ports', () => {
    const malformedAuthority = setup(
      undefined,
      vi.fn(() => ({ allowed: 'yes' as never, maximumAuthority: 4 as const, reason: 'forged' })),
    );
    ready(malformedAuthority.gateway);
    expect(() => malformedAuthority.gateway.routeFinalTranscript(context, transcript())).toThrow(
      /authorityAllowed/,
    );

    const malformedRoute = setup(
      vi.fn((_context: WorkspaceContext, request: VoiceCommandRoutingRequest) => ({
        requestId: request.id,
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
        commandId: 'command-1',
        outcome: 'EXECUTE' as never,
        requiredAuthority: 3 as const,
        reason: 'forged',
        responseText: 'forged',
      })),
    );
    ready(malformedRoute.gateway);
    expect(() => malformedRoute.gateway.routeFinalTranscript(context, transcript())).toThrow(
      /routingOutcome/,
    );
  });

  it('rejects hidden fields, cross-principal access and unauthorized registration', () => {
    const { gateway } = setup();
    const attacker = { workspaceId: 'workspace-a', principalId: 'attacker' };
    expect(() => gateway.listHistory(attacker)).toThrow(VoiceGatewayPolicyError);
    expect(() => gateway.registerAdapter(attacker, metadata({ adapterId: 'evil' }))).toThrow();
    expect(() =>
      gateway.createSession(context, {
        id: 'session-1',
        sttAdapterId: 'browser-stt',
        browser,
        chainOfThought: 'private reasoning',
      } as never),
    ).toThrow(/unsupported fields/);
  });
});
