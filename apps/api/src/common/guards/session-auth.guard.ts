import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { prisma } from '@ventureos/database';
import { hashSessionToken } from '@ventureos/auth';
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

const MAX_SESSION_PERMISSIONS = 128;
const SESSION_TOKEN = /^[a-f0-9]{64}$/u;
const SAFE_PERMISSION_KEY = /^[a-z][a-z0-9._-]{0,63}(?::[a-z][a-z0-9._-]{0,63}){1,3}$/u;

interface SessionAuthorityRow {
  sessionId: string;
  userId: string;
  email: string;
  isFounder: boolean;
  workspaceId: string;
  workspaceName: string;
  roleKey: string;
  permissionKeys: string[];
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
    const token: unknown = req.cookies?.[this.env.AUTH_COOKIE_NAME];

    if (typeof token !== 'string' || !SESSION_TOKEN.test(token)) {
      throw new UnauthorizedException('Session invalid or expired');
    }

    const authorityRows = await prisma.$queryRaw<SessionAuthorityRow[]>`
      SELECT
        s."id" AS "sessionId",
        u."id" AS "userId",
        u."email" AS "email",
        u."isFounder" AS "isFounder",
        w."id" AS "workspaceId",
        w."name" AS "workspaceName",
        r."key" AS "roleKey",
        permissions."keys" AS "permissionKeys"
      FROM "sessions" s
      JOIN "users" u
        ON u."id" = s."userId"
       AND u."deletedAt" IS NULL
      JOIN "workspace_members" wm
        ON wm."userId" = s."userId"
       AND wm."workspaceId" = s."activeWorkspaceId"
      JOIN "workspaces" w
        ON w."id" = wm."workspaceId"
       AND w."deletedAt" IS NULL
      JOIN "roles" r ON r."id" = wm."roleId"
      CROSS JOIN LATERAL (
        SELECT COALESCE(array_agg(bounded."key" ORDER BY bounded."key"), ARRAY[]::text[]) AS "keys"
        FROM (
          SELECT p."key"
          FROM "role_permissions" rp
          JOIN "permissions" p ON p."id" = rp."permissionId"
          WHERE rp."roleId" = r."id"
          ORDER BY p."key"
          LIMIT ${MAX_SESSION_PERMISSIONS + 1}
        ) bounded
      ) permissions
      WHERE s."tokenDigest" = ${hashSessionToken(token)}
        AND s."revokedAt" IS NULL
        AND s."activeWorkspaceId" IS NOT NULL
        AND s."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      LIMIT 1
    `;

    const authority = authorityRows[0];
    if (!authority || authorityRows.length !== 1) {
      throw new UnauthorizedException('Session invalid or expired');
    }

    const permissions = authority.permissionKeys;
    if (
      !Array.isArray(permissions) ||
      permissions.length > MAX_SESSION_PERMISSIONS ||
      permissions.some((permission) =>
        typeof permission !== 'string' ? true : !SAFE_PERMISSION_KEY.test(permission),
      ) ||
      new Set(permissions).size !== permissions.length
    ) {
      throw new UnauthorizedException('Session invalid or expired');
    }

    req.user = {
      sessionId: authority.sessionId,
      userId: authority.userId,
      email: authority.email,
      isFounder: authority.isFounder,
      workspaceId: authority.workspaceId,
      workspaceName: authority.workspaceName,
      roleKey: authority.roleKey,
      permissions,
    };

    return true;
  }
}
