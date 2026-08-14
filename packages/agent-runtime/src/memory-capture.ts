import { StructuredLogger } from '@ventureos/observability';
import type {
  ApprovalDecision,
  ApprovalRequest,
  BoardReview,
  DecisionSummary,
} from '@ventureos/database';
import { PrismaMemoryStore, type MemoryAtomicOrdering } from './memory-store.js';
import type { MemoryRecord, MemoryStore, MemoryWrite } from './memory.js';

export const MEMORY_CAPTURE_ACTOR = 'system:agent-runtime:memory-capture';

const logger = new StructuredLogger('agent-runtime');

const APPROVAL_DECISION_MEMORY_ORDERING: MemoryAtomicOrdering = {
  tieBreak: {
    payloadKey: 'decision',
    rankByValue: {
      APPROVE: 10,
      APPROVE_WITH_CONDITIONS: 10,
      REVOKE: 20,
    },
  },
};

type AtomicApprovalMemoryStore = MemoryStore & {
  putOrSupersedeActiveByKey(
    input: MemoryWrite,
    actorId: string,
    ordering?: MemoryAtomicOrdering,
  ): Promise<{ active: MemoryRecord; inserted: MemoryRecord; superseded: MemoryRecord[] }>;
};

function supportsAtomicSupersession(store: MemoryStore): store is AtomicApprovalMemoryStore {
  return 'putOrSupersedeActiveByKey' in store;
}

export type CaptureBoardReviewMemoryInput = {
  boardReview: Pick<
    BoardReview,
    | 'id'
    | 'workspaceId'
    | 'ventureProposalId'
    | 'ventureProposalVersionId'
    | 'blocked'
    | 'meetsThreshold'
  >;
  decisionSummary: Pick<DecisionSummary, 'id' | 'recommendation' | 'overallConfidence'>;
  store?: MemoryStore;
};

export type CaptureApprovalDecisionMemoryInput = {
  approvalRequest: Pick<ApprovalRequest, 'id' | 'workspaceId' | 'ventureProposalId' | 'kind'>;
  approvalDecision: Pick<
    ApprovalDecision,
    | 'id'
    | 'decision'
    | 'conditions'
    | 'approvedAmountEur'
    | 'decidedAt'
    | 'approvedArtifactVersionId'
  >;
  store?: MemoryStore;
};

export function buildBoardReviewMemoryWrite(
  input: Omit<CaptureBoardReviewMemoryInput, 'store'>,
): MemoryWrite {
  return {
    workspaceId: input.boardReview.workspaceId,
    kind: 'EPISODE',
    subject: `venture-proposal:${input.boardReview.ventureProposalId}`,
    key: `board-review:${input.boardReview.id}`,
    payload: {
      boardReviewId: input.boardReview.id,
      ventureProposalId: input.boardReview.ventureProposalId,
      ventureProposalVersionId: input.boardReview.ventureProposalVersionId,
      decisionSummaryId: input.decisionSummary.id,
      blocked: input.boardReview.blocked,
      meetsThreshold: input.boardReview.meetsThreshold,
      recommendation: input.decisionSummary.recommendation,
      overallConfidence: Number(input.decisionSummary.overallConfidence),
    },
    sourceRef: `decision-summary:${input.decisionSummary.id}`,
    confidence: 1,
    sensitivity: 'INTERNAL',
    createdBy: MEMORY_CAPTURE_ACTOR,
  };
}

export function buildApprovalDecisionMemoryWrite(
  input: Omit<CaptureApprovalDecisionMemoryInput, 'store'>,
): MemoryWrite {
  const payload: Record<string, unknown> = {
    approvalRequestId: input.approvalRequest.id,
    approvalDecisionId: input.approvalDecision.id,
    kind: input.approvalRequest.kind,
    decision: input.approvalDecision.decision,
    conditions: input.approvalDecision.conditions,
    decidedAt: input.approvalDecision.decidedAt.toISOString(),
    approvedArtifactVersionId: input.approvalDecision.approvedArtifactVersionId,
  };
  if (input.approvalDecision.approvedAmountEur !== null) {
    payload.approvedAmountEur = Number(input.approvalDecision.approvedAmountEur);
  }

  return {
    workspaceId: input.approvalRequest.workspaceId,
    kind: 'DECISION',
    subject: `venture-proposal:${input.approvalRequest.ventureProposalId}`,
    key: `approval-request:${input.approvalRequest.id}`,
    payload,
    sourceRef: `approval-decision:${input.approvalDecision.id}`,
    confidence: 1,
    sensitivity: 'INTERNAL',
    createdBy: MEMORY_CAPTURE_ACTOR,
  };
}

export async function captureBoardReviewMemory(
  input: CaptureBoardReviewMemoryInput,
): Promise<MemoryRecord | null> {
  const store = input.store ?? new PrismaMemoryStore();
  const write = buildBoardReviewMemoryWrite(input);
  try {
    return await store.put(write);
  } catch (err) {
    logger.warn('Advisory board-review memory capture failed after authoritative completion', {
      workspaceId: input.boardReview.workspaceId,
      boardReviewId: input.boardReview.id,
      ventureProposalId: input.boardReview.ventureProposalId,
      decisionSummaryId: input.decisionSummary.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function captureApprovalDecisionMemory(
  input: CaptureApprovalDecisionMemoryInput,
): Promise<MemoryRecord | null> {
  const store = input.store ?? new PrismaMemoryStore();
  const write = buildApprovalDecisionMemoryWrite(input);
  try {
    if (supportsAtomicSupersession(store)) {
      const result = await store.putOrSupersedeActiveByKey(
        write,
        MEMORY_CAPTURE_ACTOR,
        APPROVAL_DECISION_MEMORY_ORDERING,
      );
      return result.active;
    }

    const existing = await store.query({
      workspaceId: input.approvalRequest.workspaceId,
      kinds: ['DECISION'],
      subject: write.subject,
      keys: [write.key],
      limit: 1,
    });
    const active = existing[0];
    if (!active) {
      return await store.put(write);
    }
    const superseded = await store.supersede(
      input.approvalRequest.workspaceId,
      active.id,
      write,
      MEMORY_CAPTURE_ACTOR,
    );
    return superseded.replacement;
  } catch (err) {
    logger.warn('Advisory approval-decision memory capture failed after authoritative commit', {
      workspaceId: input.approvalRequest.workspaceId,
      approvalRequestId: input.approvalRequest.id,
      approvalDecisionId: input.approvalDecision.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
