import { prisma } from '@ventureos/database';

export interface MarketplaceHealthResult {
  healthy: boolean;
  message?: string;
}

/**
 * Surfaces marketplace connection/publication health through the existing
 * Integration model's UI slot (Command Centre "Integration status" table,
 * live since Phase 1) -- same reuse-not-reinvent pattern as Phase 5's
 * research-connector health writer. Unlike Phase 5 (which needed a
 * per-contract-slug key since many distinct sources can exist), this
 * updates the SAME `etsy` Integration row Phase 1 already seeds -- one
 * marketplace, one row, kept current as real (mock) publication activity
 * happens, rather than inventing a second row for the same integration.
 */
export async function writeMarketplaceHealth(
  workspaceId: string,
  marketplace: string,
  mode: string,
  result: MarketplaceHealthResult,
): Promise<void> {
  const provider = marketplace;
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
      writeEnabled: mode === 'REAL',
      status,
      lastHealthCheckAt: new Date(),
      lastHealthStatus,
    },
  });
}
