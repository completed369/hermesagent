import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import { WorkspacesService } from './workspaces.service';
import {
  acceptInvitationSchema,
  changeMemberRoleSchema,
  createInvitationSchema,
  previewInvitationSchema,
  switchWorkspaceSchema,
  updateBrandingSchema,
  workspaceMemberIdSchema,
} from './workspaces.dto';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('workspaces')
@Controller('workspaces')
@UseGuards(SessionAuthGuard)
export class WorkspacesController {
  constructor(@Inject(WorkspacesService) private readonly workspacesService: WorkspacesService) {}

  @Get('current')
  async current(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.getWorkspaceSummary(user.workspaceId);
  }

  @Patch('branding')
  @UseGuards(PermissionGuard)
  @RequirePermission('workspace:branding:manage')
  async updateBranding(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = parseRequestBody(updateBrandingSchema, body);
    return this.workspacesService.updateBranding(user.workspaceId, input);
  }

  @Get('members')
  @UseGuards(PermissionGuard)
  @RequirePermission('workspace:members:manage')
  listMembers(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.listMembers(user.workspaceId);
  }

  @Get('available')
  listAvailable(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.listAvailableWorkspaces(user.userId);
  }

  @Post('switch')
  @HttpCode(200)
  switchWorkspace(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = parseRequestBody(switchWorkspaceSchema, body);
    return this.workspacesService.switchWorkspace(user.sessionId, user.userId, input.workspaceId);
  }

  @Post('invitations')
  @Header('Cache-Control', 'no-store')
  @UseGuards(PermissionGuard)
  @RequirePermission('workspace:members:manage')
  createInvitation(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = parseRequestBody(createInvitationSchema, body);
    return this.workspacesService.createInvitation(
      user.workspaceId,
      user.userId,
      input.roleKey,
      input.expiresInHours,
    );
  }

  @Patch('members/:memberId/role')
  @UseGuards(PermissionGuard)
  @RequirePermission('workspace:members:manage')
  changeMemberRole(
    @Param('memberId') memberId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsedMemberId = parseRouteParam(workspaceMemberIdSchema, memberId);
    const input = parseRequestBody(changeMemberRoleSchema, body);
    return this.workspacesService.changeMemberRole(
      user.workspaceId,
      user.userId,
      parsedMemberId,
      input.roleKey,
    );
  }

  @Delete('members/:memberId')
  @UseGuards(PermissionGuard)
  @RequirePermission('workspace:members:manage')
  removeMember(@Param('memberId') memberId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.removeMember(
      user.workspaceId,
      user.userId,
      parseRouteParam(workspaceMemberIdSchema, memberId),
    );
  }
}

@ApiTags('workspace-invitations')
@Controller('workspace-invitations')
export class WorkspaceInvitationsController {
  constructor(@Inject(WorkspacesService) private readonly workspacesService: WorkspacesService) {}

  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  get(@Body() body: unknown) {
    const input = parseRequestBody(previewInvitationSchema, body);
    return this.workspacesService.getInvitation(input.token);
  }

  @Post('accept')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  accept(@Body() body: unknown) {
    const input = parseRequestBody(acceptInvitationSchema, body);
    return this.workspacesService.acceptInvitation(input.token, input);
  }

  @Post('accept-authenticated')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(SessionAuthGuard)
  acceptAuthenticated(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = parseRequestBody(previewInvitationSchema, body);
    return this.workspacesService.acceptInvitationForAuthenticatedUser(input.token, user);
  }
}

function parseRequestBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  body: unknown,
): z.output<TSchema> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid request body');
  }
  return parsed.data;
}

function parseRouteParam<T>(schema: z.ZodType<T>, value: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid route parameter');
  }
  return parsed.data;
}
