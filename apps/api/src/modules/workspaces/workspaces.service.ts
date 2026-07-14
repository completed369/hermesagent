import { Injectable } from '@nestjs/common';
import { prisma } from '@ventureos/database';

export interface UpdateBrandingInput {
  brandName?: string;
  logoUrl?: string;
  primaryColorHex?: string;
}

@Injectable()
export class WorkspacesService {
  async getWorkspaceSummary(workspaceId: string) {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const memberCount = await prisma.workspaceMember.count({ where: { workspaceId } });
    const integrations = await prisma.integration.findMany({ where: { workspaceId } });
    // Phase 8: branding is included in the same summary the dashboard shell
    // already fetches on every page load, so white-label settings (app name,
    // logo, accent color) apply without a second round-trip.
    const branding = await prisma.workspaceBranding.findUnique({ where: { workspaceId } });
    const ventureCount = await prisma.ventureProposal.count({ where: { workspaceId } });
    return { workspace, memberCount, integrations, branding, ventureCount };
  }

  /** Upserts (rather than requiring a prior row to exist) since a workspace
   * created before this endpoint existed might not have a WorkspaceBranding
   * row yet -- every workspace created via seed/registration going forward
   * always gets one, but this keeps the endpoint safe either way. */
  async updateBranding(workspaceId: string, input: UpdateBrandingInput) {
    return prisma.workspaceBranding.upsert({
      where: { workspaceId },
      update: input,
      create: { workspaceId, ...input },
    });
  }
}
