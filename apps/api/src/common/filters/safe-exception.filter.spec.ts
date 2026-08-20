import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException, type ArgumentsHost } from '@nestjs/common';
import { StructuredLogger } from '@ventureos/observability';
import { SafeExceptionFilter } from './safe-exception.filter';
import { AuthCooldownException } from '../../modules/auth/auth-abuse.service';

function createHost(path = '/api/auth/login') {
  const response = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  const request = {
    correlationId: 'correlation-test',
    path,
    originalUrl: '/api/auth/login?token=must-not-be-logged',
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('SafeExceptionFilter authentication cooldown response', () => {
  it('adds a bounded Retry-After header without exposing the internal reason code', () => {
    const warnSpy = vi
      .spyOn(StructuredLogger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(StructuredLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host, response } = createHost();

    new SafeExceptionFilter().catch(
      new AuthCooldownException({
        reasonCode: 'LOGIN_IP_COOLDOWN',
        retryAfterSeconds: 300,
      }),
      host,
    );

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '300');
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        message: 'Authentication temporarily unavailable',
      }),
    );
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('LOGIN_IP_COOLDOWN');
    expect(warnSpy).toHaveBeenCalledWith(
      'controlled client exception',
      expect.objectContaining({ status: 429, path: '/api/auth/login' }),
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('must-not-be-logged');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not mislabel an expected 401 as an unhandled exception', () => {
    const warnSpy = vi
      .spyOn(StructuredLogger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(StructuredLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host } = createHost();

    new SafeExceptionFilter().catch(new UnauthorizedException('Invalid email or password'), host);

    expect(warnSpy).toHaveBeenCalledWith(
      'controlled client exception',
      expect.objectContaining({ status: 401 }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not log an unhandled exception payload, stack, or query string', () => {
    const errorSpy = vi
      .spyOn(StructuredLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host, response } = createHost();

    new SafeExceptionFilter().catch(new Error('postgresql://secret@database/internal'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    const serializedCalls = JSON.stringify(errorSpy.mock.calls);
    expect(serializedCalls).not.toContain('secret@database');
    expect(serializedCalls).not.toContain('must-not-be-logged');
    expect(serializedCalls).toContain('/api/auth/login');
  });

  it('maps late capability-policy denials to a generic forbidden response', () => {
    const warnSpy = vi
      .spyOn(StructuredLogger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(StructuredLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host, response } = createHost();
    const denial = new Error('internal policy reason must not leak');
    denial.name = 'CapabilityPolicyDeniedError';

    new SafeExceptionFilter().catch(denial, host);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, message: 'Operation is not available' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'controlled client exception',
      expect.objectContaining({ status: 403 }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('internal policy reason');
  });

  it('redacts invitation bearer credentials from exception logs', () => {
    const errorSpy = vi
      .spyOn(StructuredLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host } = createHost('/api/workspace-invitations/super-secret-token/accept');

    new SafeExceptionFilter().catch(new Error('failed'), host);

    const serializedCalls = JSON.stringify(errorSpy.mock.calls);
    expect(serializedCalls).toContain('/api/workspace-invitations/:token/accept');
    expect(serializedCalls).not.toContain('super-secret-token');
    vi.restoreAllMocks();
  });
});
