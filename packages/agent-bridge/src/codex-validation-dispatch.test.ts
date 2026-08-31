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
  codexValidationDispatchAuthorizationRequestHash,
  codexValidationDispatchUnsignedEnvelope,
  createCodexValidationDispatchAuthorizationRequest,
  createCodexValidationDispatchCandidate,
  DenyCodexValidationDispatchAuthorizationSource,
  validateCodexValidationDispatchAuthorizationDecision,
  validateCodexValidationDispatchCandidate,
} from './codex-validation-dispatch';
import { BRIDGE_PROTOCOL_VERSION } from './protocol';

const secret = new Uint8Array(32).fill(9);
const secretDigest = '8c0cc17a04942cc4f8e0fe0b302606d3108860c126428ba2ceeb5f9ed41c2b05';

function heartbeatFixture() {
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
    expectedSecretDigest: secretDigest,
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
      manifestId: 'codex-validation-manifest-v1',
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
  const heartbeatEnvelope = signBridgeEnvelope(
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
      payloadDigest: digestBridgePayload(payload),
      payload,
    },
    deriveBridgeKeys(secret, bridge).runtimeToParent,
  );
  return createCodexHeartbeatEvidenceCandidate({
    registration,
    capability,
    bridge,
    envelope: heartbeatEnvelope,
  });
}

function candidate(overrides: Record<string, unknown> = {}) {
  return createCodexValidationDispatchCandidate({
    heartbeat: heartbeatFixture(),
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
    ...overrides,
  });
}

describe('Codex validation dispatch translation', () => {
  it('prepares only a zero-spend, non-delivered, non-assigning validation envelope', () => {
    const result = candidate();
    expect(result).toMatchObject({
      challengeCode: CODEX_VALIDATION_CHALLENGE,
      maximumCostMinorUnits: 0,
      outboundSequence: 1,
      assignmentState: 'NOT_CONFIGURED',
      deliveryState: 'NOT_SENT',
      providerAccess: 'NOT_CONFIGURED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(validateCodexValidationDispatchCandidate(result)).toEqual(result);
    const unsigned = codexValidationDispatchUnsignedEnvelope(result);
    expect(unsigned.type).toBe('DISPATCH');
    expect(unsigned.payload).toMatchObject({
      schemaVersion: 1,
      challengeCode: CODEX_VALIDATION_CHALLENGE,
      taskId: 'validation-task-1',
      runId: 'validation-run-1',
    });
    expect(JSON.stringify(result)).not.toMatch(/prompt|transcript|task text|mac/u);
  });

  it('rejects cost, authority, resource, timing, and heartbeat boundary expansion', () => {
    for (const overrides of [
      { maximumCostMinorUnits: 1 },
      { authorityLevel: 4 },
      { maximumComputeUnits: 101 },
      { maximumDurationMs: 60_001 },
      { issuedAt: '2026-08-31T11:04:00.001Z', expiresAt: '2026-08-31T11:04:20.000Z' },
      { issuedAt: '2026-08-31T11:03:15.000Z', expiresAt: '2026-08-31T11:04:30.001Z' },
    ])
      expect(() => candidate(overrides)).toThrow();
  });

  it('rejects altered normalized fields, envelope digests, and extra data', () => {
    const valid = candidate();
    for (const changed of [
      { ...valid, messageId: 'other-message' },
      { ...valid, payloadDigest: '0'.repeat(64) },
      { ...valid, unsignedEnvelopeDigest: '0'.repeat(64) },
      { ...valid, deliveryState: 'SENT' },
      { ...valid, prompt: 'forbidden' },
    ])
      expect(() => validateCodexValidationDispatchCandidate(changed)).toThrow();
  });

  it('requires a short exact authorization and keeps production deny-only', async () => {
    const request = createCodexValidationDispatchAuthorizationRequest(
      candidate(),
      'validation-idempotency-1',
    );
    const requestHash = codexValidationDispatchAuthorizationRequestHash(request);
    expect(
      validateCodexValidationDispatchAuthorizationDecision(
        {
          schemaVersion: 1,
          authorizationId: 'validation-authorization-1',
          requestHash,
          authorizedByReference: 'control-plane:validation-policy-v1',
          issuedAt: '2026-08-31T11:03:16.000Z',
          expiresAt: '2026-08-31T11:04:16.000Z',
        },
        requestHash,
      ).requestHash,
    ).toBe(requestHash);
    await expect(
      new DenyCodexValidationDispatchAuthorizationSource().read(request),
    ).rejects.toMatchObject({ code: 'VALIDATION_DISPATCH_NOT_AUTHORIZED' });
  });
});
