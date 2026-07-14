import {
  AgentOutputSchema,
  BOARD_AGENT_ROLES,
  CRITICAL_VETO_ROLES,
  type AgentOutput,
  type BoardAgentRole,
} from '@ventureos/contracts';

export const MOCK_AGENT_VERSION = 'mock-provider-v1';

/**
 * The inputs a mock board agent reasons over. Deliberately just the fields
 * already computed/persisted by Phase 2 (opportunity scores, evidence
 * quality, estimated economics) -- Phase 3 does not invent new research, it
 * evaluates what Phase 2 already produced.
 */
export interface BoardAgentInput {
  proposalVersionId: string;
  opportunityTitle: string;
  opportunityScore: number;
  profitConfidenceScore: number;
  isSpeculative: boolean;
  estimatedCostEur: number;
  estimatedRevenueEur: number;
  estimatedProfitEur: number;
  risks: string[];
  evidenceClaimIds: string[];
}

/**
 * Deterministic per-role scoring lens. Every "confidence" below is derived
 * only from the real, already-persisted opportunity/profit-confidence
 * scores -- never randomised -- so the same input always produces the same
 * AgentOutput (required for reproducible tests and audit trails).
 */
function roleLens(
  role: BoardAgentRole,
  input: BoardAgentInput,
): {
  confidence: number;
  decision: 'APPROVE' | 'REVISE' | 'REJECT';
  reasons: string[];
  risks: Array<{
    title: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    probability: 'LOW' | 'MEDIUM' | 'HIGH';
    mitigation: string;
  }>;
  vetoActive: boolean;
  vetoReason: string;
} {
  const { opportunityScore, profitConfidenceScore, isSpeculative, estimatedCostEur, risks } = input;

  switch (role) {
    case 'MARKET_INTELLIGENCE_DIRECTOR': {
      const confidence = Math.round(opportunityScore);
      return {
        confidence,
        decision: opportunityScore >= 70 ? 'APPROVE' : opportunityScore >= 50 ? 'REVISE' : 'REJECT',
        reasons: [
          `Opportunity Score of ${opportunityScore} reflects demand/trend/competition factors already computed by the scoring engine.`,
        ],
        risks: [],
        vetoActive: false,
        vetoReason: '',
      };
    }
    case 'PRODUCT_STRATEGY_DIRECTOR': {
      const confidence = Math.round((opportunityScore + profitConfidenceScore) / 2);
      return {
        confidence,
        decision: confidence >= 65 ? 'APPROVE' : confidence >= 45 ? 'REVISE' : 'REJECT',
        reasons: [
          `Suggested product/marketplace fit is consistent with the seeded opportunity brief; blended confidence ${confidence}.`,
        ],
        risks: [],
        vetoActive: false,
        vetoReason: '',
      };
    }
    case 'CREATIVE_AND_PRODUCTION_DIRECTOR': {
      const confidence = Math.round(profitConfidenceScore);
      return {
        confidence,
        decision: confidence >= 60 ? 'APPROVE' : 'REVISE',
        reasons: ['Mock production feasibility assessment based on estimated cost and scope.'],
        risks: [],
        vetoActive: false,
        vetoReason: '',
      };
    }
    case 'FINANCE_AND_RISK_OFFICER': {
      const confidence = Math.round(profitConfidenceScore);
      const criticalCostRisk = estimatedCostEur > 0 && isSpeculative && profitConfidenceScore < 40;
      return {
        confidence,
        decision: criticalCostRisk ? 'REJECT' : confidence >= 60 ? 'APPROVE' : 'REVISE',
        reasons: [
          `Profit Confidence Score ${profitConfidenceScore}${isSpeculative ? ' (flagged speculative)' : ''} evaluated against estimated cost of EUR ${estimatedCostEur}.`,
        ],
        risks: isSpeculative
          ? [
              {
                title: 'Speculative profit confidence',
                severity: 'MEDIUM' as const,
                probability: 'MEDIUM' as const,
                mitigation: 'Gather additional evidence before committing further spend.',
              },
            ]
          : [],
        vetoActive: criticalCostRisk,
        vetoReason: criticalCostRisk
          ? 'Profit confidence is too low and speculative relative to estimated cost.'
          : '',
      };
    }
    case 'GROWTH_DIRECTOR': {
      const confidence = Math.round(opportunityScore * 0.9);
      return {
        confidence,
        decision: confidence >= 60 ? 'APPROVE' : 'REVISE',
        reasons: ['Mock channel/growth potential assessment derived from the Opportunity Score.'],
        risks: [],
        vetoActive: false,
        vetoReason: '',
      };
    }
    case 'COMPLIANCE_AND_MARKETPLACE_POLICY_OFFICER': {
      const policyRiskFlagged = risks.some((r) => /polic(y|ies)/i.test(r));
      return {
        confidence: policyRiskFlagged ? 55 : 90,
        decision: 'APPROVE',
        reasons: [
          policyRiskFlagged
            ? 'A marketplace-policy-related risk was flagged in the opportunity brief; approving with a monitoring note, not blocking.'
            : 'No marketplace policy or IP concerns identified in the opportunity brief.',
        ],
        risks: [],
        vetoActive: false,
        vetoReason: '',
      };
    }
    case 'OPERATIONS_AND_QUALITY_OFFICER': {
      return {
        confidence: 85,
        decision: 'APPROVE',
        reasons: ['No product/listing exists yet to run QA checks against (Phase 4 scope).'],
        risks: [],
        vetoActive: false,
        vetoReason: '',
      };
    }
    case 'RED_TEAM_AND_SECURITY_OFFICER': {
      return {
        confidence: 90,
        decision: 'APPROVE',
        reasons: [
          'No new external integration, credential, or write-access change is being requested by this proposal.',
        ],
        risks: [],
        vetoActive: false,
        vetoReason: '',
      };
    }
  }
}

