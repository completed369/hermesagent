import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SecurityService } from './security.service';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('security')
@Controller('security-events')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get()
  @RequirePermission('audit:view')
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.securityService.list(user.workspaceId, limit ? Number(limit) : undefined);
  }
}
