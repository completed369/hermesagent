import 'reflect-metadata';
import { z } from 'zod';
import { prisma } from '@ventureos/database';
import { AuditService } from '../modules/audit/audit.service';
import { BoardService } from '../modules/board/board.service';
import {
  createOpportunitySchema,
  opportunityComplianceAssessmentSchema,
} from '../modules/opportunities/opportunities.dto';
import { OpportunitiesService } from '../modules/opportunities/opportunities.service';

const CANONICAL_WORKSPACE_SLUG = 'ventureos-default';
const CANONICAL_SEED_TITLE = 'Social Media Content Planning Kit';
const REQUIRED_SCORE = 70;
const BOARD_WAIT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;

const operatorInputSchema = z
  .object({
    pilot: createOpportunitySchema,
    compliance: opportunityComplianceAssessmentSchema.omit({ evidenceClaimIds: true }).strict(),
  })
  .strict();

type OperatorInput = z.infer<typeof operatorInputSchema>;

type ScoreType = 'OPPORTUNITY' | 'PROFIT_CONFIDENCE' | 'EVIDENCE_QUALITY';

export class Stage6OperatorGateError extends Error {
  constructor(
    public readonly stage: string,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'Stage6OperatorGateError';
  }
}

export function assertStage6ScoreThresholds(scores: Record<ScoreType, number>): void {
  const failures = (Object.entries(scores) as Array<[ScoreType, number]>).filter(
    ([, score]) => !Number.isFinite(score) || score < REQUIRED_SCORE,
  );
  if (failures.length > 0) {
    throw new Stage6OperatorGateError(
      'GATE_2_SCORING',
      'SCORE_THRESHOLD_NOT_MET',
      failures.map(([type, score]) => `${type}=${score}`).join(', '),
    );
  }
}

export function assertStage6BoardOutcome(review: {
  status: string;
  meetsThreshold: boolean | null;
  blocked: boolean | null;
}): void {
  if (review.status !== 'COMPLETED') {
    throw new Stage6OperatorGateError(
      'GATE_2_BOARD',
      'BOARD_NOT_COMPLETED',
      `Board review status is ${review.status}`,
    );
  }
  if (review.meetsThreshold !== true || review.blocked !== false) {
    throw new Stage6OperatorGateError(
      'GATE_2_BOARD',
      'BOARD_GATE_NOT_MET',
      `meetsThreshold=${review.meetsThreshold}; blocked=${review.blocked}`,
    );
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function resolveCanonicalFounderContext(): Promise<{
  workspaceId: string;
  founderUserId: string;
}> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: CANONICAL_WORKSPACE_SLUG },
    select: { id: true, deletedAt: true },
  });
  if (!workspace || workspace.deletedAt) {
    throw new Stage6OperatorGateError(
      'IDENTITY',
      'CANONICAL_WORKSPACE_NOT_FOUND',
      'Canonical founder workspace is unavailable',
    );
  }

  const seedMarkerCount = await prisma.opportunity.count({
    where: { workspaceId: workspace.id, title: CANONICAL_SEED_TITLE },
  });
  if (seedMarkerCount !== 1) {
    throw new Stage6OperatorGateError(
      'IDENTITY',
      'CANONICAL_SEED_MARKER_INVALID',
      `Expected exactly one canonical seed marker, found ${seedMarkerCount}`,
    );
  }

  const founderMemberships = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: workspace.id,
      role: { is: { key: 'FOUNDER' } },
      user: { is: { isFounder: true, deletedAt: null } },
    },
    select: { userId: true },
  });
  if (founderMemberships.length !== 1) {
    throw new Stage6OperatorGateError(
      'IDENTITY',
      'FOUNDER_IDENTITY_AMBIGUOUS',
      `Expected exactly one founder membership, found ${founderMemberships.length}`,
    );
  }

  return { workspaceId: workspace.id, founderUserId: founderMemberships[0]!.userId };
}

async function assertFreshTitle(workspaceId: string, title: string): Promise<void> {
  const existing = await prisma.opportunity.findFirst({
    where: { workspaceId, title },
    select: { id: true, status: true },
  });
  if (existing) {
    throw new Stage6OperatorGateError(
      'INTAKE',
      'PILOT_TITLE_ALREADY_EXISTS',
      `A persisted opportunity with this title already exists (status=${existing.status})`,
    );
  }
}

async function loadLatestRequiredScores(opportunityId: string): Promise<Record<ScoreType, number>> {
  const scoreTypes: ScoreType[] = ['OPPORTUNITY', 'PROFIT_CONFIDENCE', 'EVIDENCE_QUALITY'];
  const result = {} as Record<ScoreType, number>;

  for (const scoreType of scoreTypes) {
    const row = await prisma.opportunityScore.findFirst({
      where: { opportunityId, scoreType },
      orderBy: { calculatedAt: 'desc' },
      select: { score: true },
    });
    if (!row) {
      throw new Stage6OperatorGateError(
        'GATE_2_SCORING',
        'REQUIRED_SCORE_MISSING',
        `${scoreType} history is missing`,
      );
    }
    result[scoreType] = Number(row.score);
  }

  assertStage6ScoreThresholds(result);
  return result;
}

