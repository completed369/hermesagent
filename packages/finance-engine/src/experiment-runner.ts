import { prisma } from '@ventureos/database';
import type { Experiment, ExperimentDecision, ExperimentResult } from '@ventureos/database';
import { hashObject } from '@ventureos/security';
import { ExperimentInvalidStateError, ExperimentNotFoundError } from './errors.js';

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
  return prisma.experiment.create({
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
}

export async function startExperiment(
  workspaceId: string,
  experimentId: string,
): Promise<Experiment> {
  const experiment = await prisma.experiment.findFirst({
    where: { id: experimentId, workspaceId },
  });
  if (!experiment) throw new ExperimentNotFoundError('Experiment not found');
  if (experiment.status !== 'DRAFT') {
    throw new ExperimentInvalidStateError(`Experiment is already ${experiment.status}`);
  }
  return prisma.experiment.update({
    where: { id: experimentId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
}

export interface RecordExperimentResultParams {
  workspaceId: string;
  experimentId: string;
  experimentVariantId: string;
  experimentMetricId: string;
  value: number;
  sampleSize?: number;
}

/** A single real measurement -- multiple calls per variant/metric pair are
 * expected as the experiment runs, never overwritten in place. */
export async function recordExperimentResult(
  params: RecordExperimentResultParams,
): Promise<ExperimentResult> {
  const variant = await prisma.experimentVariant.findFirst({
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
  const metric = await prisma.experimentMetric.findFirst({
    where: {
      id: params.experimentMetricId,
      experimentId: variant.experimentId,
    },
  });
  if (!metric) {
    throw new ExperimentNotFoundError('Experiment metric not found');
  }
  return prisma.experimentResult.create({
    data: {
      experimentVariantId: params.experimentVariantId,
      experimentMetricId: params.experimentMetricId,
      value: params.value,
      sampleSize: params.sampleSize,
    },
  });
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
 * use (kind: 'SCALE_DECISION'); `decideApprovalRequest`'s default branch
 * already re-validates hash-binding against the venture proposal's latest
 * version with zero changes needed, since every ApprovalRequest is bound to
 * a ventureProposalId/ventureProposalVersionId regardless of kind.
 * `packageHash` MUST be computed with the exact same scheme as a
 * VENTURE_PROPOSAL request -- `hashObject(latestVersion.snapshot)` alone --
 * because that is exactly what `decideApprovalRequest`'s default branch
 * re-computes at decision time. Wrapping the snapshot in any other object
 * (e.g. together with an experiment-results hash) makes the stored
 * `packageHash` permanently mismatch what gets re-computed, so the approval
 * would fail closed with PACKAGE_HASH_MISMATCH even with zero real drift --
 * a real bug an earlier version of this function had, caught by
 * `finance.integration.spec.ts`.
 */
export async function requestScaleDecisionApproval(
  params: RequestScaleDecisionApprovalParams,
): Promise<{ approvalRequestId: string }> {
  const experiment = await prisma.experiment.findFirst({
    where: { id: params.experimentId, workspaceId: params.workspaceId },
  });
  if (!experiment) throw new ExperimentNotFoundError('Experiment not found');
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
    where: { id: experiment.ventureProposalId },
    include: {
      opportunity: true,
      versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 },
    },
  });
  if (!proposal) throw new ExperimentNotFoundError('Venture proposal not found');
  const latestVersion = proposal.versions[0];
  if (!latestVersion) throw new ExperimentNotFoundError('Venture proposal has no versions');
  const opportunity = proposal.opportunity;

  // Same artefact, same hash scheme as a VENTURE_PROPOSAL request -- see the
  // function doc comment above for why this must not be wrapped in anything
  // else.
  const packageHash = hashObject(latestVersion.snapshot);

  const expiresAt = new Date(Date.now() + (params.expiresInHours ?? 168) * 60 * 60 * 1000);

  const approvalRequest = await prisma.approvalRequest.create({
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
  const experiment = await prisma.experiment.findFirst({
    where: { id: params.experimentId, workspaceId: params.workspaceId },
  });
  if (!experiment) throw new ExperimentNotFoundError('Experiment not found');
  if (experiment.status === 'DECIDED') {
    throw new ExperimentInvalidStateError('Experiment has already been decided');
  }

  if (params.decision === 'SCALE') {
    if (!params.approvalRequestId) {
      throw new ExperimentInvalidStateError(
        'A SCALE decision requires an approved SCALE_DECISION approvalRequestId (Gate 6)',
      );
    }
    const approval = await prisma.approvalRequest.findFirst({
      where: {
        id: params.approvalRequestId,
        workspaceId: params.workspaceId,
        kind: 'SCALE_DECISION',
        experimentId: params.experimentId,
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
  }

  const [, decisionRow] = await prisma.$transaction([
    prisma.experiment.update({
      where: { id: experiment.id },
      data: { status: 'DECIDED', endedAt: new Date() },
    }),
    prisma.experimentDecision.create({
      data: {
        experimentId: experiment.id,
        approvalRequestId: params.approvalRequestId,
        decision: params.decision,
        rationale: params.rationale,
        decidedBy: params.decidedBy,
      },
    }),
  ]);

  return decisionRow;
}
