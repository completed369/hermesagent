import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ResearchService } from './research.service';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('research')
@Controller('research')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ResearchController {
  constructor(private readonly researchService: ResearchService) {}

  @Get('contracts')
  @RequirePermission('research:view')
  listContracts(@CurrentUser() user: AuthenticatedUser) {
    return this.researchService.listContracts(user.workspaceId);
  }

  @Get('contracts/:id')
  @RequirePermission('research:view')
  getContract(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.researchService.getContract(user.workspaceId, id);
  }

  @Post('contracts/:id/run')
  @RequirePermission('research:manage')
  triggerRun(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.researchService.triggerRun(user.workspaceId, id, user.userId);
  }
}
