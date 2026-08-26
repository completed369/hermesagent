import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { WorkflowCentreService } from './workflow-centre.service';

@ApiTags('workflow-centre')
@Controller('workflow-centre')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class WorkflowCentreController {
  constructor(
    @Inject(WorkflowCentreService) private readonly workflowCentre: WorkflowCentreService,
  ) {}

  @Get()
  @RequirePermission('workflow:view')
  snapshot(@CurrentUser() user: AuthenticatedUser) {
    return this.workflowCentre.snapshot(user.workspaceId);
  }
}
