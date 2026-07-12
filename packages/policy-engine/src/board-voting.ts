import type { AgentOutput, BoardAgentRole } from '@ventureos/contracts';
import { CRITICAL_VETO_ROLES } from '@ventureos/contracts';

export const BOARD_VOTING_FORMULA_VERSION = 'board-voting-v1';

/** Default agent weights, must sum to 100 (master spec section 13). */
export const DEFAULT_AGENT_WEIGHTS: Record<BoardAgentRole, number> = {
  MARKET_INTELLIGENCE_DIRECTOR: 15,
  PRODUCT_STRATEGY_DIRECTOR: 15,
  CREATIVE_AND_PRODUCTION_DIRECTOR: 10,
  FINANCE_AND_RISK_OFFICER: 15,
  GROWTH_DIRECTOR: 10,
  COMPLIANCE_AND_MARKETPLACE_POLICY_OFFICER: 15,
  OPERATIONS_AND_QUALITY_OFFICER: 10,
  RED_TEAM_AND_SECURITY_OFFICER: 10,
};

const WEIGHT_TOTAL = Object.values(DEFAULT_AGENT_WEIGHTS).reduce((a, b) => a + b, 0);
if (WEIGHT_TOTAL !== 100) {
  throw new Error(`DEFAULT_AGENT_WEIGHTS must sum to 100, got ${WEIGHT_TOTAL}`);
}

export interface BoardVotingResult {
  formulaVersion: string;
  weightedScore: number;
  approvalThreshold: number;
  meetsThreshold: boolean;
  activeCriticalVetoes: Array<{ agentRole: string; type: string; reason: string }>;
  blocked: boolean;
  blockingReasons: string[];
  missingReviews: string[];
}

/**
 * Deterministic board voting calculation per master spec section 13.
 * Decision scoring: Approve = full weight, Revise = half weight, Reject = 0.
 * Any active critical veto from Finance/Compliance/Security/Quality blocks
 * regardless of the weighted score. Missing mandatory reviews also blocks.
 */
export function calculateBoardVotingResult(
  outputs: AgentOutput[],
  options: {
    weights?: Record<string, number>;
    approvalThreshold?: number;
    requiredRoles?: readonly string[];
    evidenceQualityScore?: number;
    evidenceQualityMinimum?: number;
  } = {},
): BoardVotingResult {
  const weights = options.weights ?? DEFAULT_AGENT_WEIGHTS;
  const approvalThreshold = options.approvalThreshold ?? 75;
  const requiredRoles = options.requiredRoles ?? Object.keys(DEFAULT_AGENT_WEIGHTS);
  const evidenceMinimum = options.evidenceQualityMinimum ?? 70;

  const blockingReasons: string[] = [];

  const seenRoles = new Set(outputs.map((o) => o.agentRole));
  const missingReviews = requiredRoles.filter((r) => !seenRoles.has(r));
  if (missingReviews.length > 0) {
    blockingReasons.push(`Missing mandatory board reviews: ${missingReviews.join(', ')}`);
  }

  const activeCriticalVetoes = outputs
    .filter((o) => o.veto.active && CRITICAL_VETO_ROLES[o.agentRole] === o.veto.type)
    .map((o) => ({ agentRole: o.agentRole, type: o.veto.type, reason: o.veto.reason }));
  if (activeCriticalVetoes.length > 0) {
    blockingReasons.push(
      `Active critical veto(es): ${activeCriticalVetoes.map((v) => `${v.agentRole}(${v.type})`).join(', ')}`,
    );
  }

  if (
    options.evidenceQualityScore !== undefined &&
    options.evidenceQualityScore < evidenceMinimum
  ) {
    blockingReasons.push(
      `Evidence quality ${options.evidenceQualityScore} is below minimum ${evidenceMinimum}`,
    );
  }

  let weightedScore = 0;
  for (const output of outputs) {
    const weight = weights[output.agentRole] ?? 0;
    if (output.decision === 'APPROVE') weightedScore += weight;
    else if (output.decision === 'REVISE') weightedScore += weight / 2;
    // REJECT contributes 0
  }
  weightedScore = Math.round(weightedScore * 100) / 100;

  const meetsThreshold = weightedScore >= approvalThreshold;
  const blocked = blockingReasons.length > 0 || !meetsThreshold;

  return {
    formulaVersion: BOARD_VOTING_FORMULA_VERSION,
    weightedScore,
    approvalThreshold,
    meetsThreshold,
    activeCriticalVetoes,
    blocked,
    blockingReasons,
    missingReviews,
  };
}
