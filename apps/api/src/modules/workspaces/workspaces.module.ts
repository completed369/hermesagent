import { Module } from '@nestjs/common';
import { WorkspaceInvitationsController, WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { envProvider } from '../../config/env.provider';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [WorkspacesController, WorkspaceInvitationsController],
  providers: [WorkspacesService, envProvider],
})
export class WorkspacesModule {}
