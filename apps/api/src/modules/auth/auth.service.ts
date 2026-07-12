import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { prisma } from '@ventureos/database';
import { verifyPassword, generateSessionToken, sessionExpiryDate } from '@ventureos/auth';
import { ENV_TOKEN } from '../../config/env.provider';
import type { Env } from '@ventureos/config';

export interface LoginResult {
  sessionToken: string;
  expiresAt: Date;
  user: { id: string; email: string; displayName: string; isFounder: boolean };
}

@Injectable()
export class AuthService {
  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {}

  async login(email: string, password: string, req: Pick<Request, 'ip' | 'headers'>): Promise<LoginResult> {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      await this.recordSecurityEvent(undefined, 'LOGIN_FAILURE', 'WARN', `Failed login attempt for ${email}`, req);
      throw new UnauthorizedException('Invalid email or password');
    }

    const sessionToken = generateSessionToken();
    const expiresAt = sessionExpiryDate(this.env.AUTH_SESSION_MAX_AGE_SECONDS);

    await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken,
        expiresAt,
        ipAddress: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      },
    });

    await this.recordSecurityEvent(user.id, 'LOGIN_SUCCESS', 'INFO', `Successful login for ${email}`, req);

    return {
      sessionToken,
      expiresAt,
      user: { id: user.id, email: user.email, displayName: user.displayName, isFounder: user.isFounder },
    };
  }

  async logout(sessionToken: string): Promise<void> {
    await prisma.session
      .updateMany({ where: { sessionToken, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
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
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      },
    });
  }
}
