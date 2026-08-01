import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@ventureos/database';
import {
  verifyPasswordAsync,
  DUMMY_PASSWORD_HASH,
  hashPasswordAsync,
  generateSessionToken,
  hashSessionToken,
  sessionExpiryDate,
} from '@ventureos/auth';
import { startTrialSubscription } from '@ventureos/billing';
import { ENV_TOKEN } from '../../config/env.provider';
import type { Env } from '@ventureos/config';
import { AuditService } from '../audit/audit.service';
import {
  AuthAbuseService,
  AuthCooldownException,
  type AuthAbuseContext,
} from './auth-abuse.service';
import { normalizeAccountIdentifier } from './auth-identifiers';

export interface LoginResult {
  sessionToken: string;
  expiresAt: Date;
  user: { id: string; email: string; displayName: string; isFounder: boolean };
}

export interface RegisterResult {
  accepted: true;
}

const WORKSPACE_SLUG_RETRY_LIMIT = 3;
const REGISTRATION_UNAVAILABLE_MESSAGE = 'Registration temporarily unavailable';

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'workspace'
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function uniqueConstraintTargets(error: unknown): string[] {
  if (typeof error !== 'object' || error === null || !('meta' in error)) return [];
  const meta = error.meta;
  if (typeof meta !== 'object' || meta === null || !('target' in meta)) return [];
  const target = meta.target;
  if (Array.isArray(target))
    return target.filter((value): value is string => typeof value === 'string');
  return typeof target === 'string' ? [target] : [];
}

