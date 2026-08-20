import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceInvitationsController, WorkspacesController } from './workspaces.controller';
import type { WorkspacesService } from './workspaces.service';
import type { AuthenticatedUser } from '../../common/guards/session-auth.guard';

const user: AuthenticatedUser = {
  sessionId: '00000000-0000-4000-8000-000000000000',
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'founder@example.test',
  isFounder: true,
  workspaceId: '00000000-0000-4000-8000-000000000002',
  workspaceName: 'Founder workspace',
  roleKey: 'FOUNDER',
  permissions: ['workspace:members:manage'],
};

function statusOf(action: () => unknown): number | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof BadRequestException ? error.getStatus() : undefined;
  }
  return undefined;
}

describe('workspace route parameter validation', () => {
  it.each(['short', 'a'.repeat(44), `${'a'.repeat(42)}!`])(
    'returns 400 for malformed invitation token %s',
    (token) => {
      const service = { getInvitation: vi.fn() } as unknown as WorkspacesService;
      const controller = new WorkspaceInvitationsController(service);

      expect(statusOf(() => controller.get({ token }))).toBe(400);
      expect(service.getInvitation).not.toHaveBeenCalled();
    },
  );

  it('returns 400 for malformed invitation acceptance bodies', () => {
    const service = { acceptInvitation: vi.fn() } as unknown as WorkspacesService;
    const controller = new WorkspaceInvitationsController(service);

    expect(
      statusOf(() =>
        controller.accept({
          token: 'short',
          email: 'invitee@example.test',
          password: 'password123',
          displayName: 'Invitee',
        }),
      ),
    ).toBe(400);
    expect(service.acceptInvitation).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', '00000000-0000-0000-0000-00000000000z'])(
    'returns 400 for malformed member ID %s',
    (memberId) => {
      const service = { removeMember: vi.fn() } as unknown as WorkspacesService;
      const controller = new WorkspacesController(service);

      expect(statusOf(() => controller.removeMember(memberId, user))).toBe(400);
      expect(service.removeMember).not.toHaveBeenCalled();
    },
  );
});
