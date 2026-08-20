import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import type { Env } from '@ventureos/config';
import { SessionAuthGuard } from './session-auth.guard';

vi.mock('@ventureos/database', () => ({
  prisma: { session: { findUnique: vi.fn() } },
}));

vi.mock('@ventureos/auth', () => ({
  hashSessionToken: vi.fn(() => 'session-digest'),
  isSessionExpired: vi.fn(() => false),
}));

function executionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard active workspace resolution', () => {
  const guard = new SessionAuthGuard({ AUTH_COOKIE_NAME: 'ventureos_session' } as Env);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses only the membership selected by the session even when another membership is first', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      activeWorkspaceId: '00000000-0000-4000-8000-000000000020',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: '00000000-0000-4000-8000-000000000002',
        email: 'member@example.test',
        isFounder: true,
        memberships: [
          {
            workspaceId: '00000000-0000-4000-8000-000000000010',
            workspace: { name: 'Founder tenant' },
            role: {
              key: 'FOUNDER',
              rolePermissions: [{ permission: { key: 'workspace:members:manage' } }],
            },
          },
          {
            workspaceId: '00000000-0000-4000-8000-000000000020',
            workspace: { name: 'Viewer tenant' },
            role: {
              key: 'VIEWER',
              rolePermissions: [{ permission: { key: 'opportunity:view' } }],
            },
          },
        ],
      },
    } as never);
    const request = { cookies: { ventureos_session: 'raw-session' } };

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(request).toMatchObject({
      user: {
        workspaceId: '00000000-0000-4000-8000-000000000020',
        workspaceName: 'Viewer tenant',
        roleKey: 'VIEWER',
        permissions: ['opportunity:view'],
      },
    });
  });

  it('fails closed when the active workspace no longer has a membership', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      activeWorkspaceId: '00000000-0000-4000-8000-000000000099',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: '00000000-0000-4000-8000-000000000002',
        email: 'member@example.test',
        isFounder: false,
        memberships: [],
      },
    } as never);

    await expect(
      guard.canActivate(executionContext({ cookies: { ventureos_session: 'raw-session' } })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
