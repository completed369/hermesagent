import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Env } from '@ventureos/config';
import { CsrfOriginGuard } from '../csrf-origin.guard';

const allowedOrigin = 'http://localhost:3000';
const env = {
  API_CORS_ORIGIN: allowedOrigin,
  AUTH_COOKIE_NAME: 'ventureos_session',
} as Env;

function contextFor(input: {
  method: string;
  authenticated?: boolean;
  origin?: string;
}): ExecutionContext {
  const request = {
    method: input.method,
    cookies: input.authenticated ? { ventureos_session: 'synthetic-session-token' } : {},
    headers: input.origin ? { origin: input.origin } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CsrfOriginGuard', () => {
  const guard = new CsrfOriginGuard(env);

  it('allows safe authenticated requests without an Origin header', () => {
    expect(guard.canActivate(contextFor({ method: 'GET', authenticated: true }))).toBe(true);
  });

  it('allows unauthenticated unsafe requests for public auth endpoints', () => {
    expect(guard.canActivate(contextFor({ method: 'POST' }))).toBe(true);
  });

  it('allows authenticated unsafe requests from the configured web origin', () => {
    expect(
      guard.canActivate(contextFor({ method: 'POST', authenticated: true, origin: allowedOrigin })),
    ).toBe(true);
  });

  it('rejects authenticated unsafe requests with no Origin header', () => {
    expect(() => guard.canActivate(contextFor({ method: 'POST', authenticated: true }))).toThrow(
      /origin/i,
    );
  });

  it('rejects authenticated unsafe requests from another origin', () => {
    expect(() =>
      guard.canActivate(
        contextFor({ method: 'DELETE', authenticated: true, origin: 'https://attacker.example' }),
      ),
    ).toThrow(/origin/i);
  });
});
