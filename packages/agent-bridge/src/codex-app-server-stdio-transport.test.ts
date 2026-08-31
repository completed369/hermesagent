import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  BoundedCodexAppServerStdioTransport,
  CodexAppServerStdioTransportError,
  MAX_CODEX_STDIO_BUFFER_BYTES,
  MAX_CODEX_STDIO_LINE_BYTES,
} from './codex-app-server-stdio-transport';

function fixture() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const transport = new BoundedCodexAppServerStdioTransport(stdin, stdout);
  return { stdin, stdout, transport };
}

describe('BoundedCodexAppServerStdioTransport', () => {
  it('writes one canonical JSONL message and retains only local byte facts', async () => {
    const { stdin, transport } = fixture();
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

    await transport.write({ params: {}, method: 'initialized' });

    expect(Buffer.concat(chunks).toString('utf8')).toBe('{"method":"initialized","params":{}}\n');
    expect(transport.snapshot()).toEqual({
      state: 'ACTIVE',
      bufferedBytes: 0,
      writtenBytes: 37,
      readBytes: 0,
      runtimeConnection: 'NOT_CONFIGURED',
    });
  });

  it('admits fragmented and coalesced JSONL without losing the next line', async () => {
    const { stdout, transport } = fixture();
    const first = transport.read();
    stdout.write(Buffer.from('{"id":1,"res'));
    stdout.write(Buffer.from('ult":{}}\n{"method":"turn/completed","params":{}}\n'));

    await expect(first).resolves.toEqual({ id: 1, result: {} });
    await expect(transport.read()).resolves.toEqual({
      method: 'turn/completed',
      params: {},
    });
    expect(transport.snapshot()).toMatchObject({ state: 'ACTIVE', bufferedBytes: 0 });
  });

  it.each([
    ['invalid JSON', Buffer.from('{nope}\n'), 'INVALID_MESSAGE'],
    ['scalar JSON', Buffer.from('true\n'), 'INVALID_MESSAGE'],
    [
      'invalid UTF-8',
      Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d, 0x0a]),
      'INVALID_MESSAGE',
    ],
    [
      'oversized line',
      Buffer.concat([Buffer.from('{"x":"'), Buffer.alloc(MAX_CODEX_STDIO_LINE_BYTES, 97)]),
      'LIMIT_EXCEEDED',
    ],
    ['oversized chunk', Buffer.alloc(MAX_CODEX_STDIO_BUFFER_BYTES + 1, 97), 'LIMIT_EXCEEDED'],
  ])('fails closed for %s', async (_name, input, code) => {
    const { stdout, transport } = fixture();
    const pending = transport.read();
    stdout.write(input);

    await expect(pending).rejects.toMatchObject({ code });
    expect(transport.snapshot()).toMatchObject({ state: 'FAILED', bufferedBytes: 0 });
    await expect(transport.read()).rejects.toMatchObject({ code: 'TERMINAL' });
  });

  it('fails closed on timeout and cancellation', async () => {
    const timed = fixture();
    await expect(timed.transport.read({ timeoutMs: 5 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(timed.stdout.destroyed).toBe(true);

    const cancelled = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      cancelled.transport.write({ id: 1 }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelled.stdin.destroyed).toBe(true);
  });

  it('fails the session before writing invalid or oversized messages', async () => {
    const invalid = fixture();
    await expect(invalid.transport.write(['not', 'an', 'object'])).rejects.toMatchObject({
      code: 'INVALID_MESSAGE',
    });
    expect(invalid.transport.snapshot().state).toBe('FAILED');

    const oversized = fixture();
    const oversizedObject = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`field${index}`, 'x'.repeat(2_048)]),
    );
    await expect(oversized.transport.write(oversizedObject)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    expect(oversized.transport.snapshot().state).toBe('FAILED');
  });

  it('rejects concurrent reads and destroys the ambiguous session', async () => {
    const { transport } = fixture();
    const first = transport.read();
    const second = transport.read();

    const [firstResult, secondResult] = await Promise.allSettled([first, second]);
    expect(firstResult.status).toBe('rejected');
    expect(secondResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'CONCURRENT_OPERATION' }),
    });
    expect(transport.snapshot().state).toBe('FAILED');
  });

  it('fails closed when the writable boundary rejects the write', async () => {
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('fixture rejection'));
      },
    });
    const stdout = new PassThrough();
    const transport = new BoundedCodexAppServerStdioTransport(stdin, stdout);

    await expect(
      transport.write({ id: 1, method: 'initialize', params: {} }),
    ).rejects.toBeInstanceOf(CodexAppServerStdioTransportError);
    expect(transport.snapshot().state).toBe('FAILED');
  });
});
