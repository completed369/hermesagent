import {
  CapabilityFinalCheckBlockedError,
  dispatchWithWorkspaceCapability,
  enforceWorkspaceCapability,
  isCapabilityPolicyDeniedError,
  prisma,
  Prisma,
} from '@ventureos/database';
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
  /** Test/security-proof barrier only. Runs before the final contract, cost,
   * and capability revalidation; never populate from user input. */
  beforeFinalDispatch?: () => Promise<void> | void;
}

export interface RunDataAcquisitionResult {
  runId: string;
  status: string;
  evidenceArtifactId: string | null;
  promptInjectionFlagged: boolean;
  blockedReason: string | null;
}

class ResearchRateLimitBlockedError extends CapabilityFinalCheckBlockedError {
  override readonly name = 'ResearchRateLimitBlockedError';

  constructor(readonly result: RunDataAcquisitionResult) {
    super(result.blockedReason ?? 'Research rate limit reached');
  }
}

class ResearchCostCapBlockedError extends CapabilityFinalCheckBlockedError {
  override readonly name = 'ResearchCostCapBlockedError';

  constructor(readonly result: RunDataAcquisitionResult) {
    super(result.blockedReason ?? 'Research cost cap exhausted');
  }
}

const COLLECTION_METHOD_BY_SOURCE_TYPE: Record<string, string> = {
  OFFICIAL_API: 'API',
  FOUNDER_PROVIDED: 'FOUNDER_PROVIDED',
  PUBLIC_EXPORT: 'MANUAL_IMPORT',
  PERMITTED_BROWSER_RESEARCH: 'MANUAL_IMPORT',
  MANUAL_IMPORT: 'MANUAL_IMPORT',
};

const SUPPORTED_ACCESS_METHODS = new Set([
  'OFFICIAL_API',
  'PUBLIC_EXPORT',
  'FOUNDER_PROVIDED',
  'MANUAL_IMPORT',
]);

