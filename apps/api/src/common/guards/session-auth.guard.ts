import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { prisma } from '@ventureos/database';
import { hashSessionToken, isSessionExpired } from '@ventureos/auth';
import { ENV_TOKEN } from '../../config/env.provider';
import type { Env } from '@ventureos/config';

export interface AuthenticatedUser {
  sessionId: string;
  userId: string;
  email: string;
  isFounder: boolean;
  workspaceId: string;
  workspaceName: string;
  roleKey: string;
  permissions: string[];
}

/**
 * Server-side session authentication guard. Resolves the session cookie to a
 * real DB-backed session + workspace membership + role + permissions on
 * EVERY request. There is no client-trusted auth state anywhere in the API.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[this.env.AUTH_COOKIE_NAME];

    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    const session = await prisma.session.findUnique({
      where: { tokenDigest: hashSessionToken(token) },
      include: {
        user: {
          include: {
            memberships: {
              include: {
                workspace: { select: { name: true } },
                role: { include: { rolePermissions: { include: { permission: true } } } },
              },
            },
          },
        },
      },
    });

    if (!session || session.revokedAt || isSessionExpired(session.expiresAt)) {
      throw new UnauthorizedException('Session invalid or expired');
    }

    const membership = session.activeWorkspaceId
      ? session.user.memberships.find(
          (candidate) => candidate.workspaceId === session.activeWorkspaceId,
        )
      : undefined;
    if (!membership) {
      throw new UnauthorizedException('Session has no active workspace membership');
    }

    req.user = {
      sessionId: session.id,
      userId: session.user.id,
      email: session.user.email,
      isFounder: session.user.isFounder,
      workspaceId: membership.workspaceId,
      workspaceName: membership.workspace.name,
      roleKey: membership.role.key,
      permissions: membership.role.rolePermissions.map((rp) => rp.permission.key),
    };

    return true;
  }
}
