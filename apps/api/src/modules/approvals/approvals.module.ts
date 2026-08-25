import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { AuditModule } from '../audit/audit.module';
import { AcpApprovalBridgeService } from './acp-approval-bridge.service';
import { AgentControlPlaneModule } from '../agent-control-plane/agent-control-plane.module';

@Module({
  imports: [AgentControlPlaneModule, AuditModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, AcpApprovalBridgeService],
  exports: [AcpApprovalBridgeService],
})
export class ApprovalsModule {}
