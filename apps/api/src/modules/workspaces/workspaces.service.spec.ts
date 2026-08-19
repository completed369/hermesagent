import { describe, expect, it, vi } from 'vitest';
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
});
