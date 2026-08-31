import { describe, expect, it } from 'vitest';

import { deterministicLinuxAdmission } from './__tests__/fixtures/deterministic-supervision';
import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import {
  codexRegistrationAuthorizationRequestHash,
  createCodexAuthenticatedRegistrationCandidate,
  createCodexRegistrationAuthorizationRequest,
  DenyCodexRegistrationAuthorizationSource,
  validateCodexAuthenticatedRegistrationCandidate,
  validateCodexRegistrationAuthorizationDecision,
  type CodexAccountReadEvidence,
} from './codex-authenticated-registration';
import {
  CODEX_APP_SERVER_ADAPTER_KIND,
  CODEX_APP_SERVER_ARGUMENT_POLICY,
  CODEX_APP_SERVER_ARGV,
  validateCodexAppServerManifest,
} from './codex-app-server-policy';
import type { CodexAppServerSessionSnapshot } from './codex-app-server-session';

function manifest() {
  const base = deterministicLinuxAdmission().manifest;
  return validateCodexAppServerManifest({
    ...base,
    manifestId: 'codex-registration-manifest-v1',
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
}

function protocol(): CodexAppServerSessionSnapshot {
  return {
    state: 'INITIALIZED',
    threadId: null,
    turnId: null,
    terminalStatus: null,
    acceptedEvents: 0,
    acceptedBytes: 0,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function bridge(): AuthenticatedJsonlSessionContext {
  return {
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
}

function account(
  accountValue: unknown = { type: 'chatgpt', email: 'person@example.com', planType: 'plus' },
): CodexAccountReadEvidence {
  return {
    request: { method: 'account/read', id: 41, params: { refreshToken: false } },
    response: { id: 41, result: { account: accountValue, requiresOpenaiAuth: true } },
    observedAt: '2026-08-31T11:01:00.000Z',
  };
}

function candidate(
  overrides: {
    manifest?: ReturnType<typeof manifest>;
    protocol?: CodexAppServerSessionSnapshot;
    bridge?: AuthenticatedJsonlSessionContext;
    account?: CodexAccountReadEvidence;
  } = {},
) {
  return createCodexAuthenticatedRegistrationCandidate({
    manifest: overrides.manifest ?? manifest(),
    protocol: overrides.protocol ?? protocol(),
    bridge: overrides.bridge ?? bridge(),
    account: overrides.account ?? account(),
  });
}

describe('Codex authenticated registration translation', () => {
  it('joins exact adapter, initialized protocol, bridge auth, and managed account evidence', () => {
    const first = candidate();
    const second = candidate();
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
      runtimeId: 'codex.runtime-1',
      accountAuthMode: 'CHATGPT',
      registrationAuthorization: 'NOT_CONFIGURED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(first.registrationCandidateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.accountEvidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('person@example.com');
    expect(JSON.stringify(first)).not.toContain('plus');
  });

  it('accepts a declared API-key account without receiving or retaining the key', () => {
    const result = candidate({ account: account({ type: 'apiKey' }) });
    expect(result.accountAuthMode).toBe('KEY');
    expect(JSON.stringify(result)).not.toMatch(/apiKey|sk-/u);
  });

  it.each([
    null,
    { type: 'amazonBedrock', credentialSource: 'awsManaged' },
    { type: 'chatgptAuthTokens', chatgptAccountId: 'org-1' },
  ])('rejects absent, alternate-provider, and experimental account evidence', (accountValue) => {
    expect(() => candidate({ account: account(accountValue) })).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_NOT_AUTHENTICATED' }),
    );
  });

  it('rejects refresh, login, response-correlation, and evidence-window drift', () => {
    const refresh = {
      ...account(),
      request: { method: 'account/read', id: 41, params: { refreshToken: true } },
    };
    expect(() => candidate({ account: refresh })).toThrow(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );

    const login = {
      ...account(),
      request: { method: 'account/login/start', id: 41, params: { refreshToken: false } },
    };
    expect(() => candidate({ account: login })).toThrow(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );

    const mismatch = {
      ...account(),
      response: {
        id: 42,
        result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true },
      },
    };
    expect(() => candidate({ account: mismatch })).toThrow(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );

    const expired = { ...account(), observedAt: '2026-08-31T11:05:00.000Z' };
    expect(() => candidate({ account: expired })).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_EXPIRED' }),
    );
  });

  it('requires pre-thread initialized state and a Codex-scoped bridge identity', () => {
    expect(() => candidate({ protocol: { ...protocol(), state: 'THREAD_READY' } })).toThrow(
      expect.objectContaining({ code: 'PROTOCOL_NOT_READY' }),
    );
    expect(() => candidate({ bridge: { ...bridge(), runtimeId: 'hermes.runtime-1' } })).toThrow(
      expect.objectContaining({ code: 'BRIDGE_IDENTITY_MISMATCH' }),
    );
    expect(() => candidate({ protocol: { ...protocol(), acceptedEvents: 1 } })).toThrow(
      expect.objectContaining({ code: 'PROTOCOL_NOT_READY' }),
    );
    expect(() =>
      candidate({ bridge: { ...bridge(), expectedSecretDigest: 'not-a-digest' } }),
    ).toThrow(expect.objectContaining({ code: 'BRIDGE_IDENTITY_MISMATCH' }));
  });

  it('revalidates the manifest instead of trusting a structurally forged wrapper', () => {
    const valid = manifest();
    const forged = {
      ...valid,
      manifest: {
        ...valid.manifest,
        argv: ['app-server', '--listen', 'ws://127.0.0.1:4500'],
      },
    } as unknown as ReturnType<typeof manifest>;
    expect(() => candidate({ manifest: forged })).toThrow(
      expect.objectContaining({ code: 'ADAPTER_MISMATCH' }),
    );
  });

  it('changes the candidate hash when non-secret account evidence changes', () => {
    const managed = candidate();
    const apiKey = candidate({ account: account({ type: 'apiKey' }) });
    expect(apiKey.registrationCandidateHash).not.toBe(managed.registrationCandidateHash);
  });

  it('binds the candidate to the authenticated secret reference and digest without retaining either', () => {
    const first = candidate();
    const changed = candidate({
      bridge: { ...bridge(), expectedSecretDigest: 'b'.repeat(64) },
    });
    expect(first.secretBindingHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(changed.secretBindingHash).not.toBe(first.secretBindingHash);
    expect(JSON.stringify(first)).not.toContain('secret:codex-runtime-1');
    expect(JSON.stringify(first)).not.toContain('a'.repeat(64));
  });

  it('revalidates candidate hashes and exact normalized shape at the durable boundary', () => {
    const valid = candidate();
    expect(validateCodexAuthenticatedRegistrationCandidate(valid)).toEqual(valid);
    expect(() =>
      validateCodexAuthenticatedRegistrationCandidate({
        ...valid,
        accountEvidenceHash: 'f'.repeat(64),
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_EVIDENCE' }));
    expect(() =>
      validateCodexAuthenticatedRegistrationCandidate({ ...valid, rawAccount: 'forbidden' }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_EVIDENCE' }));
  });

  it('binds a short-lived external authorization to the exact candidate and idempotency key', () => {
    const request = createCodexRegistrationAuthorizationRequest(
      candidate(),
      'LOCAL_CONTROLLED',
      'c'.repeat(64),
      'register-codex-1',
    );
    const requestHash = codexRegistrationAuthorizationRequestHash(request);
    const decision = validateCodexRegistrationAuthorizationDecision(
      {
        schemaVersion: 1,
        authorizationId: 'codex-registration-authorization-1',
        requestHash,
        authorizedByReference: 'control-plane:registration-policy-v1',
        issuedAt: '2026-08-31T11:01:01.000Z',
        expiresAt: '2026-08-31T11:04:01.000Z',
      },
      requestHash,
    );
    expect(decision.requestHash).toBe(requestHash);
    expect(() =>
      validateCodexRegistrationAuthorizationDecision(
        { ...decision, requestHash: '0'.repeat(64) },
        requestHash,
      ),
    ).toThrow(expect.objectContaining({ code: 'REGISTRATION_NOT_AUTHORIZED' }));
  });

  it('keeps the production registration authorization source deny-only', async () => {
    const request = createCodexRegistrationAuthorizationRequest(
      candidate(),
      'LOCAL_CONTROLLED',
      'c'.repeat(64),
      'register-codex-1',
    );
    await expect(
      new DenyCodexRegistrationAuthorizationSource().read(request),
    ).rejects.toMatchObject({ code: 'REGISTRATION_NOT_AUTHORIZED' });
  });
});
