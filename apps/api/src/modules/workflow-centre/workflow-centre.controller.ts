import { Controller, Get, Header, Headers, Inject, Sse, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { WorkflowCentreService } from './workflow-centre.service';
import { WorkflowCentreTelemetryService } from './workflow-centre-telemetry.service';

@ApiTags('workflow-centre')
@Controller('workflow-centre')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class WorkflowCentreController {
  constructor(
    @Inject(WorkflowCentreService) private readonly workflowCentre: WorkflowCentreService,
    @Inject(WorkflowCentreTelemetryService)
    private readonly telemetry: WorkflowCentreTelemetryService,
  ) {}

  @Get()
  @RequirePermission('workflow:view')
  snapshot(@CurrentUser() user: AuthenticatedUser) {
    return this.workflowCentre.snapshot(user.workspaceId);
  }

  @Sse('telemetry')
  @Header('Cache-Control', 'no-store, no-transform')
  @Header('X-Accel-Buffering', 'no')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermission('workflow:view')
  streamTelemetry(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('last-event-id') lastEventId?: string | string[],
  ) {
    return this.telemetry.stream(user.workspaceId, lastEventId);
  }
}
