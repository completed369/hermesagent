import type { AgentOutput } from '@ventureos/contracts';
import type { BoardVotingResult } from '@ventureos/policy-engine';

export const DECISION_SYNTHESISER_VERSION = 'decision-synthesiser-v1';

export interface DecisionSummaryDraft {
  agreementSummary: string;
  disagreementSummary: string;
  vetoSummary: string;
  overallConfidence: number;
  recommendation: 'APPROVE' | 'REVISE' | 'REJECT';
  generatedAt: string;
}

/**
 * The non-voting Decision Synthesiser (master spec section 11, last
 * paragraph): summarises the board's outputs and the ALREADY-COMPUTED
 * deterministic voting result. It never itself votes, approves, overrides a
 * veto, or executes anything -- `recommendation` is informational text
 * describing what calculateBoardVotingResult already determined, not a
 * separate decision-making step. The real decision is always the founder's.
 */
export function synthesiseDecision(
  outputs: AgentOutput[],
  votingResult: BoardVotingResult,
): DecisionSummaryDraft {
  const approvals = outputs.filter((o) => o.decision === 'APPROVE');
  const revisions = outputs.filter((o) => o.decision === 'REVISE');
  const rejections = outputs.filter((o) => o.decision === 'REJECT');

  const agreementSummary = `${approvals.length}/${outputs.length} agents approved (weighted score ${votingResult.weightedScore}/${votingResult.approvalThreshold} threshold).`;

  const disagreementSummary =
    revisions.length === 0 && rejections.length === 0
      ? 'No dissenting agents.'
      : [
          revisions.length > 0
            ? `Requested revision: ${revisions.map((o) => o.agentRole).join(', ')}.`
            : null,
          rejections.length > 0
            ? `Rejected: ${rejections.map((o) => o.agentRole).join(', ')}.`
            : null,
        ]
          .filter(Boolean)
          .join(' ');

  const vetoSummary =
    votingResult.activeCriticalVetoes.length === 0
      ? 'No active critical vetoes.'
      : votingResult.activeCriticalVetoes
          .map((v) => `${v.agentRole} raised a ${v.type} veto: ${v.reason}`)
          .join(' ');

  const overallConfidence =
    outputs.length === 0
      ? 0
      : Math.round(outputs.reduce((sum, o) => sum + o.confidence, 0) / outputs.length);

  // Recommendation text mirrors the already-computed voting result exactly --
  // this function never introduces its own approve/reject logic.
  const recommendation: DecisionSummaryDraft['recommendation'] = votingResult.blocked
    ? votingResult.activeCriticalVetoes.length > 0
      ? 'REJECT'
      : 'REVISE'
    : 'APPROVE';

  return {
    agreementSummary,
    disagreementSummary,
    vetoSummary,
    overallConfidence,
    recommendation,
    generatedAt: new Date().toISOString(),
  };
}
