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
import { createCodexHeartbeatEvidenceCandidate } from './codex-heartbeat';
import {
  CODEX_VALIDATION_CHALLENGE,
  createCodexValidationDispatchCandidate,
} from './codex-validation-dispatch';
import {
  CODEX_VALIDATION_RESULT_CODE,
  createCodexValidationRoundTripCandidate,
  validateCodexValidationRoundTripCandidate,
} from './codex-validation-round-trip';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope } from './protocol';

const secret = new Uint8Array(32).fill(9);
const secretDigest = '8c0cc17a04942cc4f8e0fe0b302606d3108860c126428ba2ceeb5f9ed41c2b05';

function fixture() {
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
    expectedSecretDigest: secretDigest,
    authGeneration: 1,
    authenticatedAt: '2026-08-31T11:00:00.000Z',
    expiresAt: '2026-08-31T11:05:00.000Z',
  };
  const base = deterministicLinuxAdmission().manifest;
  const registration = createCodexAuthenticatedRegistrationCandidate({
    manifest: validateCodexAppServerManifest({
      ...base,
      workspaceId: bridge.workspaceId,
      runtimeId: bridge.runtimeId,
      connectionId: bridge.connectionId,
      manifestId: 'codex-validation-round-trip-manifest-v1',
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
      response: { id: 1, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } },
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
  const heartbeatPayload = { health: 'HEALTHY' };
  const heartbeat = createCodexHeartbeatEvidenceCandidate({
    registration,
    capability,
    bridge,
    envelope: signBridgeEnvelope(
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
        expiresAt: '2026-08-31T11:04:30.000Z',
        payloadDigest: digestBridgePayload(heartbeatPayload),
        payload: heartbeatPayload,
      },
      deriveBridgeKeys(secret, bridge).runtimeToParent,
    ),
  });
  const dispatch = createCodexValidationDispatchCandidate({
    heartbeat,
    dispatchId: 'validation-dispatch-1',
    taskId: 'validation-task-1',
    runId: 'validation-run-1',
    agentId: 'agent:codex-validator-1',
    authorityLevel: 3,
    taskPolicyHash: 'a'.repeat(64),
    maximumCostMinorUnits: 0,
    maximumComputeUnits: 10,
    maximumDurationMs: 30_000,
    issuedAt: '2026-08-31T11:03:15.000Z',
    expiresAt: '2026-08-31T11:03:45.000Z',
  });
  const terminal = {
    threadId: 'thread-1',
    turnId: 'turn-1',
    status: 'completed' as const,
    messageHash: 'b'.repeat(64),
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  const signed = (
    sequence: number,
    messageId: string,
    type: 'DISPATCH_ACCEPTED' | 'RESULT',
    payload: Record<string, unknown>,
    issuedAt: string,
  ): BridgeEnvelope =>
    signBridgeEnvelope(
      {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        workspaceId: bridge.workspaceId,
        runtimeId: bridge.runtimeId,
        connectionId: bridge.connectionId,
        sessionId: bridge.sessionId,
        principalReference: bridge.principalReference,
        sequence,
        messageId,
        type,
        issuedAt,
        expiresAt: '2026-08-31T11:03:44.000Z',
        payloadDigest: digestBridgePayload(payload),
        payload,
      },
      deriveBridgeKeys(secret, bridge).runtimeToParent,
    );
  const statusPayload = {
    challengeCode: CODEX_VALIDATION_CHALLENGE,
    dispatchId: dispatch.dispatchId,
    taskId: dispatch.taskId,
    runId: dispatch.runId,
  };
  const resultPayload = {
    ...statusPayload,
    resultCode: CODEX_VALIDATION_RESULT_CODE,
    terminalThreadId: terminal.threadId,
    terminalTurnId: terminal.turnId,
    terminalMessageHash: terminal.messageHash,
    terminalStatus: 'completed',
  };
  return {
    bridge,
    dispatch,
    terminal,
    statusEnvelope: signed(
      2,
      'validation-status-1',
      'DISPATCH_ACCEPTED',
      statusPayload,
      '2026-08-31T11:03:20.000Z',
    ),
    terminalEnvelope: signed(
      3,
      'validation-result-1',
      'RESULT',
      resultPayload,
      '2026-08-31T11:03:30.000Z',
    ),
  };
}

describe('Codex validation round-trip evidence', () => {
  it('normalizes exact authenticated status and result facts without promoting truth', () => {
    const candidate = createCodexValidationRoundTripCandidate(fixture());
    expect(candidate).toMatchObject({
      statusSequence: 2,
      terminalSequence: 3,
      statusState: 'ACCEPTED',
      terminalState: 'COMPLETED',
      maximumCostMinorUnits: 0,
      providerAccess: 'NOT_CONFIGURED',
      runtimeConnection: 'NOT_CONFIGURED',
      connectionTransition: 'NOT_APPLIED',
    });
    expect(validateCodexValidationRoundTripCandidate(candidate)).toEqual(candidate);
    expect(JSON.stringify(candidate)).not.toMatch(
      /\bmac\b|prompt|transcript|credential|result text/iu,
    );
  });

  it('rejects sequence, correlation, terminal-hash, timing, and truth drift', () => {
    const base = fixture();
    for (const changed of [
      { ...base, statusEnvelope: { ...base.statusEnvelope, sequence: 4 } },
      { ...base, terminalEnvelope: { ...base.terminalEnvelope, type: 'FAILED' as const } },
      { ...base, terminal: { ...base.terminal, messageHash: 'c'.repeat(64) } },
      { ...base, bridge: { ...base.bridge, runtimeId: 'other-runtime' } },
      { ...base, terminal: { ...base.terminal, runtimeConnection: 'CONNECTED' as never } },
    ])
      expect(() => createCodexValidationRoundTripCandidate(changed)).toThrow();
  });

  it('detects normalized evidence mutation', () => {
    const candidate = createCodexValidationRoundTripCandidate(fixture());
    expect(() =>
      validateCodexValidationRoundTripCandidate({
        ...candidate,
        terminalMessageHash: 'c'.repeat(64),
      }),
    ).toThrow();
  });
});