function identifiesWorkspaceSlugConstraint(error: unknown): boolean {
  return uniqueConstraintTargets(error).some(
    (target) => target === 'slug' || target.includes('workspaces_slug'),
  );
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(AuthAbuseService) private readonly authAbuseService: AuthAbuseService,
  ) {}

  async login(
    email: string,
    password: string,
    req: Pick<Request, 'ip' | 'headers'>,
  ): Promise<LoginResult> {
    const normalizedEmail = normalizeAccountIdentifier(email);
    const context = this.authAbuseService.createContext(normalizedEmail, req.ip ?? '0.0.0.0');
    const activeBlock = await this.authAbuseService.getActiveBlock('LOGIN', context);

    if (activeBlock) {
      await this.recordAuthSecurityEvent('AUTH_COOLDOWN', 'WARN', context, activeBlock.reasonCode);
      throw new AuthCooldownException(activeBlock);
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const passwordOk = await verifyPasswordAsync(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !user.passwordHash || !passwordOk) {
      const newBlock = await this.authAbuseService.recordAttempt('LOGIN', context);
      await this.recordAuthSecurityEvent(
        'LOGIN_FAILURE',
        'WARN',
        context,
        newBlock?.reasonCode ?? 'INVALID_CREDENTIALS',
      );
      if (newBlock) throw new AuthCooldownException(newBlock);
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.authAbuseService.clearLoginAccount(context);
    const sessionToken = generateSessionToken();
    const expiresAt = sessionExpiryDate(this.env.AUTH_SESSION_MAX_AGE_SECONDS);

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenDigest: hashSessionToken(sessionToken),
        expiresAt,
        ipAddress: undefined,
        userAgent:
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      },
    });

    await this.recordAuthSecurityEvent(
      'LOGIN_SUCCESS',
      'INFO',
      context,
      'LOGIN_SUCCEEDED',
      user.id,
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
   * Public registration deliberately returns the same accepted result for
   * new and existing accounts. It never creates a session, so response
   * cookies and bodies cannot act as an account-existence oracle.
   */
  async register(
    email: string,
    password: string,
    displayName: string,
    workspaceName: string,
    req: Pick<Request, 'ip' | 'headers'>,
  ): Promise<RegisterResult> {
    const responseStartedAt = Date.now();
    try {
      const normalizedEmail = normalizeAccountIdentifier(email);
      const context = this.authAbuseService.createContext(normalizedEmail, req.ip ?? '0.0.0.0');
      const activeBlock = await this.authAbuseService.getActiveBlock('REGISTER', context);
      if (activeBlock) {
        await this.recordAuthSecurityEvent(
          'AUTH_COOLDOWN',
          'WARN',
          context,
          activeBlock.reasonCode,
        );
        throw new AuthCooldownException(activeBlock);
      }

      const newBlock = await this.authAbuseService.recordAttempt('REGISTER', context);
      if (newBlock) {
        await this.recordAuthSecurityEvent('AUTH_COOLDOWN', 'WARN', context, newBlock.reasonCode);
        throw new AuthCooldownException(newBlock);
      }

      // Hash before checking existence so duplicate requests execute the same
      // repository-controlled password KDF as new registrations.
      const passwordHash = await hashPasswordAsync(password);
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        await this.recordAuthSecurityEvent(
          'REGISTRATION_EVALUATED',
          'INFO',
          context,
          'REGISTRATION_ACCEPTED',
        );
        return { accepted: true };
      }

      const founderRole = await prisma.role.findUnique({ where: { key: 'FOUNDER' } });
      if (!founderRole) {
        throw new Error(
          'FOUNDER role is not seeded -- run pnpm db:seed before allowing registration',
        );
      }

      const baseSlug = slugify(workspaceName);
      let registration: {
        user: { id: string };
        workspace: { id: string; name: string; slug: string };
      } | null = null;

      for (let retry = 0; retry <= WORKSPACE_SLUG_RETRY_LIMIT; retry += 1) {
        const slug = retry === 0 ? baseSlug : `${baseSlug}-${randomUUID().slice(0, 8)}`;
        try {
          registration = await this.createRegistration({
            normalizedEmail,
            passwordHash,
            displayName,
            workspaceName,
            slug,
            founderRoleId: founderRole.id,
            context,
          });
          break;
        } catch (error: unknown) {
          if (!isUniqueConstraintError(error)) throw error;

          const racedUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
          if (racedUser) {
            await this.recordAuthSecurityEvent(
              'REGISTRATION_EVALUATED',
              'INFO',
              context,
              'REGISTRATION_ACCEPTED',
            );
            return { accepted: true };
          }

          const targets = uniqueConstraintTargets(error);
          const slugCollision =
            identifiesWorkspaceSlugConstraint(error) ||
            (targets.length === 0 &&
              (await prisma.workspace.findUnique({ where: { slug } })) !== null);
          if (!slugCollision || retry === WORKSPACE_SLUG_RETRY_LIMIT) {
            throw new ServiceUnavailableException(REGISTRATION_UNAVAILABLE_MESSAGE);
          }
        }
      }

      if (!registration) {
        throw new ServiceUnavailableException(REGISTRATION_UNAVAILABLE_MESSAGE);
      }
      return { accepted: true };
    } catch (error: unknown) {
      if (error instanceof AuthCooldownException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(REGISTRATION_UNAVAILABLE_MESSAGE);
    } finally {
      await this.enforceRegistrationResponseFloor(responseStartedAt);
    }
  }

  async logout(sessionToken: string): Promise<void> {
    await prisma.session.updateMany({
      where: { tokenDigest: hashSessionToken(sessionToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRegistration(params: {
    normalizedEmail: string;
    passwordHash: string;
    displayName: string;
    workspaceName: string;
    slug: string;
    founderRoleId: string;
    context: AuthAbuseContext;
  }) {
    return prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: params.normalizedEmail,
          passwordHash: params.passwordHash,
          displayName: params.displayName,
          isFounder: true,
        },
      });
      await tx.founderProfile.create({ data: { userId: createdUser.id } });

      const createdWorkspace = await tx.workspace.create({
        data: {
          name: params.workspaceName,
          slug: params.slug,
          mode: 'SINGLE_FOUNDER',
          baseCurrency: 'EUR',
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: createdWorkspace.id,
          userId: createdUser.id,
          roleId: params.founderRoleId,
        },
      });
      await tx.workspaceBranding.create({
        data: { workspaceId: createdWorkspace.id, brandName: params.workspaceName },
      });

      await startTrialSubscription(createdWorkspace.id, tx);
      await this.auditService.record(
        createdWorkspace.id,
        {
          actorId: createdUser.id,
          action: 'WORKSPACE_REGISTERED',
          entityType: 'Workspace',
          entityId: createdWorkspace.id,
          after: { name: createdWorkspace.name, slug: createdWorkspace.slug } as unknown as Record<
            string,
            unknown
          >,
        },
        tx,
      );
      await this.recordAuthSecurityEvent(
        'REGISTRATION_EVALUATED',
        'INFO',
        params.context,
        'REGISTRATION_ACCEPTED',
        createdUser.id,
        tx,
      );

      return { user: createdUser, workspace: createdWorkspace };
    });
  }

  private async enforceRegistrationResponseFloor(startedAt: number): Promise<void> {
    const remainingMs = this.env.AUTH_REGISTRATION_MIN_RESPONSE_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
  }

  private async recordAuthSecurityEvent(
    type: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL',
    context: AuthAbuseContext,
    reasonCode: string,
    userId?: string,
    client: Pick<Prisma.TransactionClient, 'securityEvent'> = prisma,
  ): Promise<void> {
    await client.securityEvent.create({
      data: {
        userId,
        type,
        severity,
        description: 'Authentication request evaluated',
        metadata: {
          reasonCode,
          accountIdentifier: context.accountDigest,
          ipIdentifier: context.ipDigest,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
