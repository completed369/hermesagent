import { describe, expect, it } from 'vitest';

import { deterministicLinuxAdmission } from './__tests__/fixtures/deterministic-supervision';
import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import {
  codexCapabilityExchangeAuthorizationRequestHash,
  createCodexCapabilityExchangeAuthorizationRequest,
  createCodexCapabilityExchangeCandidate,
  DenyCodexCapabilityExchangeAuthorizationSource,
  validateCodexCapabilityExchangeAuthorizationDecision,
  validateCodexCapabilityExchangeCandidate,
  type CodexModelListEvidence,
} from './codex-capability-exchange';
import {
  createCodexAuthenticatedRegistrationCandidate,
  type CodexAccountReadEvidence,
} from './codex-authenticated-registration';
import {
  CODEX_APP_SERVER_ADAPTER_KIND,
  CODEX_APP_SERVER_ARGUMENT_POLICY,
  CODEX_APP_SERVER_ARGV,
  validateCodexAppServerManifest,
} from './codex-app-server-policy';
import type { CodexAppServerSessionSnapshot } from './codex-app-server-session';

function registration() {
  const base = deterministicLinuxAdmission().manifest;
  const manifest = validateCodexAppServerManifest({
    ...base,
    manifestId: 'codex-capability-manifest-v1',
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
  });
  const protocol: CodexAppServerSessionSnapshot = {
    state: 'INITIALIZED',
    threadId: null,
    turnId: null,
    terminalStatus: null,
    acceptedEvents: 0,
    acceptedBytes: 0,
    runtimeConnection: 'NOT_CONFIGURED',
  };
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
    expectedSecretDigest: 'a'.repeat(64),
    authGeneration: 2,
    authenticatedAt: '2026-08-31T11:00:00.000Z',
    expiresAt: '2026-08-31T11:05:00.000Z',
  };
  const account: CodexAccountReadEvidence = {
    request: { method: 'account/read', id: 41, params: { refreshToken: false } },
    response: {
      id: 41,
      result: {
        account: { type: 'chatgpt', email: 'person@example.com', planType: 'plus' },
        requiresOpenaiAuth: true,
      },
    },
    observedAt: '2026-08-31T11:01:00.000Z',
  };
  return createCodexAuthenticatedRegistrationCandidate({ manifest, protocol, bridge, account });
}

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    displayName: 'GPT 5.6 Sol',
    hidden: false,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'high', description: 'Thorough' },
    ],
    inputModalities: ['text', 'image'],
    supportsPersonality: true,
    isDefault: true,
    ...overrides,
  };
}

function exchange(overrides: Partial<CodexModelListEvidence> = {}): CodexModelListEvidence {
  return {
    request: { method: 'model/list', id: 42, params: { limit: 20, includeHidden: false } },
    response: { id: 42, result: { data: [model()], nextCursor: null } },
    observedAt: '2026-08-31T11:02:00.000Z',
    ...overrides,
  };
}

function candidate(evidence: CodexModelListEvidence = exchange()) {
  return createCodexCapabilityExchangeCandidate({
    registration: registration(),
    exchange: evidence,
  });
}

