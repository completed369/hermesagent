import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
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
    });

    return { user: result.user };
  }

  /**
   * Phase 8: public signup for a brand-new customer workspace -- no
   * SessionAuthGuard, since the caller has no session yet. Mirrors
   * `login`'s cookie-setting so a freshly registered user lands directly in
   * their own new workspace's onboarding flow, already authenticated.
   */
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password, displayName, workspaceName } = registerSchema.parse(body);
    const result = await this.authService.register(
      email,
      password,
      displayName,
      workspaceName,
      req,
    );

    res.cookie(this.env.AUTH_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: result.expiresAt,
      path: '/',
    });

    return { user: result.user, workspace: result.workspace };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[this.env.AUTH_COOKIE_NAME];
    if (token) await this.authService.logout(token);
    res.clearCookie(this.env.AUTH_COOKIE_NAME, { path: '/' });
    return { success: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }
}
