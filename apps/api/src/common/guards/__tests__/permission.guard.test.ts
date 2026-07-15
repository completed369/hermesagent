import { describe, expect, it } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../permission.guard';
import { PERMISSION_KEY } from '../../decorators/require-permission.decorator';

function makeContext(user: { permissions: string[] } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  it('resolves Reflector via @Inject through the Nest container', async () => {
    // Proves the explicit @Inject(Reflector) wiring is honoured by the DI
    // container (rather than relying on reflected constructor metadata).
    const moduleRef = await Test.createTestingModule({ providers: [PermissionGuard] }).compile();
    const guard = moduleRef.get(PermissionGuard);
    expect(guard).toBeInstanceOf(PermissionGuard);
    expect(typeof (guard as unknown as { reflector: Reflector }).reflector?.getAllAndOverride).toBe(
      'function',
    );
  });

  it('allows access when no permission is required', () => {
    const reflector = new Reflector();
    const guard = new PermissionGuard(reflector);
    const ctx = makeContext({ permissions: [] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when the user has the required permission', () => {
    const reflector = { getAllAndOverride: () => 'audit:view' } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const ctx = makeContext({ permissions: ['audit:view'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('fails closed (throws) when the user lacks the required permission', () => {
    const reflector = { getAllAndOverride: () => 'product:publish' } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const ctx = makeContext({ permissions: ['audit:view'] });
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('fails closed when there is no authenticated user at all', () => {
    const reflector = { getAllAndOverride: () => 'audit:view' } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow();
  });
});
