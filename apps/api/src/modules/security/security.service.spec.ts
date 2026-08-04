import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ventureos/database';
import { SecurityService } from './security.service';

vi.mock('@ventureos/database', () => ({
  prisma: {
    securityEvent: { findMany: vi.fn() },
  },
}));

describe('SecurityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.securityEvent.findMany).mockResolvedValue([]);
  });

  it('does not expose unscoped platform security events to a workspace', async () => {
    await new SecurityService().list('workspace-a');

    expect(prisma.securityEvent.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-a' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
});
