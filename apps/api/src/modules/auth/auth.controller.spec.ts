import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { Env } from '@ventureos/config';
import type { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

describe('AuthController session cookie scope', () => {
  function setup(cookieDomain: string) {
    const authService = {
      login: vi.fn().mockResolvedValue({
        sessionToken: 'session-token',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        user: {
          id: 'founder-id',
          email: 'founder@example.test',
          displayName: 'Founder',
          isFounder: true,
        },
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthService;
    const env = {
      NODE_ENV: 'production',
      AUTH_COOKIE_NAME: 'ventureos_session',
      AUTH_COOKIE_DOMAIN: cookieDomain,
      AUTH_REGISTRATION_MIN_RESPONSE_MS: 300,
    } as unknown as Env;
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const response = { cookie, clearCookie } as unknown as Response;
    const request = {
      ip: '127.0.0.1',
      headers: {},
      cookies: { ventureos_session: 'session-token' },
    } as unknown as Request;

    return {
      controller: new AuthController(authService, env),
      authService,
      request,
      response,
      cookie,
      clearCookie,
    };
  }

  it('sets the configured shared domain on the login session cookie', async () => {
    const { controller, request, response, cookie } = setup('ventureos.site');

    await controller.login(
      { email: 'founder@example.test', password: 'correct-password' },
      request,
      response,
    );

    expect(cookie).toHaveBeenCalledWith(
      'ventureos_session',
      'session-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        domain: 'ventureos.site',
      }),
    );
  });

  it('clears the session cookie using the same shared domain', async () => {
    const { controller, authService, request, response, clearCookie } = setup('ventureos.site');

    await controller.logout(request, response);

    expect(authService.logout).toHaveBeenCalledWith('session-token');
    expect(clearCookie).toHaveBeenCalledWith('ventureos_session', {
      path: '/',
      domain: 'ventureos.site',
    });
  });
});
