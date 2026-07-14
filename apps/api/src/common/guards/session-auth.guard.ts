import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { prisma } from '@ventureos/database';
import { isSessionExpired } from '@ventureos/auth';
import { ENV_TOKEN } from '../../config/env.provider';
import type { Env } from '@ventureos/config';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  isFounder: boolean;
  workspaceId: string;
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
      where: { sessionToken: token },
      include: {
        user: {
          include: {
            memberships: {
              include: {
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

    const membership = session.user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException('User has no workspace membership');
    }

    req.user = {
      userId: session.user.id,
      email: session.user.email,
      isFounder: session.user.isFounder,
      workspaceId: membership.workspaceId,
      roleKey: membership.role.key,
      permissions: membership.role.rolePermissions.map((rp) => rp.permission.key),
    };

    return true;
  }
}
