import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from './codec';
import { CODEX_APP_SERVER_ADAPTER_KIND } from './codex-app-server-policy';
import {
  CODEX_VALIDATION_CHALLENGE,
  codexValidationDispatchPayload,
} from './codex-validation-dispatch';
import {
  BoundedCodexValidationProtocolRunner,
  type CodexValidationProtocolTransport,
} from './codex-validation-protocol-runner';
import { BRIDGE_PROTOCOL_VERSION } from './protocol';

const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

function dispatch() {
  const base = {
    schemaVersion: 1 as const,
    adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
    workspaceId: 'workspace-1',
    runtimeId: 'codex.runtime-1',
    connectionId: 'connection-1',
    sessionId: 'session-1',
    principalReference: 'principal:codex-runtime-1',
    authGeneration: 1,
    registrationCandidateHash: '1'.repeat(64),
    capabilityCandidateHash: '2'.repeat(64),
    heartbeatCandidateHash: '3'.repeat(64),
    capabilityDigest: '4'.repeat(64),
    bridgeIdentityHash: '5'.repeat(64),
    secretBindingHash: '6'.repeat(64),
    dispatchId: 'validation-dispatch-1',
    taskId: 'validation-task-1',
    runId: 'validation-run-1',
    agentId: 'agent:codex-validator-1',
    authorityLevel: 3 as const,
    taskPolicyHash: 'a'.repeat(64),
    maximumCostMinorUnits: 0 as const,
    maximumComputeUnits: 10,
    maximumDurationMs: 15_000,
    outboundSequence: 1 as const,
    messageId: 'validation-dispatch-1',
    challengeCode: CODEX_VALIDATION_CHALLENGE,
    issuedAt: '2026-08-31T11:03:15.000Z',
    expiresAt: '2026-08-31T11:03:30.000Z',
    assignmentState: 'NOT_CONFIGURED' as const,
    deliveryState: 'NOT_SENT' as const,
    providerAccess: 'NOT_CONFIGURED' as const,
    runtimeConnection: 'NOT_CONFIGURED' as const,
  };
  const payloadDigest = sha256(codexValidationDispatchPayload(base));
  const unsignedEnvelopeDigest = sha256({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    workspaceId: base.workspaceId,
    runtimeId: base.runtimeId,
    connectionId: base.connectionId,
    sessionId: base.sessionId,
    principalReference: base.principalReference,
    sequence: 1,
    messageId: base.messageId,
    type: 'DISPATCH',
    issuedAt: base.issuedAt,
    expiresAt: base.expiresAt,
    payloadDigest,
    payload: codexValidationDispatchPayload(base),
  });
  const normalized = { ...base, payloadDigest, unsignedEnvelopeDigest };
  return { ...normalized, validationDispatchCandidateHash: sha256(normalized) };
}

class FixtureTransport implements CodexValidationProtocolTransport {
  readonly writes: unknown[] = [];

  constructor(private readonly messages: Readonly<Record<string, unknown>>[]) {}

  async write(message: unknown): Promise<void> {
    this.writes.push(message);
  }

  async read(): Promise<Readonly<Record<string, unknown>>> {
    const message = this.messages.shift();
    if (!message) throw new Error('fixture exhausted');
    return message;
  }
}

function messages(
  finalText = 'ventureos-validation:validation-dispatch-1',
): Array<Record<string, unknown>> {
  return [
    {
      id: 1,
      result: {
        userAgent: 'codex-cli/1',
        codexHome: '/tmp/codex-home',
        platformFamily: 'unix',
        platformOs: 'linux',
      },
    },
    {
      id: 2,
      result: {
        thread: {
          id: 'thr_123',
          sessionId: 'session_123',
          forkedFromId: null,
          parentThreadId: null,
          preview: '',
          ephemeral: true,
          section: null,
          sectionEnteredAt: null,
          projectId: null,
          historyMode: 'legacy',
          modelProvider: 'openai',
          createdAt: 1,
          updatedAt: 1,
          recencyAt: 1,
          status: { type: 'idle' },
          path: null,
          cwd: '/tmp/workspace',
          cliVersion: '1.0.0',
          source: 'appServer',
          threadSource: null,
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: [],
        },
        model: 'model-1',
        modelProvider: 'openai',
        serviceTier: null,
        cwd: '/tmp/workspace',
        instructionSources: [],
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: { type: 'readOnly', networkAccess: false },
        reasoningEffort: 'low',
      },
    },
    {
      id: 3,
      result: { turn: { id: 'turn_456', status: 'inProgress', items: [], error: null } },
    },
    {
      method: 'turn/started',
      params: {
        threadId: 'thr_123',
        turn: { id: 'turn_456', status: 'inProgress', items: [], error: null },
      },
    },
    {
      method: 'item/completed',
      params: {
        threadId: 'thr_123',
        turnId: 'turn_456',
        item: { type: 'agentMessage', id: 'item-1', text: finalText },
      },
    },
    {
      method: 'turn/completed',
      params: {
        threadId: 'thr_123',
        turn: {
          id: 'turn_456',
          status: 'completed',
          items: [{ type: 'agentMessage', id: 'item-1', text: finalText }],
          error: null,
        },
      },
    },
  ];
}

