import { Prisma, prisma } from '@ventureos/database';
import type { Experiment, ExperimentDecision, ExperimentResult } from '@ventureos/database';
import { isApprovalValidForExecution } from '@ventureos/contracts';
import { hashScaleDecisionArtifact } from '@ventureos/security';
import { ExperimentInvalidStateError, ExperimentNotFoundError } from './errors.js';
import { enforceFinanceMutation } from './capability-guard.js';
import {
  getCommercialObservationProvenanceMap,
  persistCommercialObservationProvenance,
  type CommercialObservationEvidenceMode,
  type CommercialObservationProvenance,
  type CommercialObservationSourceType,
} from './commercial-observation-provenance.js';

export interface CreateExperimentParams {
  workspaceId: string;
  ventureProposalId: string;
  listingVersionId?: string;
  name: string;
  hypothesis: string;
  variants: { name: string; description?: string; isControl?: boolean }[];
  metrics: { name: string; targetValue?: number; unit?: string }[];
}

/** Master spec section 30 Gate 5/6: a controlled test with named variants
 * and the metrics that will decide its outcome, defined up front -- never
 * invented after the fact to justify a result. */
export async function createExperiment(params: CreateExperimentParams): Promise<Experiment> {
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.ventureProposal.findFirst({
      where: { id: params.ventureProposalId, workspaceId: params.workspaceId },
      select: { id: true },
    });
    if (!proposal) throw new ExperimentNotFoundError('Venture proposal not found');
    if (params.listingVersionId) {
      const listingVersion = await tx.listingVersion.findFirst({
        where: { id: params.listingVersionId, listing: { workspaceId: params.workspaceId } },
        select: { id: true },
      });
      if (!listingVersion) throw new ExperimentNotFoundError('Listing version not found');
    }

    await enforceFinanceMutation(
      params.workspaceId,
      `finance:experiment:create:${params.ventureProposalId}`,
      tx,
    );
    return tx.experiment.create({
      data: {
        workspaceId: params.workspaceId,
        ventureProposalId: params.ventureProposalId,
        listingVersionId: params.listingVersionId,
        name: params.name,
        hypothesis: params.hypothesis,
        status: 'DRAFT',
        variants: {
          create: params.variants.map((v) => ({
            name: v.name,
            description: v.description,
            isControl: v.isControl ?? false,
          })),
        },
        metrics: {
          create: params.metrics.map((m) => ({
            name: m.name,
            targetValue: m.targetValue,
            unit: m.unit,
          })),
        },
      },
      include: { variants: true, metrics: true },
    });
  });
}