function isContractDispatchable(contract: {
  sourceType: string;
  accessMethod: string;
  allowedOperations: string[];
  failureHandling: string;
  disabled: boolean;
}): boolean {
  return (
    !contract.disabled &&
    contract.failureHandling === 'FAIL_CLOSED' &&
    Object.hasOwn(COLLECTION_METHOD_BY_SOURCE_TYPE, contract.sourceType) &&
    SUPPORTED_ACCESS_METHODS.has(contract.accessMethod) &&
    contract.allowedOperations.length > 0
  );
}

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
  await enforceWorkspaceCapability({
    workspaceId: params.workspaceId,
    capability: 'RESEARCH_RUN',
    stage: 'DISPATCH',
    providerMode: 'mock',
  });

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
      where: {
        contractId: contract.id,
        status: { in: ['RESERVED', 'SUCCEEDED', 'FAILED'] },
        createdAt: { gte: oneMinuteAgo },
      },
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

  let dispatchContract = contract;
  let reservedRunId: string | null = null;
  let raw;
  try {
    raw = await dispatchWithWorkspaceCapability(
      {
        workspaceId: params.workspaceId,
        capability: 'RESEARCH_RUN',
        stage: 'DISPATCH',
        providerMode: 'mock',
        beforeFinalCheck: async () => {
          await params.beforeFinalDispatch?.();
          const reservation = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "subscriptions" WHERE "workspaceId" = ${params.workspaceId}::uuid FOR UPDATE`,
            );
            const currentContract = await tx.dataAcquisitionContract.findFirst({
              where: { id: params.contractId, workspaceId: params.workspaceId },
            });
            if (
              !currentContract ||
              currentContract.workspaceId !== params.workspaceId ||
              !isContractDispatchable(currentContract)
            ) {
              throw new Error('Research contract is unavailable for dispatch');
            }
            if (currentContract.rateLimitPerMinute != null) {
              const recentCount = await tx.dataAcquisitionRun.count({
                where: {
                  contractId: currentContract.id,
                  status: { in: ['RESERVED', 'SUCCEEDED', 'FAILED'] },
                  createdAt: { gte: new Date(Date.now() - 60_000) },
                },
              });
              if (recentCount >= currentContract.rateLimitPerMinute) {
                const blockedReason = `Rate limit of ${currentContract.rateLimitPerMinute} run(s)/minute reached.`;
                const run = await tx.dataAcquisitionRun.create({
                  data: {
                    workspaceId: params.workspaceId,
                    contractId: currentContract.id,
                    status: 'BLOCKED_RATE_LIMIT',
                    completedAt: new Date(),
                    blockedReason,
                  },
                });
                return {
                  currentContract,
                  runId: null,
                  blockedResult: {
                    runId: run.id,
                    status: run.status,
                    evidenceArtifactId: null,
                    promptInjectionFlagged: false,
                    blockedReason,
                  } satisfies RunDataAcquisitionResult,
                };
              }
            }
            const estimatedCostEur = Number(currentContract.costPerRunEurEstimate);
            try {
              await assertWithinResearchCostCaps(
                params.workspaceId,
                estimatedCostEur,
                params.costCapConfig ?? DEFAULT_RESEARCH_COST_CAPS,
                tx,
              );
            } catch (error) {
              if (!(error instanceof ResearchCostCapExceededError)) throw error;
              const blockedReason = 'Research cost cap exhausted';
              const run = await tx.dataAcquisitionRun.create({
                data: {
                  workspaceId: params.workspaceId,
                  contractId: currentContract.id,
                  status: 'BLOCKED_COST_CAP',
                  completedAt: new Date(),
                  blockedReason,
                  costEur: 0,
                },
              });
              return {
                currentContract,
                runId: null,
                blockedResult: {
                  runId: run.id,
                  status: run.status,
                  evidenceArtifactId: null,
                  promptInjectionFlagged: false,
                  blockedReason,
                } satisfies RunDataAcquisitionResult,
              };
            }
            const run = await tx.dataAcquisitionRun.create({
              data: {
                workspaceId: params.workspaceId,
                contractId: currentContract.id,
                status: 'RESERVED',
                costEur: estimatedCostEur,
              },
            });
            return { currentContract, runId: run.id, blockedResult: null };
          });
          dispatchContract = reservation.currentContract;
          if (reservation.blockedResult) {
            if (reservation.blockedResult.status === 'BLOCKED_COST_CAP') {
              throw new ResearchCostCapBlockedError(reservation.blockedResult);
            }
            throw new ResearchRateLimitBlockedError(reservation.blockedResult);
          }
          reservedRunId = reservation.runId;
        },
      },
      () =>
        fetchMockResearchResult(dispatchContract.name, params.simulateInjectionAttempt ?? false),
    );
  } catch (error) {
    if (error instanceof ResearchRateLimitBlockedError) return error.result;
    if (error instanceof ResearchCostCapBlockedError) return error.result;
    if (reservedRunId) {
      const policyDenied = isCapabilityPolicyDeniedError(error);
      await prisma.dataAcquisitionRun.updateMany({
        where: { id: reservedRunId, status: 'RESERVED' },
        data: {
          status: policyDenied ? 'BLOCKED_POLICY' : 'FAILED',
          completedAt: new Date(),
          blockedReason: policyDenied
            ? 'Operation is not available'
            : 'Research provider operation failed',
        },
      });
    }
    throw error;
  }
  const validatedContract = dispatchContract;
  const validatedEstimatedCostEur = Number(validatedContract.costPerRunEurEstimate);
  const { sanitized, flagged, matches } = sanitizeUntrustedContent(raw.rawExcerpt);

  const retrievedAt = new Date();
  const freshnessScore = computeFreshnessScore({
    retrievedAt,
    freshnessRequirementHours: validatedContract.freshnessRequirementHours,
  });
  const reliabilityScore = computeReliabilityScore({
    sourceType: validatedContract.sourceType,
    promptInjectionFlagged: flagged,
    disabled: false,
  });

  if (!reservedRunId) throw new Error('Research run reservation is unavailable');
  let persisted: {
    evidenceArtifact: Awaited<ReturnType<typeof prisma.evidenceArtifact.create>>;
    run: Awaited<ReturnType<typeof prisma.dataAcquisitionRun.update>>;
  };
  try {
    persisted = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "data_acquisition_contracts" WHERE "id" = ${validatedContract.id}::uuid FOR UPDATE`,
      );
      let dataSource = await tx.dataSource.findFirst({
        where: { dataAcquisitionContractId: validatedContract.id },
      });
      if (!dataSource) {
        dataSource = await tx.dataSource.create({
          data: {
            name: validatedContract.name,
            sourceType: validatedContract.sourceType,
            accessMethod: validatedContract.accessMethod,
            dataAcquisitionContractId: validatedContract.id,
          },
        });
      }

      const evidenceArtifact = await tx.evidenceArtifact.create({
        data: {
          workspaceId: params.workspaceId,
          dataSourceId: dataSource.id,
          sourceName: validatedContract.name,
          retrievedAt,
          collectionMethod:
            COLLECTION_METHOD_BY_SOURCE_TYPE[validatedContract.sourceType] ?? 'MANUAL_IMPORT',
          collectionAgent: 'research-connectors:mock-adapter-v1',
          // NEVER the raw payload -- always the sanitized version, so a flagged
          // instruction-injection attempt can never reach an agent prompt or a
          // rendered UI verbatim.
          originalExcerpt: sanitized,
          reliabilityScore,
          freshnessScore,
          relevanceScore: 70,
          termsOfUseNote: validatedContract.termsOfUseNote,
          personalDataClassification: validatedContract.personalDataClassification,
          contentHash: hashContent(sanitized),
          processingHistory: [
            { step: 'mock_fetch', at: retrievedAt.toISOString() },
            { step: 'prompt_injection_sanitize', flagged, matches },
          ],
        },
      });

      const run = await tx.dataAcquisitionRun.update({
        where: { id: reservedRunId! },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          costEur: validatedEstimatedCostEur,
          itemsRetrieved: raw.items.length,
          promptInjectionFlagged: flagged,
          promptInjectionMatches: matches,
          evidenceArtifactId: evidenceArtifact.id,
        },
      });
      return { evidenceArtifact, run };
    });
  } catch (error) {
    await prisma.dataAcquisitionRun.updateMany({
      where: { id: reservedRunId, status: 'RESERVED' },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        blockedReason: 'Research result persistence failed',
      },
    });
    throw error;
  }
  const { evidenceArtifact, run } = persisted;

  await writeResearchConnectorHealth(
    params.workspaceId,
    slugifyContractName(validatedContract.name),
    validatedContract.sourceType,
    {
      healthy: true,
      message: `Last run succeeded, ${raw.items.length} item(s) retrieved${flagged ? ' (prompt-injection content flagged and sanitized)' : ''}.`,
    },
  );

  return {
    runId: run.id,
    status: run.status,
    evidenceArtifactId: evidenceArtifact.id,
    promptInjectionFlagged: flagged,
    blockedReason: null,
  };
}
