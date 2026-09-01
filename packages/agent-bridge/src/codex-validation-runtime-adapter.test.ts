import { describe, expect, it } from 'vitest';

import {
  deriveBridgeKeys,
  digestBridgePayload,
  signBridgeEnvelope,
  verifyBridgeEnvelope,
} from './auth';
import { deterministicLinuxAdmission } from './__tests__/fixtures/deterministic-supervision';
import type { AuthenticatedJsonlSessionContext } from './authenticated-jsonl-session';
import { decodeBridgeLine } from './codec';
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
  codexValidationDispatchUnsignedEnvelope,
  createCodexValidationDispatchCandidate,
} from './codex-validation-dispatch';
import {
  BoundedCodexValidationRuntimeAdapter,
  CodexValidationRuntimeAdapterError,
  type CodexValidationRuntimeProtocolRunner,
} from './codex-validation-runtime-adapter';
import type { BridgeEgressTransport, BridgeEgressTransportRequest } from './egress-controller';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope } from './protocol';
import { ScopedBridgeSecretLeaseResolver } from './secret-lease';

const secret = new Uint8Array(32).fill(9);
const secretDigest = '8c0cc17a04942cc4f8e0fe0b302606d3108860c126428ba2ceeb5f9ed41c2b05';
const now = '2026-08-31T11:03:20.000Z';

function fixture(maximumDurationMs = 30_000, dispatchId = 'validation-dispatch-1') {
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
      manifestId: 'codex-runtime-adapter-manifest-v1',
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
  const keys = deriveBridgeKeys(secret, bridge);
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
      keys.runtimeToParent,
    ),
  });
  const dispatch = createCodexValidationDispatchCandidate({
    heartbeat,
    dispatchId,
    taskId: 'validation-task-1',
    runId: 'validation-run-1',
    agentId: 'agent:codex-validator-1',
    authorityLevel: 3,
    taskPolicyHash: 'a'.repeat(64),
    maximumCostMinorUnits: 0,
    maximumComputeUnits: 10,
    maximumDurationMs,
    issuedAt: '2026-08-31T11:03:15.000Z',
    expiresAt: '2026-08-31T11:03:45.000Z',
  });
  const dispatchEnvelope = signBridgeEnvelope(
    codexValidationDispatchUnsignedEnvelope(dispatch),
    keys.parentToRuntime,
  );
  keys.parentToRuntime.fill(0);
  keys.runtimeToParent.fill(0);
  return { bridge, dispatch, dispatchEnvelope };
}

class FixedRunner implements CodexValidationRuntimeProtocolRunner {
  calls = 0;

  async run() {
    this.calls += 1;
    return {
      threadId: 'thread-1',
      turnId: 'turn-1',
      status: 'completed' as const,
      messageHash: 'b'.repeat(64),
      runtimeConnection: 'NOT_CONFIGURED' as const,
    };
  }
}

class RecordingTransport implements BridgeEgressTransport {
  readonly frames: BridgeEnvelope[] = [];
  mutate = false;
  fail = false;

  async write(request: Readonly<BridgeEgressTransportRequest>): Promise<void> {
    this.frames.push(decodeBridgeLine(Uint8Array.from(request.line)));
    if (this.mutate) request.line[0] = (request.line[0] ?? 0) ^ 1;
    if (this.fail) throw new Error('transport failed');
  }
}

function resolver(material = secret) {
  return new ScopedBridgeSecretLeaseResolver({
    async resolve() {
      return material;
    },
  });
}

function adapter(
  runner: CodexValidationRuntimeProtocolRunner = new FixedRunner(),
  transport = new RecordingTransport(),
  clock: () => Date = () => new Date(now),
) {
  return {
    runner,
    transport,
    subject: new BoundedCodexValidationRuntimeAdapter(runner, resolver(), transport, clock),
  };
}

