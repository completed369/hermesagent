import { Module } from '@nestjs/common';
import { CeoSlackService } from './ceo-slack.service';
import { CeoController } from './ceo.controller';
import { AgentControlPlaneModule } from '../agent-control-plane/agent-control-plane.module';
import { CeoInstructionService } from './ceo-instruction.service';

@Module({
  imports: [AgentControlPlaneModule],
  providers: [CeoSlackService, CeoInstructionService],
  controllers: [CeoController],
})
export class CeoModule {}
