import { describe, expect, it } from 'vitest';

import { deriveBridgeKeys, digestBridgePayload, signBridgeEnvelope } from './auth';
import { deterministicLinuxAdmission } from './__tests__/fixtures/deterministic-supervision';
import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import {
  CODEX_APP_SERVER_ADAPTER_KIND,
  CODEX_APP_SERVER_ARGUMENT_POLICY,
  CODEX_APP_SERVER_ARGV,
  validateCodexAppServerManifest,
} from './codex-app-server-policy';
import { createCodexAuthenticatedRegistrationCandidate } from './codex-authenticated-registration';
import { createCodexCapabilityExchangeCandidate } from './codex-capability-exchange';
import {
  createCodexHeartbeatEvidenceCandidate,
  validateCodexHeartbeatEvidenceCandidate,
} from './codex-heartbeat';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope } from './protocol';

const secret = new Uint8Array(32).fill(7);

function fixture() {
  const base = deterministicLinuxAdmission().manifest;
  const bridge: AuthenticatedJsonlSessionContext = {
    schemaVersion: 1,
    workspaceId: 'workspace-1',
    runtimeId: 'codex.runtime-1',
    connectionId: 'connection-1',
    sessionId: 'session-1',
    principalReference: 'principal:codex-runtime-1',
    parentNonce: 'parent-nonce-1',
    runtimeNonce: 'runtime-nonce-1',
    secretReference: 'secret:codex-runtime-1',
    expectedSecretDigest: '4bb06f8e4e3a7715d201d573d0aa423762e55dabd61a2c02278fa56cc6d294e0',
    authGeneration: 1,
    authenticatedAt: '2026-08-31T11:00:00.000Z',
    expiresAt: '2026-08-31T11:05:00.000Z',
  };
  const registration = createCodexAuthenticatedRegistrationCandidate({
    manifest: validateCodexAppServerManifest({
      ...base,
      workspaceId: bridge.workspaceId,
      runtimeId: bridge.runtimeId,
      connectionId: bridge.connectionId,
      manifestId: 'codex-heartbeat-manifest-v1',
      adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
      testOnly: false,
      executable: {
        canonicalPath: '/opt/ventureos/runtimes/codex/codex',
        sha256: '8'.repeat(64),
        identityReference: 'device-8:inode-12',
      },
      argv: [...CODEX_APP_SERVER_ARGV],
      argumentPolicyReference: CODEX_APP_SERVER_ARGUMENT_POLICY,
      secretTransport: 'NONE',
    }),
    protocol: {
      state: 'INITIALIZED',
      threadId: null,
      turnId: null,
      terminalStatus: null,
      acceptedEvents: 0,
      acceptedBytes: 0,
      runtimeConnection: 'NOT_CONFIGURED',
    },
    bridge,
    account: {
      request: { method: 'account/read', id: 1, params: { refreshToken: false } },
      response: {
        id: 1,
        result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true },
      },
      observedAt: '2026-08-31T11:01:00.000Z',
    },
  });
  const capability = createCodexCapabilityExchangeCandidate({
    registration,
    exchange: {
      request: { method: 'model/list', id: 2, params: { limit: 1, includeHidden: false } },
      response: {
        id: 2,
        result: {
          data: [
            {
              id: 'model-1',
              model: 'model-1',
              displayName: 'Model One',
              hidden: false,
              defaultReasoningEffort: 'low',
              supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }],
              inputModalities: ['text'],
              supportsPersonality: false,
              isDefault: true,
            },
          ],
          nextCursor: null,
        },
      },
      observedAt: '2026-08-31T11:02:00.000Z',
    },
  });
  const payload = { health: 'HEALTHY' };
  const keys = deriveBridgeKeys(secret, bridge);
  const envelope = signBridgeEnvelope(
    {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      workspaceId: bridge.workspaceId,
      runtimeId: bridge.runtimeId,
      connectionId: bridge.connectionId,
      sessionId: bridge.sessionId,
      principalReference: bridge.principalReference,
      sequence: 1,
      messageId: 'heartbeat-1',
      type: 'HEARTBEAT',
      issuedAt: '2026-08-31T11:03:00.000Z',
      expiresAt: '2026-08-31T11:04:00.000Z',
      payloadDigest: digestBridgePayload(payload),
      payload,
    },
    keys.runtimeToParent,
  );
  return { bridge, registration, capability, envelope };
}

describe('Codex heartbeat evidence translation', () => {
  it('creates immutable bounded evidence without promoting runtime truth or retaining the MAC', () => {
    const input = fixture();
    const candidate = createCodexHeartbeatEvidenceCandidate(input);
    expect(candidate).toMatchObject({
      adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
      sequence: 1,
      health: 'HEALTHY',
      runtimeConnection: 'NOT_CONFIGURED',
      registrationCandidateHash: input.registration.registrationCandidateHash,
      capabilityCandidateHash: input.capability.capabilityCandidateHash,
    });
    expect(candidate.heartbeatCandidateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(JSON.stringify(candidate)).not.toContain(input.envelope.mac);
    expect(validateCodexHeartbeatEvidenceCandidate(candidate)).toEqual(candidate);
  });

  it('binds exact registration, capability, bridge identity, and heartbeat schema', () => {
    const input = fixture();
    for (const changed of [
      { ...input, bridge: { ...input.bridge, runtimeNonce: 'runtime-nonce-2' } },
      {
        ...input,
        envelope: { ...input.envelope, sequence: 2 } as BridgeEnvelope,
      },
      {
        ...input,
        envelope: { ...input.envelope, payload: { health: 'HEALTHY', load: 1 } } as BridgeEnvelope,
      },
      {
        ...input,
        envelope: { ...input.envelope, type: 'CAPABILITIES' } as BridgeEnvelope,
      },
    ])
      expect(() => createCodexHeartbeatEvidenceCandidate(changed)).toThrow();
  });

  it('rejects pre-capability, post-session, malformed and tampered candidates', () => {
    const input = fixture();
    expect(() =>
      createCodexHeartbeatEvidenceCandidate({
        ...input,
        envelope: {
          ...input.envelope,
          issuedAt: '2026-08-31T11:01:59.999Z',
          expiresAt: '2026-08-31T11:02:30.000Z',
        },
      }),
    ).toThrow();
    expect(() =>
      createCodexHeartbeatEvidenceCandidate({
        ...input,
        envelope: { ...input.envelope, expiresAt: '2026-08-31T11:05:00.001Z' },
      }),
    ).toThrow();
    const candidate = createCodexHeartbeatEvidenceCandidate(input);
    expect(() =>
      validateCodexHeartbeatEvidenceCandidate({
        ...candidate,
        heartbeatCandidateHash: '0'.repeat(64),
      }),
    ).toThrow();
    expect(() =>
      validateCodexHeartbeatEvidenceCandidate({ ...candidate, mac: 'forbidden' }),
    ).toThrow();
  });
});