describe('bounded Codex validation runtime adapter', () => {
  it('authenticates the dispatch, emits signed status/result, and preserves runtime truth', async () => {
    const input = fixture();
    const runner = new FixedRunner();
    const { subject, transport } = adapter(runner);
    const result = await subject.execute(input);

    expect(runner.calls).toBe(1);
    expect(transport.frames.map((frame) => [frame.sequence, frame.type])).toEqual([
      [2, 'DISPATCH_ACCEPTED'],
      [3, 'RESULT'],
    ]);
    expect(result).toMatchObject({
      dispatchId: input.dispatch.dispatchId,
      statusSequence: 2,
      terminalSequence: 3,
      providerAccess: 'NOT_CONFIGURED',
      runtimeConnection: 'NOT_CONFIGURED',
      connectionTransition: 'NOT_APPLIED',
    });
    const keys = deriveBridgeKeys(secret, input.bridge);
    expect(() =>
      transport.frames.forEach((frame) =>
        verifyBridgeEnvelope(frame, keys.runtimeToParent, input.bridge, new Date(now)),
      ),
    ).not.toThrow();
    keys.parentToRuntime.fill(0);
    keys.runtimeToParent.fill(0);
  });

  it('fails closed with deny defaults before running the protocol', async () => {
    const runner = new FixedRunner();
    await expect(
      new BoundedCodexValidationRuntimeAdapter(
        runner,
        undefined,
        undefined,
        () => new Date(now),
      ).execute(fixture()),
    ).rejects.toMatchObject({ code: 'SECRET_LEASE_DENIED' });
    expect(runner.calls).toBe(0);
  });

  it('rejects a tampered or wrongly authenticated dispatch before running', async () => {
    for (const input of [
      (() => {
        const value = fixture();
        return { ...value, dispatchEnvelope: { ...value.dispatchEnvelope, taskId: 'other' } };
      })(),
      (() => {
        const value = fixture();
        return { ...value, dispatchEnvelope: { ...value.dispatchEnvelope, mac: 'a'.repeat(43) } };
      })(),
    ]) {
      const runner = new FixedRunner();
      const { subject } = adapter(runner);
      await expect(subject.execute(input as never)).rejects.toBeInstanceOf(
        CodexValidationRuntimeAdapterError,
      );
      expect(runner.calls).toBe(0);
    }
  });

  it('rejects deeply nested frame input before canonicalization or protocol execution', async () => {
    const input = fixture();
    let payload: unknown = 'leaf';
    for (let depth = 0; depth < 10; depth += 1) payload = { nested: payload };
    const runner = new FixedRunner();
    const { subject } = adapter(runner);
    await expect(
      subject.execute({
        ...input,
        dispatchEnvelope: { ...input.dispatchEnvelope, payload } as never,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(runner.calls).toBe(0);
  });

  it('rejects replay and concurrent use of the same dispatch', async () => {
    const input = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner: CodexValidationRuntimeProtocolRunner = {
      async run() {
        await waiting;
        return new FixedRunner().run();
      },
    };
    const { subject } = adapter(runner);
    const first = subject.execute(input);
    await Promise.resolve();
    await expect(subject.execute(input)).rejects.toMatchObject({ code: 'CONCURRENT_DISPATCH' });
    release();
    await first;
    await expect(subject.execute(input)).rejects.toMatchObject({ code: 'USED_DISPATCH' });
  });

  it('emits nothing when the protocol fails or authority expires before signing', async () => {
    const input = fixture();
    const transport = new RecordingTransport();
    const failing: CodexValidationRuntimeProtocolRunner = {
      async run() {
        throw new Error('unsafe protocol activity');
      },
    };
    await expect(adapter(failing, transport).subject.execute(input)).rejects.toThrow(
      'unsafe protocol activity',
    );
    expect(transport.frames).toHaveLength(0);

    const malformed: CodexValidationRuntimeProtocolRunner = {
      async run() {
        return { ...(await new FixedRunner().run()), hidden: 'unreviewed' };
      },
    };
    const malformedTransport = new RecordingTransport();
    await expect(
      adapter(malformed, malformedTransport).subject.execute(input),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(malformedTransport.frames).toHaveLength(0);

    let current = new Date(now);
    const expiring: CodexValidationRuntimeProtocolRunner = {
      async run() {
        current = new Date(input.dispatch.expiresAt);
        return new FixedRunner().run();
      },
    };
    const expiredTransport = new RecordingTransport();
    await expect(
      adapter(expiring, expiredTransport, () => current).subject.execute(input),
    ).rejects.toMatchObject({ code: 'AUTHORITY_EXPIRED' });
    expect(expiredTransport.frames).toHaveLength(0);

    const shortInput = fixture(1_000);
    current = new Date(now);
    const overBudget: CodexValidationRuntimeProtocolRunner = {
      async run() {
        current = new Date(Date.parse(now) + 1_000);
        return new FixedRunner().run();
      },
    };
    await expect(
      adapter(overBudget, new RecordingTransport(), () => current).subject.execute(shortInput),
    ).rejects.toMatchObject({ code: 'AUTHORITY_EXPIRED' });
  });

  it('uses bounded response identifiers for a maximum-length dispatch reference', async () => {
    const input = fixture(30_000, `d${'x'.repeat(255)}`);
    const { subject, transport } = adapter();
    await subject.execute(input);
    expect(transport.frames).toHaveLength(2);
    expect(transport.frames.every((frame) => frame.messageId.length < 64)).toBe(true);
  });

  it('detects transport failure and mutation without returning admitted evidence', async () => {
    for (const mode of ['fail', 'mutate'] as const) {
      const transport = new RecordingTransport();
      transport[mode] = true;
      await expect(
        adapter(new FixedRunner(), transport).subject.execute(fixture()),
      ).rejects.toMatchObject({
        code: mode === 'fail' ? 'TRANSPORT_DENIED' : 'TRANSPORT_MUTATED_FRAME',
      });
    }
  });
});
