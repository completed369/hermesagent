import { TextDecoder } from 'node:util';
import type { Readable, Writable } from 'node:stream';

import { canonicalJson } from './codec';

export const MAX_CODEX_STDIO_LINE_BYTES = 65_536;
export const MAX_CODEX_STDIO_BUFFER_BYTES = 131_072;
export const MAX_CODEX_STDIO_SESSION_BYTES = 8 * 1_024 * 1_024;
export const MAX_CODEX_STDIO_OPERATION_TIMEOUT_MS = 5_000;

export type CodexAppServerStdioTransportErrorCode =
  | 'INVALID_STREAM'
  | 'INVALID_MESSAGE'
  | 'LIMIT_EXCEEDED'
  | 'CONCURRENT_OPERATION'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'STREAM_ERROR'
  | 'STREAM_CLOSED'
  | 'TERMINAL';

export class CodexAppServerStdioTransportError extends Error {
  constructor(readonly code: CodexAppServerStdioTransportErrorCode) {
    super(`Codex app-server stdio transport denied: ${code}`);
  }
}

export interface CodexAppServerStdioTransportOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CodexAppServerStdioTransportSnapshot {
  readonly state: 'ACTIVE' | 'FAILED';
  readonly bufferedBytes: number;
  readonly writtenBytes: number;
  readonly readBytes: number;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

function timeout(options: Readonly<CodexAppServerStdioTransportOptions>): number {
  const value = options.timeoutMs ?? MAX_CODEX_STDIO_OPERATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CODEX_STDIO_OPERATION_TIMEOUT_MS)
    throw new CodexAppServerStdioTransportError('LIMIT_EXCEEDED');
  return value;
}

function objectMessage(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CodexAppServerStdioTransportError('INVALID_MESSAGE');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new CodexAppServerStdioTransportError('INVALID_MESSAGE');
  return value as Record<string, unknown>;
}

function encode(value: unknown): Buffer {
  objectMessage(value);
  let line: Buffer;
  try {
    line = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
  } catch {
    throw new CodexAppServerStdioTransportError('INVALID_MESSAGE');
  }
  if (line.byteLength > MAX_CODEX_STDIO_LINE_BYTES)
    throw new CodexAppServerStdioTransportError('LIMIT_EXCEEDED');
  return line;
}

function decode(line: Buffer): Readonly<Record<string, unknown>> {
  if (
    line.byteLength < 3 ||
    line.byteLength > MAX_CODEX_STDIO_LINE_BYTES ||
    line[line.byteLength - 1] !== 10
  )
    throw new CodexAppServerStdioTransportError('INVALID_MESSAGE');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(line.subarray(0, -1));
  } catch {
    throw new CodexAppServerStdioTransportError('INVALID_MESSAGE');
  }
  if (text.includes('\r') || text.includes('\n'))
    throw new CodexAppServerStdioTransportError('INVALID_MESSAGE');
  try {
    return Object.freeze(objectMessage(JSON.parse(text)));
  } catch (error) {
    if (error instanceof CodexAppServerStdioTransportError) throw error;
    throw new CodexAppServerStdioTransportError('INVALID_MESSAGE');
  }
}

/**
 * Owns bounded JSONL reads and writes over already-open Codex app-server stdio.
 * It never starts a process, discovers credentials, or grants runtime truth.
 */
export class BoundedCodexAppServerStdioTransport {
  #state: 'ACTIVE' | 'FAILED' = 'ACTIVE';
  #buffer = Buffer.alloc(0);
  #writing = false;
  #reading = false;
  #writtenBytes = 0;
  #readBytes = 0;

  constructor(
    private readonly stdin: Writable,
    private readonly stdout: Readable,
  ) {
    if (
      !stdin ||
      typeof stdin.write !== 'function' ||
      typeof stdin.destroy !== 'function' ||
      !stdout ||
      typeof stdout.on !== 'function' ||
      typeof stdout.destroy !== 'function' ||
      stdout.readableEncoding !== null
    )
      throw new CodexAppServerStdioTransportError('INVALID_STREAM');
    const terminate = () => this.#markFailed();
    this.stdin.on('error', terminate);
    this.stdin.on('close', terminate);
    this.stdout.on('error', terminate);
    this.stdout.on('close', terminate);
    this.stdout.on('end', terminate);
  }

  snapshot(): Readonly<CodexAppServerStdioTransportSnapshot> {
    return Object.freeze({
      state: this.#state,
      bufferedBytes: this.#buffer.byteLength,
      writtenBytes: this.#writtenBytes,
      readBytes: this.#readBytes,
      runtimeConnection: 'NOT_CONFIGURED',
    });
  }

