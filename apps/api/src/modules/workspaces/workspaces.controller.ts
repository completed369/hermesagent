import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
  invitationTokenSchema,
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
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('current')
  async current(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.getWorkspaceSummary(user.workspaceId);
  }

  @Patch('branding')
  @UseGuards(PermissionGuard)
  @RequirePermission('workspace:branding:manage')
  async updateBranding(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = updateBrandingSchema.parse(body);
    return this.workspacesService.updateBranding(user.workspaceId, input);
  }

  @Get('members')
  @UseGuards(PermissionGuard)
  @RequirePermission('workspace:members:manage')
  listMembers(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.listMembers(user.workspaceId);
  }

  @Post('invitations')
  @UseGuards(PermissionGuard)
  @RequirePermission('workspace:members:manage')
  createInvitation(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = createInvitationSchema.parse(body);
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
    const input = changeMemberRoleSchema.parse(body);
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
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  get(@Param('token') token: string) {
    return this.workspacesService.getInvitation(parseRouteParam(invitationTokenSchema, token));
  }

  @Post(':token/accept')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  accept(@Param('token') token: string, @Body() body: unknown) {
    const input = acceptInvitationSchema.parse(body);
    return this.workspacesService.acceptInvitation(
      parseRouteParam(invitationTokenSchema, token),
      input,
    );
  }
}

function parseRouteParam<T>(schema: z.ZodType<T>, value: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid route parameter');
  }
  return parsed.data;
}
