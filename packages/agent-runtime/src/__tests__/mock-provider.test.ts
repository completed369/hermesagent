import { describe, expect, it } from 'vitest';
import { AgentOutputSchema, BOARD_AGENT_ROLES, CRITICAL_VETO_ROLES } from '@ventureos/contracts';
import { runAllMockBoardAgents, runMockBoardAgent, type BoardAgentInput } from '../mock-provider';

const baseInput: BoardAgentInput = {
  proposalVersionId: '11111111-1111-1111-1111-111111111111',
  opportunityTitle: 'Test Opportunity',
  opportunityScore: 71.5,
  profitConfidenceScore: 61.75,
  isSpeculative: true,
  estimatedCostEur: 45,
  estimatedRevenueEur: 850,
  estimatedProfitEur: 805,
  risks: ['Marketplace saturation'],
  evidenceClaimIds: ['22222222-2222-2222-2222-222222222222'],
};

describe('runMockBoardAgent', () => {
  it('produces schema-valid AgentOutput for every board agent role', () => {
    for (const role of BOARD_AGENT_ROLES) {
      const output = runMockBoardAgent(role, baseInput);
      expect(() => AgentOutputSchema.parse(output)).not.toThrow();
      expect(output.agentRole).toBe(role);
      expect(output.proposalVersionId).toBe(baseInput.proposalVersionId);
    }
  });

  it('is deterministic: identical input always produces identical output', () => {
    const first = runMockBoardAgent('MARKET_INTELLIGENCE_DIRECTOR', baseInput);
    const second = runMockBoardAgent('MARKET_INTELLIGENCE_DIRECTOR', baseInput);
    expect(first).toEqual(second);
  });

  it('raises a FINANCE veto when profit confidence is critically low and speculative', () => {
    const riskyInput: BoardAgentInput = {
      ...baseInput,
      profitConfidenceScore: 20,
      isSpeculative: true,
    };
    const output = runMockBoardAgent('FINANCE_AND_RISK_OFFICER', riskyInput);
    expect(output.veto.active).toBe(true);
    expect(output.veto.type).toBe(CRITICAL_VETO_ROLES.FINANCE_AND_RISK_OFFICER);
    expect(output.decision).toBe('REJECT');
  });

  it('never raises a veto with type NONE while active, and vice versa (schema-enforced)', () => {
    for (const role of BOARD_AGENT_ROLES) {
      const output = runMockBoardAgent(role, baseInput);
      if (output.veto.active) {
        expect(output.veto.type).not.toBe('NONE');
        expect(output.veto.reason.length).toBeGreaterThan(0);
      } else {
        expect(output.veto.type).toBe('NONE');
      }
    }
  });
});

describe('runAllMockBoardAgents', () => {
  it('returns exactly one output per BOARD_AGENT_ROLES entry', () => {
    const outputs = runAllMockBoardAgents(baseInput);
    expect(outputs).toHaveLength(BOARD_AGENT_ROLES.length);
    expect(new Set(outputs.map((o) => o.agentRole)).size).toBe(BOARD_AGENT_ROLES.length);
  });
});