  async write(
    message: unknown,
    options: Readonly<CodexAppServerStdioTransportOptions> = {},
  ): Promise<void> {
    this.#active();
    if (this.#writing) return this.#deny('CONCURRENT_OPERATION');
    let timeoutMs: number;
    let line: Buffer;
    try {
      timeoutMs = timeout(options);
      if (options.signal?.aborted) throw new CodexAppServerStdioTransportError('CANCELLED');
      line = encode(message);
    } catch (error) {
      return this.#deny(this.#code(error));
    }
    if (this.#writtenBytes + line.byteLength > MAX_CODEX_STDIO_SESSION_BYTES) {
      line.fill(0);
      return this.#deny('LIMIT_EXCEEDED');
    }
    this.#writing = true;
    try {
      await this.#bounded<void>(timeoutMs, options.signal, (resolve, reject) => {
        this.stdin.write(line, (error?: Error | null) => {
          if (error) reject(new CodexAppServerStdioTransportError('STREAM_ERROR'));
          else resolve();
        });
      });
      this.#writtenBytes += line.byteLength;
    } catch (error) {
      return this.#deny(this.#code(error));
    } finally {
      this.#writing = false;
      line.fill(0);
    }
  }

  async read(
    options: Readonly<CodexAppServerStdioTransportOptions> = {},
  ): Promise<Readonly<Record<string, unknown>>> {
    this.#active();
    if (this.#reading) return this.#deny('CONCURRENT_OPERATION');
    let timeoutMs: number;
    try {
      timeoutMs = timeout(options);
      if (options.signal?.aborted) throw new CodexAppServerStdioTransportError('CANCELLED');
      const buffered = this.#takeLine();
      if (buffered) {
        try {
          return decode(buffered);
        } finally {
          buffered.fill(0);
        }
      }
    } catch (error) {
      return this.#deny(this.#code(error));
    }
    this.#reading = true;
    try {
      const line = await this.#bounded<Buffer>(timeoutMs, options.signal, (resolve, reject) => {
        const cleanup = () => {
          this.stdout.off('data', onData);
          this.stdout.off('error', onError);
          this.stdout.off('end', onClosed);
          this.stdout.off('close', onClosed);
        };
        const onData = (chunk: unknown) => {
          try {
            if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0)
              throw new CodexAppServerStdioTransportError('INVALID_MESSAGE');
            const owned = Buffer.from(chunk);
            if (this.#readBytes + owned.byteLength > MAX_CODEX_STDIO_SESSION_BYTES)
              throw new CodexAppServerStdioTransportError('LIMIT_EXCEEDED');
            this.#readBytes += owned.byteLength;
            this.#buffer = Buffer.concat([this.#buffer, owned]);
            owned.fill(0);
            if (this.#buffer.byteLength > MAX_CODEX_STDIO_BUFFER_BYTES)
              throw new CodexAppServerStdioTransportError('LIMIT_EXCEEDED');
            const candidate = this.#takeLine();
            if (candidate) {
              cleanup();
              resolve(candidate);
            } else if (this.#buffer.byteLength >= MAX_CODEX_STDIO_LINE_BYTES) {
              throw new CodexAppServerStdioTransportError('LIMIT_EXCEEDED');
            }
          } catch (error) {
            cleanup();
            reject(error);
          }
        };
        const onError = () => {
          cleanup();
          reject(new CodexAppServerStdioTransportError('STREAM_ERROR'));
        };
        const onClosed = () => {
          cleanup();
          reject(new CodexAppServerStdioTransportError('STREAM_CLOSED'));
        };
        this.stdout.on('data', onData);
        this.stdout.once('error', onError);
        this.stdout.once('end', onClosed);
        this.stdout.once('close', onClosed);
      });
      try {
        return decode(line);
      } finally {
        line.fill(0);
      }
    } catch (error) {
      return this.#deny(this.#code(error));
    } finally {
      this.#reading = false;
    }
  }

  #takeLine(): Buffer | undefined {
    const newline = this.#buffer.indexOf(10);
    if (newline < 0) return undefined;
    if (newline + 1 > MAX_CODEX_STDIO_LINE_BYTES)
      throw new CodexAppServerStdioTransportError('LIMIT_EXCEEDED');
    const line = Buffer.from(this.#buffer.subarray(0, newline + 1));
    const remainder = Buffer.from(this.#buffer.subarray(newline + 1));
    this.#buffer.fill(0);
    this.#buffer = remainder;
    return line;
  }

  #bounded<T>(
    timeoutMs: number,
    signal: AbortSignal | undefined,
    begin: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: unknown) => void,
    ) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        operation();
      };
      const onAbort = () =>
        finish(() => reject(new CodexAppServerStdioTransportError('CANCELLED')));
      const timer = setTimeout(
        () => finish(() => reject(new CodexAppServerStdioTransportError('TIMEOUT'))),
        timeoutMs,
      );
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        begin(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error)),
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  #active(): void {
    if (this.#state !== 'ACTIVE') throw new CodexAppServerStdioTransportError('TERMINAL');
    if (this.stdin.destroyed || this.stdout.destroyed) this.#deny('STREAM_CLOSED');
  }

  #code(error: unknown): CodexAppServerStdioTransportErrorCode {
    return error instanceof CodexAppServerStdioTransportError ? error.code : 'STREAM_ERROR';
  }

  #deny(code: CodexAppServerStdioTransportErrorCode): never {
    this.#markFailed();
    throw new CodexAppServerStdioTransportError(code);
  }

  #markFailed(): void {
    this.#state = 'FAILED';
    this.#buffer.fill(0);
    this.#buffer = Buffer.alloc(0);
    if (!this.stdin.destroyed) this.stdin.destroy();
    if (!this.stdout.destroyed) this.stdout.destroy();
  }
}
