import { describe, expect, it } from 'vitest';
import { AgentOutputSchema } from '../agent-output';

const base = {
  agentRole: 'FINANCE_AND_RISK_OFFICER',
  agentVersion: '1.0.0',
  proposalVersionId: '11111111-1111-1111-1111-111111111111',
  decision: 'APPROVE' as const,
  confidence: 80,
  summary: 'Looks solid',
  reasons: ['Break-even is achievable'],
  supportingEvidenceIds: [],
  assumptions: [],
  missingInformation: [],
  risks: [],
  requiredChanges: [],
  estimatedImpact: 'Positive',
  veto: { active: false, type: 'NONE' as const, reason: '' },
};

describe('AgentOutputSchema', () => {
  it('accepts a well-formed approval', () => {
    expect(AgentOutputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an active veto with type NONE', () => {
    const invalid = { ...base, veto: { active: true, type: 'NONE' as const, reason: 'bad' } };
    expect(AgentOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects an active veto with an empty reason', () => {
    const invalid = { ...base, veto: { active: true, type: 'FINANCE' as const, reason: '' } };
    expect(AgentOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects extra/unknown fields (strict mode)', () => {
    const invalid = { ...base, extraField: 'not allowed' };
    expect(AgentOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects confidence outside 0-100', () => {
    const invalid = { ...base, confidence: 150 };
    expect(AgentOutputSchema.safeParse(invalid).success).toBe(false);
  });
});
