import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Env } from '@ventureos/config';
import { ENV_TOKEN } from '../../config/env.provider';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rejects cross-origin state changes authenticated by the session cookie.
 * Browsers control the Origin header, so an attacker cannot make an accepted
 * credentialed request merely because the cookie is sent. Cookie-less public
 * auth requests remain available, while every authenticated unsafe method is
 * covered centrally rather than relying on individual controllers.
 */
@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

    const hasSessionCookie = Boolean(req.cookies?.[this.env.AUTH_COOKIE_NAME]);
    if (!hasSessionCookie) return true;

    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin !== this.env.API_CORS_ORIGIN) {
      throw new ForbiddenException('Request origin is not allowed');
    }

    return true;
  }
}
