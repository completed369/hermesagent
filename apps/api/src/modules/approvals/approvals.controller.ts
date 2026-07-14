import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApprovalsService } from './approvals.service';
import { decideApprovalSchema } from './approvals.dto';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('approvals')
@Controller('approval-requests')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get()
  @RequirePermission('approval:view')
  list(
    @Query('ventureProposalId') ventureProposalId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvalsService.list(user.workspaceId, ventureProposalId);
  }

  @Get(':id')
  @RequirePermission('approval:view')
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.approvalsService.getById(user.workspaceId, id);
  }

  @Post(':id/decide')
  @RequirePermission('approval:decide')
  decide(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = decideApprovalSchema.parse(body);
    return this.approvalsService.decide(user.workspaceId, id, input, user.userId);
  }
}
