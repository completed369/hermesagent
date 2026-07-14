import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, Prisma } from '@ventureos/database';
import { runDataAcquisition, ContractNotFoundError } from '@ventureos/research-connectors';
import { AuditService } from '../audit/audit.service';

const CONTRACT_LIST_INCLUDE = {
  runs: { orderBy: { createdAt: 'desc' }, take: 5 },
} satisfies Prisma.DataAcquisitionContractInclude;

const CONTRACT_DETAIL_INCLUDE = {
  runs: { orderBy: { createdAt: 'desc' } },
  dataSources: {
    include: { evidenceArtifacts: { orderBy: { retrievedAt: 'desc' } } },
  },
} satisfies Prisma.DataAcquisitionContractInclude;

/**
 * Lists/reads DataAcquisitionContracts and triggers acquisition runs. Unlike
 * board review / product generation, an acquisition run is a fast,
 * deterministic mock-provider call with no founder-approval signal-wait, so
 * it runs synchronously in this request rather than through a Temporal
 * workflow (same reasoning as OpportunitiesService.promote() -- a real state
 * change, but not a durable long-running process). The actual acquisition
 * logic (fail-closed gates, sanitisation, scoring, health write) lives in
 * @ventureos/research-connectors, never inline here.
 */
@Injectable()
export class ResearchService {
  constructor(private readonly auditService: AuditService) {}

  async listContracts(workspaceId: string) {
    return prisma.dataAcquisitionContract.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      include: CONTRACT_LIST_INCLUDE,
    });
  }

  async getContract(workspaceId: string, id: string) {
    const contract = await prisma.dataAcquisitionContract.findFirst({
      where: { id, workspaceId },
      include: CONTRACT_DETAIL_INCLUDE,
    });
    if (!contract) {
      throw new NotFoundException('Data acquisition contract not found');
    }
    return contract;
  }

  async triggerRun(workspaceId: string, contractId: string, actorId: string) {
    try {
      const result = await runDataAcquisition({ workspaceId, contractId });

      await this.auditService.record(workspaceId, {
        actorId,
        action: 'DATA_ACQUISITION_RUN',
        entityType: 'DataAcquisitionContract',
        entityId: contractId,
        after: result as unknown as Record<string, unknown>,
      });

      return result;
    } catch (err) {
      if (err instanceof ContractNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
