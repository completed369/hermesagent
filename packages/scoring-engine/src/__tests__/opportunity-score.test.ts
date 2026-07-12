import { describe, expect, it } from 'vitest';
import { calculateOpportunityScore, OpportunityFactorWeights } from '../opportunity-score';

const allFifty = Object.fromEntries(
  Object.keys(OpportunityFactorWeights).map((k) => [k, 50]),
) as Parameters<typeof calculateOpportunityScore>[0];

const allHundred = Object.fromEntries(
  Object.keys(OpportunityFactorWeights).map((k) => [k, 100]),
) as Parameters<typeof calculateOpportunityScore>[0];

describe('calculateOpportunityScore', () => {
  it('returns 50 when every factor is 50', () => {
    expect(calculateOpportunityScore(allFifty).score).toBe(50);
  });

  it('returns 100 when every factor is 100', () => {
    expect(calculateOpportunityScore(allHundred).score).toBe(100);
  });

  it('is deterministic and reproducible', () => {
    const a = calculateOpportunityScore(allFifty, new Date('2026-01-01'));
    const b = calculateOpportunityScore(allFifty, new Date('2026-01-01'));
    expect(a.score).toEqual(b.score);
    expect(a.factorContributions).toEqual(b.factorContributions);
  });

  it('rejects out-of-range factor values', () => {
    expect(() => calculateOpportunityScore({ ...allFifty, demand: 150 })).toThrow();
  });

  it('records the formula version for reproducibility/audit', () => {
    const result = calculateOpportunityScore(allFifty);
    expect(result.formulaVersion).toBe('opportunity-score-v1');
  });
});
