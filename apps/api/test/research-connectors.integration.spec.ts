import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import { runDataAcquisition, ContractNotFoundError } from '@ventureos/research-connectors';
import { cleanupEntitledTestWorkspace, entitleTestWorkspace } from './helpers/entitled-workspace';

/**
 * Hits a real (dockerized) Postgres, same approach as
 * product-and-listing.integration.spec.ts and board-and-approval.integration.spec.ts
 * -- calls the plain research-connectors function directly (no Temporal
 * workflow exists for Phase 5; acquisition runs are synchronous mock-provider
 * calls, see ResearchService's doc comment). Exercises every fail-closed
 * gate for real: disabled contract, rate limit, cost cap, plus the
 * prompt-injection security proof against a real persisted EvidenceArtifact
 * row (not just the pure sanitizer in isolation, already unit-tested in
 * packages/research-connectors).
 */
describe('Research connector acquisition runs (integration)', () => {
  let workspace: { id: string };

  const contractIds: string[] = [];

  async function createContract(overrides: Partial<Record<string, unknown>> = {}) {
    const contract = await prisma.dataAcquisitionContract.create({
      data: {
        workspaceId: workspace.id,
        name: `Test Contract ${randomUUID()}`,
        purpose: 'Created by research-connectors.integration.spec.ts',
        sourceType: 'PERMITTED_BROWSER_RESEARCH',
        accessMethod: 'MANUAL_IMPORT',
        allowedOperations: ['READ_PUBLIC_LISTING_TITLE'],
        freshnessRequirementHours: 24,
        ...overrides,
      },
    });
    contractIds.push(contract.id);
    return contract;
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: `Test Workspace ${randomUUID()}`,
        slug: `test-research-${randomUUID()}`,
      },
    });
    await entitleTestWorkspace(workspace.id);
  });

  afterAll(async () => {
    const evidenceArtifactIds = (
      await prisma.evidenceArtifact.findMany({
        where: { workspaceId: workspace.id },
        select: { id: true },
      })
    ).map((e) => e.id);
    await prisma.evidenceClaim.deleteMany({
      where: { evidenceArtifactId: { in: evidenceArtifactIds } },
    });
    await prisma.evidenceArtifact.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.dataSource.deleteMany({
      where: { dataAcquisitionContractId: { in: contractIds } },
    });
    await prisma.dataAcquisitionRun.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.integration.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.dataAcquisitionContract.deleteMany({ where: { id: { in: contractIds } } });
    await cleanupEntitledTestWorkspace(workspace.id);
    await prisma.workspace.deleteMany({ where: { id: workspace.id } });
    await prisma.$disconnect();
  });

  it('throws ContractNotFoundError for an unknown contract id', async () => {
    await expect(
      runDataAcquisition({ workspaceId: workspace.id, contractId: randomUUID() }),
    ).rejects.toThrow(ContractNotFoundError);
  });

  it('fails closed with BLOCKED_DISABLED and writes an ERROR Integration health row for a disabled contract', async () => {
    const contract = await createContract({
      name: 'Disabled Test Contract',
      disabled: true,
      disabledReason: 'Turned off for this test',
    });

    const result = await runDataAcquisition({ workspaceId: workspace.id, contractId: contract.id });
    expect(result.status).toBe('BLOCKED_DISABLED');
    expect(result.evidenceArtifactId).toBeNull();
    expect(result.blockedReason).toContain('Turned off for this test');

    const run = await prisma.dataAcquisitionRun.findUnique({ where: { id: result.runId } });
    expect(run?.status).toBe('BLOCKED_DISABLED');

    const integration = await prisma.integration.findFirst({
      where: { workspaceId: workspace.id, provider: `research:disabled-test-contract` },
    });
    expect(integration?.status).toBe('ERROR');
  });

  it('fails closed with BLOCKED_RATE_LIMIT once the per-minute rate limit is reached', async () => {
    const contract = await createContract({
      name: `Rate Limited Contract ${randomUUID()}`,
      rateLimitPerMinute: 1,
    });

    const first = await runDataAcquisition({ workspaceId: workspace.id, contractId: contract.id });
    expect(first.status).toBe('SUCCEEDED');

    const second = await runDataAcquisition({ workspaceId: workspace.id, contractId: contract.id });
    expect(second.status).toBe('BLOCKED_RATE_LIMIT');
    expect(second.blockedReason).toContain('Rate limit');
  });

  it('fails closed with BLOCKED_COST_CAP when the estimated cost exceeds the per-run cap', async () => {
    const contract = await createContract({
      name: `Cost Capped Contract ${randomUUID()}`,
      costPerRunEurEstimate: 5,
    });

    const result = await runDataAcquisition({
      workspaceId: workspace.id,
      contractId: contract.id,
      costCapConfig: { perRunLimitEur: 1, perWorkspaceDayLimitEur: 10 },
    });
    expect(result.status).toBe('BLOCKED_COST_CAP');
    expect(result.blockedReason).toMatch(/exceeds the per-run cap/);
  });

  it('succeeds, persists a real EvidenceArtifact with computed freshness/reliability, and writes CONNECTED health', async () => {
    const contract = await createContract({ name: `Healthy Contract ${randomUUID()}` });

    const result = await runDataAcquisition({ workspaceId: workspace.id, contractId: contract.id });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.evidenceArtifactId).toBeTruthy();
    expect(result.promptInjectionFlagged).toBe(false);

    const artifact = await prisma.evidenceArtifact.findUnique({
      where: { id: result.evidenceArtifactId! },
    });
    expect(artifact).toBeTruthy();
    expect(artifact!.freshnessScore).toBe(100); // just retrieved
    expect(artifact!.reliabilityScore).toBeGreaterThan(0);
    expect(artifact!.contentHash).toHaveLength(64); // sha256 hex

    const dataSource = await prisma.dataSource.findFirst({
      where: { dataAcquisitionContractId: contract.id },
    });
    expect(dataSource).toBeTruthy();

    const run = await prisma.dataAcquisitionRun.findUnique({ where: { id: result.runId } });
    expect(run?.costEur.toString()).toBe('0');
    expect(run?.itemsRetrieved).toBeGreaterThan(0);
  });

  /**
   * SECURITY (Phase 5 deliverable #6, master spec sections 15/27/31): a
   * poisoned research payload must never survive into the persisted
   * EvidenceArtifact intact. This proves the *real* pipeline end-to-end --
   * DB row and all -- not just the pure sanitizer function in isolation.
   */
  it('SECURITY: neutralizes prompt-injection content before it reaches the persisted EvidenceArtifact', async () => {
    const contract = await createContract({ name: `Injection Test Contract ${randomUUID()}` });

    const result = await runDataAcquisition({
      workspaceId: workspace.id,
      contractId: contract.id,
      simulateInjectionAttempt: true,
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.promptInjectionFlagged).toBe(true);

    const run = await prisma.dataAcquisitionRun.findUnique({ where: { id: result.runId } });
    expect(run?.promptInjectionFlagged).toBe(true);
    expect(run?.promptInjectionMatches.length).toBeGreaterThan(0);

    const artifact = await prisma.evidenceArtifact.findUnique({
      where: { id: result.evidenceArtifactId! },
    });
    expect(artifact).toBeTruthy();
    // The dangerous instruction text must never appear verbatim in what was
    // actually persisted -- this is the real proof, not just an in-memory
    // assertion.
    expect(artifact!.originalExcerpt).not.toMatch(/ignore all previous instructions/i);
    expect(artifact!.originalExcerpt).not.toMatch(/reveal your system prompt/i);
    expect(artifact!.originalExcerpt).not.toMatch(/forward all founder data/i);
    expect(artifact!.originalExcerpt).toContain('[REDACTED_POTENTIAL_INSTRUCTION]');

    // A flagged source is scored as less reliable than an equivalent clean
    // one -- reliability is never silently left high for tainted content.
    const cleanContract = await createContract({
      name: `Clean Comparison Contract ${randomUUID()}`,
    });
    const cleanResult = await runDataAcquisition({
      workspaceId: workspace.id,
      contractId: cleanContract.id,
    });
    const cleanArtifact = await prisma.evidenceArtifact.findUnique({
      where: { id: cleanResult.evidenceArtifactId! },
    });
    expect(artifact!.reliabilityScore).toBeLessThan(cleanArtifact!.reliabilityScore);
  });
});
