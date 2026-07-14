import { prisma } from '@ventureos/database';

export interface ResearchConnectorHealthResult {
  healthy: boolean;
  message?: string;
}

/**
 * Phase 5 deliverable #5: source health monitoring, surfaced through the
 * Integration model's existing UI slot (Command Centre's "Integration
 * status" table, live since Phase 1) -- no new UI table needed. Every
 * DataAcquisitionContract gets an Integration row keyed by
 * `research:<slug>` so it shows up next to minio/etsy/ai-mock exactly like
 * any other integration.
 */
export async function writeResearchConnectorHealth(
  workspaceId: string,
  contractSlug: string,
  mode: string,
  result: ResearchConnectorHealthResult,
): Promise<void> {
  const provider = `research:${contractSlug}`;
  const status = result.healthy ? 'CONNECTED' : 'ERROR';
  const lastHealthStatus = result.message ?? (result.healthy ? 'ok' : 'unhealthy');

  await prisma.integration.upsert({
    where: { workspaceId_provider: { workspaceId, provider } },
    update: {
      mode,
      status,
      lastHealthCheckAt: new Date(),
      lastHealthStatus,
    },
    create: {
      workspaceId,
      provider,
      mode,
      writeEnabled: false,
      status,
      lastHealthCheckAt: new Date(),
      lastHealthStatus,
    },
  });
}

export function slugifyContractName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