async function waitForBoardAndApproval(params: {
  workspaceId: string;
  ventureProposalId: string;
  workflowId: string;
}): Promise<{
  boardReviewId: string;
  approvalRequestId: string;
  approvalState: string;
  boardStatus: string;
  meetsThreshold: boolean;
  blocked: boolean;
}> {
  const deadline = Date.now() + BOARD_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const approval = await prisma.approvalRequest.findFirst({
      where: {
        workspaceId: params.workspaceId,
        ventureProposalId: params.ventureProposalId,
        workflowId: params.workflowId,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, state: true, boardReviewId: true },
    });

    if (approval?.boardReviewId) {
      const board = await prisma.boardReview.findFirst({
        where: { id: approval.boardReviewId, workspaceId: params.workspaceId },
        select: { id: true, status: true, meetsThreshold: true, blocked: true },
      });
      if (!board) {
        throw new Stage6OperatorGateError(
          'GATE_2_BOARD',
          'BOARD_REVIEW_MISSING',
          'Approval request references a missing board review',
        );
      }

      assertStage6BoardOutcome(board);
      if (approval.state !== 'PENDING') {
        throw new Stage6OperatorGateError(
          'FOUNDER_APPROVAL',
          'APPROVAL_NOT_PENDING',
          `Expected a pending founder approval request, found ${approval.state}`,
        );
      }

      return {
        boardReviewId: board.id,
        approvalRequestId: approval.id,
        approvalState: approval.state,
        boardStatus: board.status,
        meetsThreshold: board.meetsThreshold === true,
        blocked: board.blocked === true,
      };
    }

    const latestBoard = await prisma.boardReview.findFirst({
      where: { workspaceId: params.workspaceId, ventureProposalId: params.ventureProposalId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, failureReason: true },
    });
    if (latestBoard?.status === 'FAILED') {
      throw new Stage6OperatorGateError(
        'GATE_2_BOARD',
        'BOARD_REVIEW_FAILED',
        latestBoard.failureReason ?? 'Board review failed',
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Stage6OperatorGateError(
    'GATE_2_BOARD',
    'BOARD_APPROVAL_WAIT_TIMEOUT',
    'Timed out waiting for the persisted board review and founder approval request',
  );
}

export async function runStage6PreapprovalOperator(input: OperatorInput) {
  const { workspaceId, founderUserId } = await resolveCanonicalFounderContext();
  await assertFreshTitle(workspaceId, input.pilot.title);

  const auditService = new AuditService();
  const opportunitiesService = new OpportunitiesService(auditService);
  const boardService = new BoardService(auditService);

  const opportunity = await opportunitiesService.create(workspaceId, input.pilot, founderUserId);
  const evidenceClaimIds = opportunity.evidenceClaims.map((claim) => claim.id);
  if (evidenceClaimIds.length < 1) {
    throw new Stage6OperatorGateError(
      'GATE_1_COMPLIANCE',
      'EVIDENCE_CLAIMS_MISSING',
      'Persisted opportunity has no evidence claims',
    );
  }

  const compliance = await opportunitiesService.assessCompliance(
    workspaceId,
    opportunity.id,
    { ...input.compliance, evidenceClaimIds },
    founderUserId,
  );
  if (compliance.result !== 'PASS' || compliance.hasCriticalBlocker) {
    throw new Stage6OperatorGateError(
      'GATE_1_COMPLIANCE',
      'COMPLIANCE_GATE_BLOCKED',
      compliance.blockers.map((blocker) => blocker.code).join(', ') || 'Gate 1 blocked',
    );
  }

  const scores = await loadLatestRequiredScores(opportunity.id);
  const promoted = await opportunitiesService.promote(workspaceId, opportunity.id, founderUserId);
  const started = await boardService.startReview(workspaceId, promoted.proposal.id, founderUserId);
  const boardAndApproval = await waitForBoardAndApproval({
    workspaceId,
    ventureProposalId: promoted.proposal.id,
    workflowId: started.workflowId,
  });

  return {
    result: 'FOUNDER_APPROVAL_REQUIRED' as const,
    opportunityId: opportunity.id,
    ventureProposalId: promoted.proposal.id,
    compliance: {
      result: compliance.result,
      auditEventId: compliance.auditEventId,
      formulaVersion: compliance.formulaVersion,
      policyPackVersion: compliance.policyPackVersion,
    },
    scores: {
      opportunity: scores.OPPORTUNITY,
      profitConfidence: scores.PROFIT_CONFIDENCE,
      evidenceQuality: scores.EVIDENCE_QUALITY,
    },
    board: {
      boardReviewId: boardAndApproval.boardReviewId,
      status: boardAndApproval.boardStatus,
      meetsThreshold: boardAndApproval.meetsThreshold,
      blocked: boardAndApproval.blocked,
    },
    approval: {
      approvalRequestId: boardAndApproval.approvalRequestId,
      state: boardAndApproval.approvalState,
    },
    workflowId: started.workflowId,
  };
}

async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    const parsedJson: unknown = JSON.parse(raw);
    const input = operatorInputSchema.parse(parsedJson);
    const result = await runStage6PreapprovalOperator(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error instanceof Stage6OperatorGateError) {
      process.stderr.write(
        `${JSON.stringify({
          result: 'STAGE6_GATE_FAILED',
          stage: error.stage,
          code: error.code,
          message: error.message,
        })}\n`,
      );
    } else if (error instanceof z.ZodError) {
      process.stderr.write(
        `${JSON.stringify({
          result: 'STAGE6_INPUT_REJECTED',
          code: 'INVALID_INPUT',
          issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
        })}\n`,
      );
    } else if (error instanceof SyntaxError) {
      process.stderr.write(
        `${JSON.stringify({ result: 'STAGE6_INPUT_REJECTED', code: 'INVALID_JSON' })}\n`,
      );
    } else {
      process.stderr.write(
        `${JSON.stringify({ result: 'STAGE6_OPERATOR_FAILED', code: 'UNEXPECTED_OPERATOR_FAILURE' })}\n`,
      );
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
