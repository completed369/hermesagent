import { Module } from '@nestjs/common';
import { WorkspaceInvitationsController, WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { envProvider } from '../../config/env.provider';
import { AuditModule } from '../audit/audit.module';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';

@Module({
  imports: [AuditModule],
  controllers: [WorkspacesController, WorkspaceInvitationsController],
  providers: [WorkspacesService, envProvider, SessionAuthGuard, PermissionGuard],
})
export class WorkspacesModule {}
