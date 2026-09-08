import { Module } from '@nestjs/common';
import { WorkflowCentreController } from './workflow-centre.controller';
import { WorkflowCentreService } from './workflow-centre.service';
import { WorkflowCentreTelemetryService } from './workflow-centre-telemetry.service';

@Module({
  controllers: [WorkflowCentreController],
  providers: [WorkflowCentreService, WorkflowCentreTelemetryService],
})
export class WorkflowCentreModule {}
