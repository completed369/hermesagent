import { prisma } from '@ventureos/database';
import { hashContent } from '@ventureos/security';
import { ContractNotFoundError, ResearchCostCapExceededError } from './errors.js';
import { fetchMockResearchResult } from './mock-adapter.js';
import { sanitizeUntrustedContent } from './prompt-injection-sanitizer.js';
import { computeFreshnessScore, computeReliabilityScore } from './evidence-scoring.js';
import {
  assertWithinResearchCostCaps,
  DEFAULT_RESEARCH_COST_CAPS,
  type ResearchCostCapConfig,
} from './cost-guard.js';
import { writeResearchConnectorHealth, slugifyContractName } from './health.js';

export interface RunDataAcquisitionParams {
  workspaceId: string;
  contractId: string;
  /** Test/security-proof hook only -- exercises the sanitizer against a
   * payload containing an embedded instruction, the way a poisoned
   * real-world page might. Never set from user input. */
  simulateInjectionAttempt?: boolean;
  costCapConfig?: ResearchCostCapConfig;
}

export interface RunDataAcquisitionResult {
  runId: string;
  status: string;
  evidenceArtifactId: string | null;
  promptInjectionFlagged: boolean;
  blockedReason: string | null;
}

const COLLECTION_METHOD_BY_SOURCE_TYPE: Record<string, string> = {
  OFFICIAL_API: 'API',
  FOUNDER_PROVIDED: 'FOUNDER_PROVIDED',
  PUBLIC_EXPORT: 'MANUAL_IMPORT',
  PERMITTED_BROWSER_RESEARCH: 'MANUAL_IMPORT',
  MANUAL_IMPORT: 'MANUAL_IMPORT',
};

/**
 * Executes one acquisition run for a DataAcquisitionContract. Fails closed:
 * a disabled contract, a rate-limit breach, or a cost-cap breach all block
 * the run *before* any (mock) provider call happens, and every outcome --
 * success or block -- is recorded as a real DataAcquisitionRun row, never
 * silently skipped. This mirrors the ProductGenerationBlockedError /
 * ListingGenerationBlockedError fail-closed pattern from Phase 4.
 *
 * On success: fetches the mock provider payload, runs it through the
 * prompt-injection sanitizer (Phase 5 deliverable #6), computes real
 * freshness/reliability scores (deliverable #3), persists a DataSource +
 * EvidenceArtifact, and writes a source-health row that surfaces in the
 * existing Integration Health UI (deliverable #5).
 */
