import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ENV_TOKEN } from '../../config/env.provider';
import type { Env } from '@ventureos/config';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1),
  workspaceName: z.string().min(1),
});

function sessionTokensFromRequest(req: Request, cookieName: string): string[] {
  const tokens = new Set<string>();

  const parsedToken = req.cookies?.[cookieName];
  if (typeof parsedToken === 'string' && parsedToken.length > 0) {
    tokens.add(parsedToken);
  }

  const rawCookieHeader = req.headers.cookie;
  if (typeof rawCookieHeader === 'string') {
    for (const segment of rawCookieHeader.split(';')) {
      const separator = segment.indexOf('=');
      if (separator < 0) continue;

      const name = segment.slice(0, separator).trim();
      if (name !== cookieName) continue;

      const rawValue = segment.slice(separator + 1).trim();
      if (!rawValue) continue;

      try {
        tokens.add(decodeURIComponent(rawValue));
      } catch {
        tokens.add(rawValue);
      }
    }
  }

  return [...tokens];
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = loginSchema.parse(body);
    const result = await this.authService.login(email, password, req);

    res.cookie(this.env.AUTH_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: result.expiresAt,
      path: '/',
      domain: this.env.AUTH_COOKIE_DOMAIN,
    });

    return { user: result.user };
  }

  /**
   * Public signup returns an identical accepted response for new and
   * duplicate identifiers and deliberately creates no session cookie.
   */
  @Post('register')
  @HttpCode(202)
  async register(@Body() body: unknown, @Req() req: Request) {
    const responseStartedAt = Date.now();
    try {
      const parsed = registerSchema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException('Invalid registration request');
      }

      const { email, password, displayName, workspaceName } = parsed.data;
      await this.authService.register(email, password, displayName, workspaceName, req);
      return { message: 'Registration request accepted. Sign in to continue.' };
    } finally {
      const remainingMs =
        this.env.AUTH_REGISTRATION_MIN_RESPONSE_MS - (Date.now() - responseStartedAt);
      if (remainingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
      }
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = sessionTokensFromRequest(req, this.env.AUTH_COOKIE_NAME);
    await Promise.all(tokens.map((token) => this.authService.logout(token)));

    // Clear the current shared-domain cookie.
    res.clearCookie(this.env.AUTH_COOKIE_NAME, {
      path: '/',
      domain: this.env.AUTH_COOKIE_DOMAIN,
    });

    // Also clear the legacy host-only cookie left by pre-shared-domain
    // private-staging releases. Browsers can otherwise send both cookies
    // with the same name and cause logout to revoke the wrong session.
    if (this.env.AUTH_COOKIE_DOMAIN) {
      res.clearCookie(this.env.AUTH_COOKIE_NAME, { path: '/' });
    }

    return { success: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    const { sessionId: _sessionId, ...publicUser } = user;
    return { user: publicUser };
  }
}
