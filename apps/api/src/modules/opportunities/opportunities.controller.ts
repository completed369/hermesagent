import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OpportunitiesService } from './opportunities.service';
import {
  createOpportunitySchema,
  rejectOpportunitySchema,
  rescoreOpportunitySchema,
} from './opportunities.dto';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('opportunities')
@Controller('opportunities')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Get()
  @RequirePermission('opportunity:view')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.opportunitiesService.list(user.workspaceId);
  }

  @Post()
  @RequirePermission('opportunity:manage')
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = createOpportunitySchema.parse(body);
    return this.opportunitiesService.create(user.workspaceId, input, user.userId);
  }

  @Get(':id')
  @RequirePermission('opportunity:view')
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opportunitiesService.getById(user.workspaceId, id);
  }

  @Post(':id/rescore')
  @RequirePermission('opportunity:manage')
  rescore(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = rescoreOpportunitySchema.parse(body);
    return this.opportunitiesService.rescore(user.workspaceId, id, input, user.userId);
  }

  @Post(':id/reject')
  @RequirePermission('opportunity:manage')
  reject(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = rejectOpportunitySchema.parse(body);
    return this.opportunitiesService.reject(user.workspaceId, id, input.reason, user.userId);
  }

  @Post(':id/archive')
  @RequirePermission('opportunity:manage')
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opportunitiesService.archive(user.workspaceId, id, user.userId);
  }

  @Post(':id/promote')
  @RequirePermission('opportunity:manage')
  promote(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opportunitiesService.promote(user.workspaceId, id, user.userId);
  }
}
