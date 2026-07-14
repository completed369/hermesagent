import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { updateBrandingSchema } from './workspaces.dto';
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
}