describe('Codex capability exchange translation', () => {
  it('creates deterministic, non-authorizing catalog claims without retaining model identity', () => {
    const first = candidate();
    expect(candidate()).toEqual(first);
    expect(first).toMatchObject({
      adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
      modelCount: 1,
      capabilityAuthorization: 'NOT_CONFIGURED',
      providerAccess: 'NOT_CONFIGURED',
      runtimeConnection: 'NOT_CONFIGURED',
      capabilityCodes: [
        'codex.catalog.input.image',
        'codex.catalog.input.text',
        'codex.catalog.model-list',
        'codex.catalog.personality',
        'codex.catalog.reasoning.high',
        'codex.catalog.reasoning.low',
      ],
    });
    expect(first.capabilityCandidateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.modelCatalogHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('gpt-5.6-sol');
    expect(JSON.stringify(first)).not.toContain('GPT 5.6 Sol');
  });

  it('binds the digest to normalized model capabilities', () => {
    const changed = exchange({
      response: {
        id: 42,
        result: { data: [model({ inputModalities: ['text'] })], nextCursor: null },
      },
    });
    expect(candidate(changed).modelCatalogHash).not.toBe(candidate().modelCatalogHash);
    expect(candidate(changed).capabilityDigest).not.toBe(candidate().capabilityDigest);
  });

  it('validates stable optional catalog metadata without retaining or claiming it', () => {
    const evidence = exchange({
      response: {
        id: 42,
        result: {
          data: [
            model({
              description: 'Current stable model',
              inputModalities: ['text', 'image', 'audio'],
              defaultReasoningEffort: 'minimal',
              supportedReasoningEfforts: [
                { reasoningEffort: 'none', description: 'No extra reasoning' },
                { reasoningEffort: 'minimal', description: 'Minimal reasoning' },
              ],
              additionalSpeedTiers: ['fast'],
              serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Priority tier' }],
              defaultServiceTier: 'priority',
              modelSpecialty: 'coding',
              multiAgentVersion: 'v2',
              availabilityNux: { message: 'Available' },
              upgrade: 'gpt-5.6-terra',
              upgradeInfo: {
                model: 'gpt-5.6-terra',
                upgradeCopy: 'Upgrade available',
                modelLink: 'https://example.invalid/model',
                migrationMarkdown: 'Review the migration.',
              },
            }),
          ],
          nextCursor: null,
        },
      },
    });
    const result = candidate(evidence);
    expect(result.capabilityCodes).toContain('codex.catalog.input.audio');
    expect(result.capabilityCodes).toContain('codex.catalog.reasoning.none');
    expect(result.capabilityCodes).toContain('codex.catalog.reasoning.minimal');
    expect(JSON.stringify(result)).not.toContain('Priority tier');
    expect(JSON.stringify(result)).not.toContain('Upgrade available');
  });

  it('rejects hidden, paginated, experimental, and response-mismatched evidence', () => {
    const cases: CodexModelListEvidence[] = [
      exchange({
        request: { method: 'model/list', id: 42, params: { limit: 20, includeHidden: true } },
      }),
      exchange({ response: { id: 42, result: { data: [model()], nextCursor: 'page-2' } } }),
      exchange({
        request: {
          method: 'experimentalFeature/list',
          id: 42,
          params: { limit: 20, includeHidden: false },
        },
      }),
      exchange({ response: { id: 43, result: { data: [model()], nextCursor: null } } }),
    ];
    for (const evidence of cases) expect(() => candidate(evidence)).toThrow();
  });

  it('rejects unknown, duplicate, and internally inconsistent capabilities', () => {
    const cases: CodexModelListEvidence[] = [
      exchange({
        response: {
          id: 42,
          result: { data: [model({ inputModalities: ['video'] })], nextCursor: null },
        },
      }),
      exchange({
        response: {
          id: 42,
          result: {
            data: [
              model({
                supportedReasoningEfforts: [{ reasoningEffort: 'extreme', description: 'Unknown' }],
              }),
            ],
            nextCursor: null,
          },
        },
      }),
      exchange({ response: { id: 42, result: { data: [model(), model()], nextCursor: null } } }),
      exchange({
        response: {
          id: 42,
          result: { data: [model({ defaultReasoningEffort: 'medium' })], nextCursor: null },
        },
      }),
      exchange({
        response: {
          id: 42,
          result: {
            data: [model(), model({ id: 'gpt-5.6-terra', model: 'gpt-5.6-terra' })],
            nextCursor: null,
          },
        },
      }),
      exchange({
        response: {
          id: 42,
          result: { data: [model({ unreviewedField: true })], nextCursor: null },
        },
      }),
    ];
    for (const evidence of cases) expect(() => candidate(evidence)).toThrow();
  });

  it('requires the complete catalog within the registration evidence window', () => {
    expect(() => candidate(exchange({ observedAt: '2026-08-31T11:00:59.999Z' }))).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_EXPIRED' }),
    );
    expect(() => candidate(exchange({ observedAt: '2026-08-31T11:06:00.001Z' }))).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_EXPIRED' }),
    );
  });

  it('revalidates exact shape, ordering, digest, and candidate hash', () => {
    const valid = candidate();
    expect(validateCodexCapabilityExchangeCandidate(valid)).toEqual(valid);
    expect(() => validateCodexCapabilityExchangeCandidate({ ...valid, rawResponse: {} })).toThrow();
    expect(() =>
      validateCodexCapabilityExchangeCandidate({
        ...valid,
        capabilityCodes: [...valid.capabilityCodes].reverse(),
      }),
    ).toThrow();
    expect(() =>
      validateCodexCapabilityExchangeCandidate({ ...valid, capabilityDigest: '0'.repeat(64) }),
    ).toThrow();
  });

  it('binds a short-lived authorization to the exact candidate, policy, and idempotency key', () => {
    const request = createCodexCapabilityExchangeAuthorizationRequest(
      candidate(),
      'c'.repeat(64),
      'capability-codex-1',
    );
    const requestHash = codexCapabilityExchangeAuthorizationRequestHash(request);
    const decision = validateCodexCapabilityExchangeAuthorizationDecision(
      {
        schemaVersion: 1,
        authorizationId: 'codex-capability-authorization-1',
        requestHash,
        authorizedByReference: 'control-plane:capability-policy-v1',
        issuedAt: '2026-08-31T11:02:01.000Z',
        expiresAt: '2026-08-31T11:05:01.000Z',
      },
      requestHash,
    );
    expect(decision.requestHash).toBe(requestHash);
    expect(() =>
      validateCodexCapabilityExchangeAuthorizationDecision(
        { ...decision, requestHash: '0'.repeat(64) },
        requestHash,
      ),
    ).toThrow(expect.objectContaining({ code: 'CAPABILITY_EXCHANGE_NOT_AUTHORIZED' }));
  });

  it('keeps the production authorization source deny-only', async () => {
    const request = createCodexCapabilityExchangeAuthorizationRequest(
      candidate(),
      'c'.repeat(64),
      'capability-codex-1',
    );
    await expect(
      new DenyCodexCapabilityExchangeAuthorizationSource().read(request),
    ).rejects.toMatchObject({ code: 'CAPABILITY_EXCHANGE_NOT_AUTHORIZED' });
  });
});
