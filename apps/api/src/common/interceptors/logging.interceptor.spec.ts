import { describe, expect, it, vi } from 'vitest';
import { HttpException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { StructuredLogger } from '@ventureos/observability';
import { LoggingInterceptor } from './logging.interceptor.js';

function context(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        path: '/api/auth/login',
        originalUrl: '/api/auth/login?token=must-not-be-logged',
        correlationId: 'test-correlation-id',
      }),
      getResponse: () => ({ statusCode: 401 }),
    }),
  } as ExecutionContext;
}

describe('LoggingInterceptor', () => {
  it.each([401, 429])('logs controlled client status %i as a warning', async (status) => {
    const warn = vi.spyOn(StructuredLogger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(StructuredLogger.prototype, 'error').mockImplementation(() => undefined);
    const next = {
      handle: () => throwError(() => new HttpException('controlled', status)),
    } as CallHandler;

    await expect(
      lastValueFrom(new LoggingInterceptor().intercept(context(), next)),
    ).rejects.toThrow('controlled');

    expect(warn).toHaveBeenCalledWith(
      'controlled client request',
      expect.objectContaining({ statusCode: status, path: '/api/auth/login' }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('must-not-be-logged');
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does not log an exception payload or query string for failed requests', async () => {
    const error = vi.spyOn(StructuredLogger.prototype, 'error').mockImplementation(() => undefined);
    const next = {
      handle: () => throwError(() => new Error('postgresql://secret@database/internal')),
    } as CallHandler;

    await expect(
      lastValueFrom(new LoggingInterceptor().intercept(context(), next)),
    ).rejects.toThrow();

    const serializedCalls = JSON.stringify(error.mock.calls);
    expect(serializedCalls).not.toContain('secret@database');
    expect(serializedCalls).not.toContain('must-not-be-logged');
    expect(serializedCalls).toContain('/api/auth/login');
    vi.restoreAllMocks();
  });
});
