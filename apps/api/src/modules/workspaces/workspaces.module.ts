import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { envProvider } from '../../config/env.provider';

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, envProvider],
})
export class WorkspacesModule {}