export async function startExperiment(
  workspaceId: string,
  experimentId: string,
): Promise<Experiment> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "experiments" WHERE "id" = ${experimentId}::uuid AND "workspaceId" = ${workspaceId}::uuid FOR UPDATE`,
    );
    const experiment = await tx.experiment.findFirst({
      where: { id: experimentId, workspaceId },
    });
    if (!experiment) throw new ExperimentNotFoundError('Experiment not found');
    if (experiment.status !== 'DRAFT') {
      throw new ExperimentInvalidStateError(`Experiment is already ${experiment.status}`);
    }
    await enforceFinanceMutation(workspaceId, `finance:experiment:start:${experimentId}`, tx);
    const updated = await tx.experiment.updateMany({
      where: { id: experimentId, workspaceId, status: 'DRAFT' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new ExperimentInvalidStateError('Experiment is no longer DRAFT');
    }
    return tx.experiment.findUniqueOrThrow({ where: { id: experimentId } });
  });
}

export interface RecordExperimentResultParams {
  workspaceId: string;
  experimentId: string;
  experimentVariantId: string;
  experimentMetricId: string;
  value: number;
  sampleSize?: number;
  evidenceMode?: CommercialObservationEvidenceMode;
  sourceType?: CommercialObservationSourceType;
  sourceRef?: string;
  observedAt?: Date;
  recordedBy?: string;
}

/** A single measurement with explicit evidence provenance. Multiple calls per
 * variant/metric pair are expected as the experiment runs, never overwritten
 * in place. Unspecified/legacy measurements fail safe to MOCK/SYNTHETIC. */
export async function recordExperimentResult(
  params: RecordExperimentResultParams,
): Promise<ExperimentResult & { provenance: CommercialObservationProvenance }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "experiments" WHERE "id" = ${params.experimentId}::uuid AND "workspaceId" = ${params.workspaceId}::uuid FOR UPDATE`,
    );
    const variant = await tx.experimentVariant.findFirst({
      where: { id: params.experimentVariantId },
      include: { experiment: true },
    });
    if (
      !variant ||
      variant.experiment.workspaceId !== params.workspaceId ||
      variant.experimentId !== params.experimentId
    ) {
      throw new ExperimentNotFoundError('Experiment variant not found');
    }
    if (variant.experiment.status !== 'RUNNING') {
      throw new ExperimentInvalidStateError(
        `Experiment results require RUNNING status (current: ${variant.experiment.status})`,
      );
    }
    const metric = await tx.experimentMetric.findFirst({
      where: { id: params.experimentMetricId, experimentId: variant.experimentId },
    });
    if (!metric) throw new ExperimentNotFoundError('Experiment metric not found');
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:experiment-result:${params.experimentId}`,
      tx,
    );
    const result = await tx.experimentResult.create({
      data: {
        experimentVariantId: params.experimentVariantId,
        experimentMetricId: params.experimentMetricId,
        value: params.value,
        sampleSize: params.sampleSize,
      },
    });
    const provenance = await persistCommercialObservationProvenance(tx, result.id, {
      evidenceMode: params.evidenceMode,
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
      observedAt: params.observedAt,
      recordedBy: params.recordedBy,
    });
    return { ...result, provenance };
  });
}

async function withCommercialObservationProvenance<
  T extends { variants: Array<{ results: Array<{ id: string }> }> },
>(experiment: T, db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma) {
  const provenanceByResultId = await getCommercialObservationProvenanceMap(
    experiment.variants.flatMap((variant) => variant.results.map((result) => result.id)),
    db,
  );
  return {
    ...experiment,
    variants: experiment.variants.map((variant) => ({
      ...variant,
      results: variant.results.map((result) => ({
        ...result,
        provenance: provenanceByResultId.get(result.id) ?? null,
      })),
    })),
  };
}

export interface RequestScaleDecisionApprovalParams {
  workspaceId: string;
  experimentId: string;
  requestedBy: string;
  expiresInHours?: number;
  workflowId?: string;
}

/**
 * Gate 6 (master spec section 30): increasing ad spend on the strength of an
 * experiment's results requires the same explicit founder-approval gate as
 * every other irreversible/costed action in this system -- never an
 * automatic "the numbers look good, so scale" action. Uses the SAME
 * `ApprovalRequest`/`decideApprovalRequest` machinery Phases 3/4/6 already
 * use (kind: 'SCALE_DECISION'). The approval hash binds both the current
 * proposal version and the exact experiment definition/results so evidence
 * appended after the request or decision invalidates execution.
 */
export async function requestScaleDecisionApproval(
  params: RequestScaleDecisionApprovalParams,
): Promise<{ approvalRequestId: string }> {
  await enforceFinanceMutation(params.workspaceId, `finance:scale-approval:${params.experimentId}`);

  const experiment = await prisma.experiment.findFirst({
    where: { id: params.experimentId, workspaceId: params.workspaceId },
    include: { variants: { include: { results: true } }, metrics: true },
  });
  if (!experiment) throw new ExperimentNotFoundError('Experiment not found');
  const experimentForApprovalHash = await withCommercialObservationProvenance(experiment);
  if (experiment.status !== 'RUNNING' && experiment.status !== 'COMPLETED') {
    throw new ExperimentInvalidStateError(
      `Experiment must be RUNNING or COMPLETED to request a scale decision (current: ${experiment.status})`,
    );
  }

  const existingPending = await prisma.approvalRequest.findFirst({
    where: {
      workspaceId: params.workspaceId,
      kind: 'SCALE_DECISION',
      experimentId: params.experimentId,
      state: 'PENDING',
    },
  });
  if (existingPending) return { approvalRequestId: existingPending.id };

  // Experiment.ventureProposalId is a loose reference (no Prisma relation
  // declared on either side, same pattern as DataAcquisitionRun's
  // evidenceArtifactId) -- fetched as a separate query rather than via
  // `include`.
  const proposal = await prisma.ventureProposal.findFirst({
    where: { id: experiment.ventureProposalId, workspaceId: params.workspaceId },
    include: {
      opportunity: true,
      versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 },
    },
  });
  if (!proposal) throw new ExperimentNotFoundError('Venture proposal not found');
  const latestVersion = proposal.versions[0];
  if (!latestVersion) throw new ExperimentNotFoundError('Venture proposal has no versions');
  const opportunity = proposal.opportunity;

  const packageHash = hashScaleDecisionArtifact({
    proposalVersionId: latestVersion.id,
    proposalSnapshot: latestVersion.snapshot,
    experiment: experimentForApprovalHash,
  });

  const expiresAt = new Date(Date.now() + (params.expiresInHours ?? 168) * 60 * 60 * 1000);

  const approvalRequest = await prisma.$transaction(async (tx) => {
    await enforceFinanceMutation(
      params.workspaceId,
      `finance:scale-approval:${params.experimentId}`,
      tx,
    );
    return tx.approvalRequest.create({
      data: {
        workspaceId: params.workspaceId,
        ventureProposalId: proposal.id,
        ventureProposalVersionId: latestVersion.id,
        kind: 'SCALE_DECISION',
        experimentId: experiment.id,
        requestedAction: `Increase ad spend for experiment "${experiment.name}"`,
        explanation:
          'Experiment results are ready for a scale decision. Founder approval is required before ad spend may be increased -- Gate 6 per master spec section 30.',
        affectedResources: [`Experiment:${experiment.id}`, `VentureProposal:${proposal.id}`],
        packageHash,
        estimatedCostEur: opportunity.estimatedCostEur ?? 0,
        maxAuthorizedCostEur: opportunity.estimatedCostEur ?? 0,
        reversible: false,
        risks: [
          ...opportunity.risks,
          'Increasing ad spend on an experiment that may not generalize.',
        ],
        evidenceIds: [],
        state: 'PENDING',
        requestedBy: params.requestedBy,
        workflowId: params.workflowId,
        expiresAt,
      },
    });
  });

  return { approvalRequestId: approvalRequest.id };
}

export interface RecordExperimentDecisionParams {
  workspaceId: string;
  experimentId: string;
  decision: 'SCALE' | 'KILL' | 'ITERATE' | 'HOLD';
  rationale: string;
  decidedBy: string;
  /** Required for SCALE -- must reference an APPROVED SCALE_DECISION
   * ApprovalRequest for this exact experiment (Gate 6). KILL/ITERATE/HOLD
   * never increase spend, so no approval gate applies to them. */
  approvalRequestId?: string;
}

export async function recordExperimentDecision(
  params: RecordExperimentDecisionParams,
): Promise<ExperimentDecision> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "experiments" WHERE "id" = ${params.experimentId}::uuid AND "workspaceId" = ${params.workspaceId}::uuid FOR UPDATE`,
    );
    const experiment = await tx.experiment.findFirst({
      where: { id: params.experimentId, workspaceId: params.workspaceId },
      include: { variants: { include: { results: true } }, metrics: true },
    });
    if (!experiment) throw new ExperimentNotFoundError('Experiment not found');
    if (experiment.status === 'DECIDED') {
      throw new ExperimentInvalidStateError('Experiment has already been decided');
    }

    await enforceFinanceMutation(
      params.workspaceId,
      `finance:experiment-decision:${params.experimentId}`,
      tx,
    );

    if (params.decision === 'SCALE') {
      if (!params.approvalRequestId) {
        throw new ExperimentInvalidStateError(
          'A SCALE decision requires an approved SCALE_DECISION approvalRequestId (Gate 6)',
        );
      }
      const approval = await tx.approvalRequest.findFirst({
        where: {
          id: params.approvalRequestId,
          workspaceId: params.workspaceId,
          ventureProposalId: experiment.ventureProposalId,
          kind: 'SCALE_DECISION',
          experimentId: params.experimentId,
        },
        include: {
          decisions: {
            where: { decision: { in: ['APPROVE', 'APPROVE_WITH_CONDITIONS'] } },
            orderBy: { decidedAt: 'desc' },
            take: 1,
          },
        },
      });
      if (!approval) {
        throw new ExperimentInvalidStateError('Scale-decision approval request not found');
      }
      if (approval.state !== 'APPROVED' && approval.state !== 'APPROVED_WITH_CONDITIONS') {
        throw new ExperimentInvalidStateError(
          `Scale-decision approval is not approved (state: ${approval.state}) -- Gate 6 blocks scaling until it is.`,
        );
      }
      const decision = approval.decisions[0];
      if (!decision) {
        throw new ExperimentInvalidStateError(
          'Scale-decision approval has no approving decision evidence',
        );
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "venture_proposals" WHERE "id" = ${experiment.ventureProposalId}::uuid AND "workspaceId" = ${params.workspaceId}::uuid FOR UPDATE`,
      );
      const proposal = await tx.ventureProposal.findFirst({
        where: { id: experiment.ventureProposalId, workspaceId: params.workspaceId },
        include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      });
      const currentVersion = proposal?.versions[0];
      if (!currentVersion) {
        throw new ExperimentInvalidStateError('Scale-decision approval artifact is unavailable');
      }
      const experimentForApprovalHash = await withCommercialObservationProvenance(experiment, tx);
      const validity = isApprovalValidForExecution(
        {
          approvedArtifactVersionId: decision.approvedArtifactVersionId,
          approvedPackageHash: decision.approvedPackageHash,
          expiresAt: decision.expiresAt.toISOString(),
        },
        {
          artifactVersionId: currentVersion.id,
          packageHash: hashScaleDecisionArtifact({
            proposalVersionId: currentVersion.id,
            proposalSnapshot: currentVersion.snapshot,
            experiment: experimentForApprovalHash,
          }),
        },
      );
      if (!validity.valid) {
        throw new ExperimentInvalidStateError(
          `Scale-decision approval is no longer valid: ${validity.reason}`,
        );
      }
    }

    const updated = await tx.experiment.updateMany({
      where: { id: experiment.id, workspaceId: params.workspaceId, status: { not: 'DECIDED' } },
      data: { status: 'DECIDED', endedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new ExperimentInvalidStateError('Experiment has already been decided');
    }
    return tx.experimentDecision.create({
      data: {
        experimentId: experiment.id,
        approvalRequestId: params.approvalRequestId,
        decision: params.decision,
        rationale: params.rationale,
        decidedBy: params.decidedBy,
      },
    });
  });
}
