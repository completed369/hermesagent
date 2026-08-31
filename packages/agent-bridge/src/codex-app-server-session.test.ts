import { describe, expect, it } from 'vitest';

import {
  CodexAppServerProtocolSession,
  MAX_CODEX_TASK_TEXT_BYTES,
} from './codex-app-server-session';

function initialize(session: CodexAppServerProtocolSession): void {
  const request = session.initialize();
  expect(request).toEqual({
    method: 'initialize',
    id: 1,
    params: { clientInfo: { name: 'ventureos', title: 'VentureOS', version: '1.0.0' } },
  });
  session.acceptInitializeResponse({
    id: 1,
    result: { userAgent: 'codex-cli/1', platformFamily: 'unix', platformOs: 'linux' },
  });
  expect(session.initialized()).toEqual({ method: 'initialized', params: {} });
}

function startThread(session: CodexAppServerProtocolSession): void {
  expect(session.startThread()).toEqual({ method: 'thread/start', id: 2, params: {} });
  session.acceptThreadResponse({ id: 2, result: { thread: { id: 'thr_123' } } });
}

function startTurn(session: CodexAppServerProtocolSession, text = 'Run the approved task'): void {
  expect(session.startTurn(text)).toEqual({
    method: 'turn/start',
    id: 3,
    params: { threadId: 'thr_123', input: [{ type: 'text', text }] },
  });
  session.acceptTurnResponse({
    id: 3,
    result: { turn: { id: 'turn_456', status: 'inProgress', items: [], error: null } },
  });
}

describe('Codex app-server protocol session', () => {
  it('models one exact bounded lifecycle without promoting runtime truth', () => {
    const session = new CodexAppServerProtocolSession();
    initialize(session);
    startThread(session);
    startTurn(session);

    const evidence = session.acceptTurnCompleted({
      method: 'turn/completed',
      params: {
        threadId: 'thr_123',
        turn: { id: 'turn_456', status: 'completed', items: [], error: null },
      },
    });

    expect(evidence).toEqual({
      threadId: 'thr_123',
      turnId: 'turn_456',
      status: 'completed',
      messageHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(session.snapshot()).toMatchObject({
      state: 'TURN_TERMINAL',
      terminalStatus: 'completed',
      acceptedEvents: 1,
      runtimeConnection: 'NOT_CONFIGURED',
    });
  });

  it('constructs a correlated interrupt but waits for terminal evidence', () => {
    const session = new CodexAppServerProtocolSession();
    initialize(session);
    startThread(session);
    startTurn(session);

    expect(session.interrupt()).toEqual({
      method: 'turn/interrupt',
      id: 4,
      params: { threadId: 'thr_123', turnId: 'turn_456' },
    });
    session.acceptInterruptResponse({ id: 4, result: {} });
    expect(session.snapshot().state).toBe('INTERRUPT_ACKNOWLEDGED');
    expect(session.snapshot().terminalStatus).toBeNull();
    expect(() => session.interrupt()).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('fails closed on pre-handshake use, repeated initialize, and correlation drift', () => {
    const preHandshake = new CodexAppServerProtocolSession();
    expect(() => preHandshake.startThread()).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE' }),
    );
    expect(preHandshake.snapshot().state).toBe('FAILED');

    const repeated = new CodexAppServerProtocolSession();
    repeated.initialize();
    expect(() => repeated.initialize()).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));

    const correlation = new CodexAppServerProtocolSession();
    correlation.initialize();
    expect(() =>
      correlation.acceptInitializeResponse({
        id: 2,
        result: { userAgent: 'codex-cli/1', platformFamily: 'unix', platformOs: 'linux' },
      }),
    ).toThrow(expect.objectContaining({ code: 'CORRELATION_MISMATCH' }));
    expect(correlation.snapshot().state).toBe('FAILED');
  });

  it('rejects remote errors, unreviewed response fields, and oversized task input', () => {
    const remoteError = new CodexAppServerProtocolSession();
    remoteError.initialize();
    expect(() => remoteError.acceptInitializeResponse({ id: 1, error: { code: -1 } })).toThrow(
      expect.objectContaining({ code: 'REMOTE_ERROR' }),
    );

    const extraField = new CodexAppServerProtocolSession();
    extraField.initialize();
    expect(() =>
      extraField.acceptInitializeResponse({
        id: 1,
        result: {
          userAgent: 'codex-cli/1',
          platformFamily: 'unix',
          platformOs: 'linux',
          experimental: true,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_MESSAGE' }));

    const oversized = new CodexAppServerProtocolSession();
    initialize(oversized);
    startThread(oversized);
    expect(() => oversized.startTurn('x'.repeat(MAX_CODEX_TASK_TEXT_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    expect(oversized.snapshot().state).toBe('FAILED');
  });

  it('does not retain task text or terminal item content in its snapshot', () => {
    const session = new CodexAppServerProtocolSession();
    initialize(session);
    startThread(session);
    startTurn(session, 'private approved task text');
    const before = JSON.stringify(session.snapshot());
    expect(before).not.toContain('private approved task text');

    session.acceptTurnCompleted({
      method: 'turn/completed',
      params: {
        threadId: 'thr_123',
        turn: {
          id: 'turn_456',
          status: 'completed',
          items: [{ type: 'agentMessage', text: 'private output' }],
          error: null,
        },
      },
    });
    expect(JSON.stringify(session.snapshot())).not.toContain('private output');
  });

  it('rejects deeply nested terminal events before canonical hashing', () => {
    const session = new CodexAppServerProtocolSession();
    initialize(session);
    startThread(session);
    startTurn(session);
    let nested: unknown = 'leaf';
    for (let index = 0; index < 10; index += 1) nested = { nested };
    expect(() =>
      session.acceptTurnCompleted({
        method: 'turn/completed',
        params: {
          threadId: 'thr_123',
          turn: { id: 'turn_456', status: 'completed', items: [nested], error: null },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });
});