/**
 * Runs the mock board-agent provider for a single role. Always produces
 * schema-valid AgentOutputSchema output (validated before returning) -- the
 * "no live model calls required for Phase 3" default per master spec
 * section 42.
 */
export function runMockBoardAgent(role: BoardAgentRole, input: BoardAgentInput): AgentOutput {
  const lens = roleLens(role, input);
  const veto = CRITICAL_VETO_ROLES[role];

  const output: AgentOutput = {
    agentRole: role,
    agentVersion: MOCK_AGENT_VERSION,
    proposalVersionId: input.proposalVersionId,
    decision: lens.decision,
    confidence: Math.max(0, Math.min(100, lens.confidence)),
    summary: `${role.replaceAll('_', ' ')} mock review of "${input.opportunityTitle}": ${lens.decision} (confidence ${lens.confidence}).`,
    reasons: lens.reasons,
    supportingEvidenceIds: input.evidenceClaimIds,
    assumptions: [
      'Mock provider: evaluates only Phase 2 persisted scores, no live research performed.',
    ],
    missingInformation: [],
    risks: lens.risks,
    requiredChanges: lens.decision === 'REVISE' ? ['Strengthen evidence before re-review.'] : [],
    estimatedImpact:
      lens.decision === 'APPROVE'
        ? 'Supports proceeding to founder approval.'
        : lens.decision === 'REVISE'
          ? 'Recommends gathering more evidence before proceeding.'
          : 'Recommends not proceeding in current form.',
    veto: {
      active: lens.vetoActive && veto !== undefined,
      type: lens.vetoActive && veto !== undefined ? veto : 'NONE',
      reason: lens.vetoActive && veto !== undefined ? lens.vetoReason : '',
    },
  };

  // Fail closed, never silently reshape: if the mock provider itself ever
  // produced a non-conforming payload, this throws rather than persisting
  // invalid data (master spec section 12).
  return AgentOutputSchema.parse(output);
}

export function runAllMockBoardAgents(input: BoardAgentInput): AgentOutput[] {
  return BOARD_AGENT_ROLES.map((role) => runMockBoardAgent(role, input));
}
