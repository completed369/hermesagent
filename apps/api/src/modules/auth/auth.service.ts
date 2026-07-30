import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '@ventureos/database';
import {
  verifyPassword,
  hashPassword,
  generateSessionToken,
  hashSessionToken,
  sessionExpiryDate,
} from '@ventureos/auth';
import { startTrialSubscription, SubscriptionAlreadyExistsError } from '@ventureos/billing';
import { ENV_TOKEN } from '../../config/env.provider';
import type { Env } from '@ventureos/config';
import { AuditService } from '../audit/audit.service';

export interface LoginResult {
  sessionToken: string;
  expiresAt: Date;
  user: { id: string; email: string; displayName: string; isFounder: boolean };
}

export interface RegisterResult extends LoginResult {
  workspace: { id: string; name: string; slug: string };
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'workspace'
  );
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly auditService: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    req: Pick<Request, 'ip' | 'headers'>,
  ): Promise<LoginResult> {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      await this.recordSecurityEvent(
        undefined,
        'LOGIN_FAILURE',
        'WARN',
        `Failed login attempt for ${email}`,
        req,
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    const sessionToken = generateSessionToken();
    const expiresAt = sessionExpiryDate(this.env.AUTH_SESSION_MAX_AGE_SECONDS);

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenDigest: hashSessionToken(sessionToken),
        expiresAt,
        ipAddress: req.ip,
        userAgent:
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      },
    });

    await this.recordSecurityEvent(
      user.id,
      'LOGIN_SUCCESS',
      'INFO',
      `Successful login for ${email}`,
      req,
    );

    return {
      sessionToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isFounder: user.isFounder,
      },
    };
  }

  /**
   * Phase 8: registers a brand-new customer -- a real signup path distinct
   * from the founder dev-seed, which is what makes VentureOS actually
   * resellable rather than single-founder-only. Creates a new User +
   * Workspace + WorkspaceMember (FOUNDER role -- the registrant is the
   * founder/owner of *their own* new workspace, same role key the original
   * dev-seed founder uses, no new RBAC role needed) + a TRIAL Subscription
   * (`@ventureos/billing`'s `startTrialSubscription`), then logs the new
   * user straight in (same session-cookie mechanism as `login`) so they
   * land directly in the onboarding wizard, never on an empty dashboard.
   *
   * Fails closed with `ConflictException` if the email is already
   * registered, or if the derived workspace slug collides (retried once
   * with a random suffix before giving up, since slugs are derived from
   * user-chosen workspace names that can legitimately collide).
   */
  async register(
    email: string,
    password: string,
    displayName: string,
    workspaceName: string,
    req: Pick<Request, 'ip' | 'headers'>,
  ): Promise<RegisterResult> {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const founderRole = await prisma.role.findUnique({ where: { key: 'FOUNDER' } });
    if (!founderRole) {
      throw new Error(
        'FOUNDER role is not seeded -- run pnpm db:seed before allowing registration',
      );
    }

    const baseSlug = slugify(workspaceName);
    let slug = baseSlug;
    if (await prisma.workspace.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${randomUUID().slice(0, 8)}`;
    }

    const { user, workspace } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          passwordHash: hashPassword(password),
          displayName,
          isFounder: true,
        },
      });
      await tx.founderProfile.create({ data: { userId: createdUser.id } });

      const createdWorkspace = await tx.workspace.create({
        data: { name: workspaceName, slug, mode: 'SINGLE_FOUNDER', baseCurrency: 'EUR' },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: createdWorkspace.id, userId: createdUser.id, roleId: founderRole.id },
      });
      await tx.workspaceBranding.create({
        data: { workspaceId: createdWorkspace.id, brandName: workspaceName },
      });

      return { user: createdUser, workspace: createdWorkspace };
    });

    try {
      await startTrialSubscription(workspace.id);
    } catch (err) {
      // SubscriptionAlreadyExistsError cannot happen for a just-created
      // workspace; re-throw anything else rather than leaving the workspace
      // subscription-less.
      if (!(err instanceof SubscriptionAlreadyExistsError)) throw err;
    }

    await this.auditService.record(workspace.id, {
      actorId: user.id,
      action: 'WORKSPACE_REGISTERED',
      entityType: 'Workspace',
      entityId: workspace.id,
      after: { name: workspace.name, slug: workspace.slug } as unknown as Record<string, unknown>,
    });

    const sessionToken = generateSessionToken();
    const expiresAt = sessionExpiryDate(this.env.AUTH_SESSION_MAX_AGE_SECONDS);
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenDigest: hashSessionToken(sessionToken),
        expiresAt,
        ipAddress: req.ip,
        userAgent:
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      },
    });
    await this.recordSecurityEvent(
      user.id,
      'LOGIN_SUCCESS',
      'INFO',
      `Account registered and logged in for ${email}`,
      req,
    );

    return {
      sessionToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isFounder: user.isFounder,
      },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    };
  }

  async logout(sessionToken: string): Promise<void> {
    await prisma.session.updateMany({
      where: { tokenDigest: hashSessionToken(sessionToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async recordSecurityEvent(
    userId: string | undefined,
    type: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL',
    description: string,
    req: Pick<Request, 'ip' | 'headers'>,
  ): Promise<void> {
    await prisma.securityEvent.create({
      data: {
        userId,
        type,
        severity,
        description,
        ipAddress: req.ip,
        userAgent:
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      },
    });
  }
}
