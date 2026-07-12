import { Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';

@Injectable()
export class WorkspacesService {
  async getWorkspaceSummary(workspaceId: string) {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const memberCount = await prisma.workspaceMember.count({ where: { workspaceId } });
    const integrations = await prisma.integration.findMany({ where: { workspaceId } });
    return { workspace, memberCount, integrations };
  }
}
