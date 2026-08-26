import { Module } from '@nestjs/common';
import { WorkflowCentreController } from './workflow-centre.controller';
import { WorkflowCentreService } from './workflow-centre.service';

@Module({
  controllers: [WorkflowCentreController],
  providers: [WorkflowCentreService],
})
export class WorkflowCentreModule {}
