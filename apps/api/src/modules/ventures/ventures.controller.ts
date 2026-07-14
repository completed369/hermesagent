import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VenturesService } from './ventures.service';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('ventures')
@Controller('ventures')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class VenturesController {
  constructor(private readonly venturesService: VenturesService) {}

  @Get()
  @RequirePermission('opportunity:view')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.venturesService.list(user.workspaceId);
  }
}