describe('BoundedCodexValidationProtocolRunner', () => {
  it('uses an ephemeral read-only session and proves the dispatch-bound terminal token', async () => {
    const transport = new FixtureTransport(messages());
    const evidence = await new BoundedCodexValidationProtocolRunner(
      transport,
      () => new Date('2026-08-31T11:03:16.000Z'),
    ).run(dispatch());

    expect(evidence).toMatchObject({
      threadId: 'thr_123',
      turnId: 'turn_456',
      status: 'completed',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(transport.writes[2]).toMatchObject({
      method: 'thread/start',
      params: { approvalPolicy: 'never', ephemeral: true, sandbox: 'read-only' },
    });
    expect(transport.writes[3]).toMatchObject({
      method: 'turn/start',
      params: {
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      },
    });
    expect(JSON.stringify(transport.writes[3])).toContain(
      'ventureos-validation:validation-dispatch-1',
    );
  });

  it('rejects arbitrary terminal output', async () => {
    await expect(
      new BoundedCodexValidationProtocolRunner(
        new FixtureTransport(messages('not-the-token')),
        () => new Date('2026-08-31T11:03:16.000Z'),
      ).run(dispatch()),
    ).rejects.toMatchObject({ code: 'RESULT_MISMATCH' });

    const failed = messages();
    const failedParams = failed[5]!.params as Record<string, unknown>;
    (failedParams.turn as Record<string, unknown>).status = 'failed';
    await expect(
      new BoundedCodexValidationProtocolRunner(
        new FixtureTransport(failed),
        () => new Date('2026-08-31T11:03:16.000Z'),
      ).run(dispatch()),
    ).rejects.toMatchObject({ code: 'RESULT_MISMATCH' });
  });

  it('rejects observed tool activity', async () => {
    const unsafe = messages();
    unsafe[3] = {
      method: 'item/started',
      params: {
        threadId: 'thr_123',
        turnId: 'turn_456',
        item: { type: 'commandExecution', id: 'item-unsafe', text: '' },
      },
    };
    await expect(
      new BoundedCodexValidationProtocolRunner(
        new FixtureTransport(unsafe),
        () => new Date('2026-08-31T11:03:16.000Z'),
      ).run(dispatch()),
    ).rejects.toMatchObject({ code: 'UNSAFE_ACTIVITY' });

    const approval = messages();
    approval[3] = {
      id: 40,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thr_123', turnId: 'turn_456', itemId: 'item-unsafe' },
    };
    await expect(
      new BoundedCodexValidationProtocolRunner(
        new FixtureTransport(approval),
        () => new Date('2026-08-31T11:03:16.000Z'),
      ).run(dispatch()),
    ).rejects.toMatchObject({ code: 'UNSAFE_ACTIVITY' });
  });

  it('rejects unsafe terminal items and cross-turn progress', async () => {
    const unsafeTerminal = messages();
    const terminal = unsafeTerminal[5]!;
    const params = terminal.params as Record<string, unknown>;
    const turn = params.turn as Record<string, unknown>;
    turn.items = [
      ...(turn.items as unknown[]),
      { type: 'commandExecution', id: 'item-unsafe', command: 'whoami' },
    ];
    await expect(
      new BoundedCodexValidationProtocolRunner(
        new FixtureTransport(unsafeTerminal),
        () => new Date('2026-08-31T11:03:16.000Z'),
      ).run(dispatch()),
    ).rejects.toMatchObject({ code: 'UNSAFE_ACTIVITY' });

    const drift = messages();
    (drift[3]!.params as Record<string, unknown>).threadId = 'thr_foreign';
    await expect(
      new BoundedCodexValidationProtocolRunner(
        new FixtureTransport(drift),
        () => new Date('2026-08-31T11:03:16.000Z'),
      ).run(dispatch()),
    ).rejects.toMatchObject({ code: 'CORRELATION_MISMATCH' });
  });

  it('cannot outlive the durable dispatch budget', async () => {
    await expect(
      new BoundedCodexValidationProtocolRunner(
        new FixtureTransport(messages()),
        () => new Date('2026-08-31T11:03:16.000Z'),
      ).run(dispatch(), { timeoutMs: 15_000 }),
    ).rejects.toMatchObject({ code: 'INVALID_TIMEOUT' });
  });

  it('does not run validation against a legacy response that cannot attest restrictions', async () => {
    const legacy = messages();
    legacy[1] = { id: 2, result: { thread: { id: 'thr_123' } } };
    await expect(
      new BoundedCodexValidationProtocolRunner(
        new FixtureTransport(legacy),
        () => new Date('2026-08-31T11:03:16.000Z'),
      ).run(dispatch()),
    ).rejects.toMatchObject({ code: 'UNSAFE_ACTIVITY' });
  });
});
