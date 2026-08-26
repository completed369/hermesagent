import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { hashSessionToken } from '@ventureos/auth';
import type { Env } from '@ventureos/config';
import { SessionAuthGuard } from './session-auth.guard';

vi.mock('@ventureos/database', () => ({
  prisma: { $queryRaw: vi.fn() },
}));

vi.mock('@ventureos/auth', () => ({
  hashSessionToken: vi.fn(() => 'session-digest'),
}));

function executionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function authorityRow(permissionKeys = ['opportunity:view', 'workflow:view']) {
  return {
    sessionId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    email: 'member@example.test',
    isFounder: false,
    workspaceId: '00000000-0000-4000-8000-000000000020',
    workspaceName: 'Viewer tenant',
    roleKey: 'VIEWER',
    permissionKeys,
  };
}

describe('SessionAuthGuard exact authority projection', () => {
  const guard = new SessionAuthGuard({ AUTH_COOKIE_NAME: 'ventureos_session' } as Env);
  const validToken = 'a'.repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses only the bounded database-projected active workspace authority', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([authorityRow()] as never);
    const request = { cookies: { ventureos_session: validToken } };

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(request).toMatchObject({
      user: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        userId: '00000000-0000-4000-8000-000000000002',
        workspaceId: '00000000-0000-4000-8000-000000000020',
        workspaceName: 'Viewer tenant',
        roleKey: 'VIEWER',
        permissions: ['opportunity:view', 'workflow:view'],
      },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing authority', []],
    ['duplicate authority rows', [authorityRow(), authorityRow()]],
    ['malformed permissions', [authorityRow(['workflow:view', 'invalid permission'])]],
    ['duplicate permissions', [authorityRow(['workflow:view', 'workflow:view'])]],
    [
      'oversized permissions',
      [authorityRow(Array.from({ length: 129 }, (_, index) => `scope:item-${index}`))],
    ],
  ])('fails closed for %s', async (_label, rows) => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(rows as never);

    await expect(
      guard.canActivate(executionContext({ cookies: { ventureos_session: validToken } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it.each([
    ['missing', undefined],
    ['object JSON cookie', { token: validToken }],
    ['array JSON cookie', [validToken]],
    ['number', 1],
    ['empty', ''],
    ['short', 'a'.repeat(63)],
    ['long', 'a'.repeat(65)],
    ['uppercase', 'A'.repeat(64)],
    ['whitespace', `${'a'.repeat(63)} `],
    ['unicode', `${'a'.repeat(63)}é`],
    ['control', `${'a'.repeat(63)}\u0001`],
  ])('denies malformed %s cookie before hashing or querying', async (_label, token) => {
    const cookies = token === undefined ? {} : { ventureos_session: token };
    await expect(guard.canActivate(executionContext({ cookies }))).rejects.toThrow(
      'Session invalid or expired',
    );
    expect(hashSessionToken).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
