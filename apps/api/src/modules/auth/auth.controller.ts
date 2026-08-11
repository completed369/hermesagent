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
    const token = req.cookies?.[this.env.AUTH_COOKIE_NAME];
    if (token) await this.authService.logout(token);
    res.clearCookie(this.env.AUTH_COOKIE_NAME, {
      path: '/',
      domain: this.env.AUTH_COOKIE_DOMAIN,
    });
    return { success: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }
}
