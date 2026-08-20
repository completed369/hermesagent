import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPasswordAsync } from '@ventureos/auth';
import { prisma } from '@ventureos/database';
import { WorkspacesService } from './workspaces.service';
import type { AuditService } from '../audit/audit.service';

vi.mock('@ventureos/database', () => ({
  prisma: {
    workspaceInvitation: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@ventureos/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ventureos/auth')>();
  return { ...actual, hashPasswordAsync: vi.fn().mockResolvedValue('salt:hash') };
});

describe('WorkspacesService invitation preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unknown token before invoking the password KDF or a transaction', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(null);
    const service = new WorkspacesService({ record: vi.fn() } as unknown as AuditService);

    await expect(
      service.acceptInvitation('a'.repeat(43), {
        email: 'invitee@example.test',
        password: 'expensive-password',
        displayName: 'Invitee',
      }),
    ).rejects.toThrow('invalid or unavailable');

    expect(hashPasswordAsync).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retries once after only a confirmed concurrent users.email unique race', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue({
      acceptedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: ['email'] } })
      .mockResolvedValueOnce({ received: true, workspaceName: 'Concurrent workspace' } as never);
    const service = new WorkspacesService({ record: vi.fn() } as unknown as AuditService);

    await expect(
      service.acceptInvitation('a'.repeat(43), {
        email: 'register-race@example.test',
        password: 'expensive-password',
        displayName: 'Invitee',
      }),
    ).resolves.toEqual({ received: true, workspaceName: 'Concurrent workspace' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('does not normalize an unrelated unique constraint failure', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue({
      acceptedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['slug'] },
    });
    const service = new WorkspacesService({ record: vi.fn() } as unknown as AuditService);

    await expect(
      service.acceptInvitation('a'.repeat(43), {
        email: 'unrelated-race@example.test',
        password: 'expensive-password',
        displayName: 'Invitee',
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