export async function runDataAcquisition(
  params: RunDataAcquisitionParams,
): Promise<RunDataAcquisitionResult> {
  const contract = await prisma.dataAcquisitionContract.findFirst({
    where: { id: params.contractId, workspaceId: params.workspaceId },
  });
  if (!contract) throw new ContractNotFoundError('Data acquisition contract not found');

  const slug = slugifyContractName(contract.name);

  if (contract.disabled) {
    const blockedReason = contract.disabledReason ?? 'Contract is disabled (kill switch active).';
    const run = await prisma.dataAcquisitionRun.create({
      data: {
        workspaceId: params.workspaceId,
        contractId: contract.id,
        status: 'BLOCKED_DISABLED',
        completedAt: new Date(),
        blockedReason,
      },
    });
    await writeResearchConnectorHealth(params.workspaceId, slug, contract.sourceType, {
      healthy: false,
      message: blockedReason,
    });
    return {
      runId: run.id,
      status: run.status,
      evidenceArtifactId: null,
      promptInjectionFlagged: false,
      blockedReason,
    };
  }

  if (contract.rateLimitPerMinute != null) {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const recentCount = await prisma.dataAcquisitionRun.count({
      where: { contractId: contract.id, createdAt: { gte: oneMinuteAgo } },
    });
    if (recentCount >= contract.rateLimitPerMinute) {
      const blockedReason = `Rate limit of ${contract.rateLimitPerMinute} run(s)/minute reached.`;
      const run = await prisma.dataAcquisitionRun.create({
        data: {
          workspaceId: params.workspaceId,
          contractId: contract.id,
          status: 'BLOCKED_RATE_LIMIT',
          completedAt: new Date(),
          blockedReason,
        },
      });
      return {
        runId: run.id,
        status: run.status,
        evidenceArtifactId: null,
        promptInjectionFlagged: false,
        blockedReason,
      };
    }
  }

  const estimatedCostEur = Number(contract.costPerRunEurEstimate);
  try {
    await assertWithinResearchCostCaps(
      params.workspaceId,
      estimatedCostEur,
      params.costCapConfig ?? DEFAULT_RESEARCH_COST_CAPS,
    );
  } catch (err) {
    if (err instanceof ResearchCostCapExceededError) {
      const run = await prisma.dataAcquisitionRun.create({
        data: {
          workspaceId: params.workspaceId,
          contractId: contract.id,
          status: 'BLOCKED_COST_CAP',
          completedAt: new Date(),
          blockedReason: err.message,
        },
      });
      return {
        runId: run.id,
        status: run.status,
        evidenceArtifactId: null,
        promptInjectionFlagged: false,
        blockedReason: err.message,
      };
    }
    throw err;
  }

  const raw = fetchMockResearchResult(contract.name, params.simulateInjectionAttempt ?? false);
  const { sanitized, flagged, matches } = sanitizeUntrustedContent(raw.rawExcerpt);

  const retrievedAt = new Date();
  const freshnessScore = computeFreshnessScore({
    retrievedAt,
    freshnessRequirementHours: contract.freshnessRequirementHours,
  });
  const reliabilityScore = computeReliabilityScore({
    sourceType: contract.sourceType,
    promptInjectionFlagged: flagged,
    disabled: false,
  });

  let dataSource = await prisma.dataSource.findFirst({
    where: { dataAcquisitionContractId: contract.id },
  });
  if (!dataSource) {
    dataSource = await prisma.dataSource.create({
      data: {
        name: contract.name,
        sourceType: contract.sourceType,
        accessMethod: contract.accessMethod,
        dataAcquisitionContractId: contract.id,
      },
    });
  }

  const evidenceArtifact = await prisma.evidenceArtifact.create({
    data: {
      workspaceId: params.workspaceId,
      dataSourceId: dataSource.id,
      sourceName: contract.name,
      retrievedAt,
      collectionMethod: COLLECTION_METHOD_BY_SOURCE_TYPE[contract.sourceType] ?? 'MANUAL_IMPORT',
      collectionAgent: 'research-connectors:mock-adapter-v1',
      // NEVER the raw payload -- always the sanitized version, so a flagged
      // instruction-injection attempt can never reach an agent prompt or a
      // rendered UI verbatim.
      originalExcerpt: sanitized,
      reliabilityScore,
      freshnessScore,
      relevanceScore: 70,
      termsOfUseNote: contract.termsOfUseNote,
      personalDataClassification: contract.personalDataClassification,
      contentHash: hashContent(sanitized),
      processingHistory: [
        { step: 'mock_fetch', at: retrievedAt.toISOString() },
        { step: 'prompt_injection_sanitize', flagged, matches },
      ],
    },
  });

  const run = await prisma.dataAcquisitionRun.create({
    data: {
      workspaceId: params.workspaceId,
      contractId: contract.id,
      status: 'SUCCEEDED',
      completedAt: new Date(),
      costEur: estimatedCostEur,
      itemsRetrieved: raw.items.length,
      promptInjectionFlagged: flagged,
      promptInjectionMatches: matches,
      evidenceArtifactId: evidenceArtifact.id,
    },
  });

  await writeResearchConnectorHealth(params.workspaceId, slug, contract.sourceType, {
    healthy: true,
    message: `Last run succeeded, ${raw.items.length} item(s) retrieved${flagged ? ' (prompt-injection content flagged and sanitized)' : ''}.`,
  });

  return {
    runId: run.id,
    status: run.status,
    evidenceArtifactId: evidenceArtifact.id,
    promptInjectionFlagged: flagged,
    blockedReason: null,
  };
}
