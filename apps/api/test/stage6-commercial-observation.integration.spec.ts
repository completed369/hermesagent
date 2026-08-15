import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ventureos/database';
import {
  CommercialObservationProvenanceError,
  ExperimentNotFoundError,
  createExperiment,
  getCommercialObservationProvenanceMap,
  recordExperimentResult,
  startExperiment,
} from '@ventureos/finance-engine';
import { cleanupEntitledTestWorkspace, entitleTestWorkspace } from './helpers/entitled-workspace';

describe('Stage 6 commercial observation provenance (integration)', () => {
  let workspace: { id: string };
  let otherWorkspace: { id: string };
  let actor: { id: string };
  let experiment: Awaited<ReturnType<typeof createExperiment>>;

  async function createProposal(workspaceId: string) {
    const opportunity = await prisma.opportunity.create({
      data: {
        workspaceId,
        title: `Observation provenance ${randomUUID()}`,
        description: 'Integration fixture',
        status: 'PROMOTED',
        suggestedProductType: 'DIGITAL_TEMPLATE_BUNDLE',
        suggestedMarketplace: 'etsy',
        latestOpportunityScore: 90,
        latestProfitConfidence: 90,
        isSpeculative: false,
        estimatedCostEur: 20,
        estimatedRevenueEur: 100,
        estimatedProfitEur: 80,
        risks: [],
      },
    });
    const proposal = await prisma.ventureProposal.create({
      data: { workspaceId, opportunityId: opportunity.id, status: 'DRAFT' },
    });
    await prisma.ventureProposalVersion.create({
      data: {
        ventureProposalId: proposal.id,
        opportunityId: opportunity.id,
        versionNumber: 1,
        snapshot: { fixture: true },
      },
    });
    return proposal.id;
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: { name: `Observation ${randomUUID()}`, slug: `observation-${randomUUID()}` },
    });
    otherWorkspace = await prisma.workspace.create({
      data: {
        name: `Observation Other ${randomUUID()}`,
        slug: `observation-other-${randomUUID()}`,
      },
    });
    await Promise.all([
      entitleTestWorkspace(workspace.id),
      entitleTestWorkspace(otherWorkspace.id),
    ]);
    actor = await prisma.user.create({
      data: {
        email: `observation-${randomUUID()}@ventureos.local`,
        displayName: 'Observation test actor',
      },
    });
    const proposalId = await createProposal(workspace.id);
    experiment = await createExperiment({
      workspaceId: workspace.id,
      ventureProposalId: proposalId,
      name: 'Stage 6 observation provenance',
      hypothesis: 'Commercial observations remain attributable.',
      variants: [{ name: 'Pilot', isControl: true }],
      metrics: [
        { name: 'SUPPORT_MINUTES', unit: 'minutes' },
        { name: 'CONVERSION_RATE', unit: '%' },
      ],
    });
    await startExperiment(workspace.id, experiment.id);
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({
      where: { workspaceId: { in: [workspace.id, otherWorkspace.id] } },
    });
    await cleanupEntitledTestWorkspace(workspace.id);
    await cleanupEntitledTestWorkspace(otherWorkspace.id);
    await prisma.workspace.deleteMany({ where: { id: { in: [workspace.id, otherWorkspace.id] } } });
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  it('fails safe to MOCK/SYNTHETIC when provenance is omitted', async () => {
    const result = await recordExperimentResult({
      workspaceId: workspace.id,
      experimentId: experiment.id,
      experimentVariantId: experiment.variants[0].id,
      experimentMetricId: experiment.metrics[0].id,
      value: 15,
      recordedBy: actor.id,
    });
    expect(result.provenance.evidenceMode).toBe('MOCK');
    expect(result.provenance.sourceType).toBe('SYNTHETIC');
    const map = await getCommercialObservationProvenanceMap([result.id]);
    expect(map.get(result.id)?.evidenceMode).toBe('MOCK');
    expect(map.get(result.id)?.recordedBy).toBe(actor.id);
  });

  it('persists attributable REAL commercial evidence', async () => {
    const observedAt = new Date('2026-08-15T10:00:00.000Z');
    const result = await recordExperimentResult({
      workspaceId: workspace.id,
      experimentId: experiment.id,
      experimentVariantId: experiment.variants[0].id,
      experimentMetricId: experiment.metrics[1].id,
      value: 3.2,
      evidenceMode: 'REAL',
      sourceType: 'MARKETPLACE_EXPORT',
      sourceRef: 'marketplace-export:test-batch-1',
      observedAt,
      recordedBy: actor.id,
    });
    expect(result.provenance).toMatchObject({
      evidenceMode: 'REAL',
      sourceType: 'MARKETPLACE_EXPORT',
      sourceRef: 'marketplace-export:test-batch-1',
      recordedBy: actor.id,
    });
    expect(result.provenance.observedAt.toISOString()).toBe(observedAt.toISOString());
  });

  it('rolls back a result when REAL provenance is invalid', async () => {
    const before = await prisma.experimentResult.count({
      where: { variant: { experimentId: experiment.id } },
    });
    await expect(
      recordExperimentResult({
        workspaceId: workspace.id,
        experimentId: experiment.id,
        experimentVariantId: experiment.variants[0].id,
        experimentMetricId: experiment.metrics[0].id,
        value: 9,
        evidenceMode: 'REAL',
        sourceType: 'SYNTHETIC',
        sourceRef: 'invalid',
        observedAt: new Date(),
        recordedBy: actor.id,
      }),
    ).rejects.toThrow(CommercialObservationProvenanceError);
    const after = await prisma.experimentResult.count({
      where: { variant: { experimentId: experiment.id } },
    });
    expect(after).toBe(before);
  });

  it('keeps experiment result writes workspace-scoped', async () => {
    await expect(
      recordExperimentResult({
        workspaceId: otherWorkspace.id,
        experimentId: experiment.id,
        experimentVariantId: experiment.variants[0].id,
        experimentMetricId: experiment.metrics[0].id,
        value: 1,
      }),
    ).rejects.toThrow(ExperimentNotFoundError);
  });
});
