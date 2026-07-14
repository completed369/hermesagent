import { describe, expect, it } from 'vitest';
import { calculateBoardVotingResult, DEFAULT_AGENT_WEIGHTS } from '@ventureos/policy-engine';
import { runAllMockBoardAgents, type BoardAgentInput } from '../mock-provider';
import { synthesiseDecision } from '../decision-synthesiser';

const approvingInput: BoardAgentInput = {
  proposalVersionId: '11111111-1111-1111-1111-111111111111',
  opportunityTitle: 'Test Opportunity',
  opportunityScore: 90,
  profitConfidenceScore: 85,
  isSpeculative: false,
  estimatedCostEur: 45,
  estimatedRevenueEur: 850,
  estimatedProfitEur: 805,
  risks: [],
  evidenceClaimIds: [],
};

const vetoingInput: BoardAgentInput = {
  ...approvingInput,
  profitConfidenceScore: 10,
  isSpeculative: true,
};

describe('synthesiseDecision', () => {
  it('recommends APPROVE when the board approves and the vote result meets threshold', () => {
    const outputs = runAllMockBoardAgents(approvingInput);
    const result = calculateBoardVotingResult(outputs, { weights: DEFAULT_AGENT_WEIGHTS });
    const summary = synthesiseDecision(outputs, result);
    expect(result.blocked).toBe(false);
    expect(summary.recommendation).toBe('APPROVE');
    expect(summary.vetoSummary).toBe('No active critical vetoes.');
  });

  it('recommends REJECT and surfaces the veto reason when a critical veto is active', () => {
    const outputs = runAllMockBoardAgents(vetoingInput);
    const result = calculateBoardVotingResult(outputs, { weights: DEFAULT_AGENT_WEIGHTS });
    const summary = synthesiseDecision(outputs, result);
    expect(result.activeCriticalVetoes.length).toBeGreaterThan(0);
    expect(summary.recommendation).toBe('REJECT');
    expect(summary.vetoSummary).toContain('FINANCE_AND_RISK_OFFICER');
  });

  it('never itself decides -- recommendation always mirrors the pre-computed voting result', () => {
    const outputs = runAllMockBoardAgents(approvingInput);
    const blockedResult = calculateBoardVotingResult(outputs, {
      weights: DEFAULT_AGENT_WEIGHTS,
      approvalThreshold: 1000, // force blocked regardless of agent decisions
    });
    const summary = synthesiseDecision(outputs, blockedResult);
    expect(blockedResult.blocked).toBe(true);
    expect(summary.recommendation).toBe('REVISE');
  });
});
