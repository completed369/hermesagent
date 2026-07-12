import { describe, expect, it } from 'vitest';
import type { AgentOutput, BoardAgentRole } from '@ventureos/contracts';
import { BOARD_AGENT_ROLES } from '@ventureos/contracts';
import { calculateBoardVotingResult, DEFAULT_AGENT_WEIGHTS } from '../board-voting';

function makeOutput(role: BoardAgentRole, decision: AgentOutput['decision'], veto?: Partial<AgentOutput['veto']>): AgentOutput {
  return {
    agentRole: role,
    agentVersion: '1.0.0',
    proposalVersionId: '11111111-1111-1111-1111-111111111111',
    decision,
    confidence: 80,
    summary: 'x',
    reasons: [],
    supportingEvidenceIds: [],
    assumptions: [],
    missingInformation: [],
    risks: [],
    requiredChanges: [],
    estimatedImpact: 'x',
    veto: { active: false, type: 'NONE', reason: '', ...veto },
  };
}

describe('calculateBoardVotingResult', () => {
  it('approves when all eight agents approve (100% weighted)', () => {
    const outputs = BOARD_AGENT_ROLES.map((r) => makeOutput(r, 'APPROVE'));
    const result = calculateBoardVotingResult(outputs, { evidenceQualityScore: 90 });
    expect(result.weightedScore).toBe(100);
    expect(result.meetsThreshold).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('blocks when weighted score is below the 75% threshold', () => {
    const outputs = BOARD_AGENT_ROLES.map((r) => makeOutput(r, 'REJECT'));
    const result = calculateBoardVotingResult(outputs, { evidenceQualityScore: 90 });
    expect(result.weightedScore).toBe(0);
    expect(result.blocked).toBe(true);
  });

  it('blocks on an active critical finance veto even if weighted score is high', () => {
    const outputs = BOARD_AGENT_ROLES.map((r) =>
      r === 'FINANCE_AND_RISK_OFFICER'
        ? makeOutput(r, 'REJECT', { active: true, type: 'FINANCE', reason: 'unsupported economics' })
        : makeOutput(r, 'APPROVE'),
    );
    const result = calculateBoardVotingResult(outputs, { evidenceQualityScore: 90 });
    expect(result.activeCriticalVetoes.length).toBe(1);
    expect(result.blocked).toBe(true);
  });

  it('blocks when mandatory reviews are missing', () => {
    const outputs = BOARD_AGENT_ROLES.slice(0, 7).map((r) => makeOutput(r, 'APPROVE'));
    const result = calculateBoardVotingResult(outputs, { evidenceQualityScore: 90 });
    expect(result.missingReviews.length).toBe(1);
    expect(result.blocked).toBe(true);
  });

  it('blocks when evidence quality is below 70', () => {
    const outputs = BOARD_AGENT_ROLES.map((r) => makeOutput(r, 'APPROVE'));
    const result = calculateBoardVotingResult(outputs, { evidenceQualityScore: 50 });
    expect(result.blocked).toBe(true);
  });

  it('scores REVISE at half weight', () => {
    const outputs = BOARD_AGENT_ROLES.map((r) => makeOutput(r, 'REVISE'));
    const result = calculateBoardVotingResult(outputs, { evidenceQualityScore: 90 });
    expect(result.weightedScore).toBe(50);
  });

  it('default weights sum to 100', () => {
    const total = Object.values(DEFAULT_AGENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});
