import { describe, expect, it } from 'vitest';
import {
  calculateProfitConfidenceScore,
  ProfitConfidenceFactorWeights,
} from '../profit-confidence-score';

const allFifty = Object.fromEntries(
  Object.keys(ProfitConfidenceFactorWeights).map((k) => [k, 50]),
) as Parameters<typeof calculateProfitConfidenceScore>[0];

const allNinety = Object.fromEntries(
  Object.keys(ProfitConfidenceFactorWeights).map((k) => [k, 90]),
) as Parameters<typeof calculateProfitConfidenceScore>[0];

describe('calculateProfitConfidenceScore', () => {
  it('flags speculative when opportunity is high but confidence is low', () => {
    const result = calculateProfitConfidenceScore(allFifty, 85);
    expect(result.score).toBe(50);
    expect(result.isSpeculative).toBe(true);
  });

  it('does not flag speculative when both are strong', () => {
    const result = calculateProfitConfidenceScore(allNinety, 85);
    expect(result.isSpeculative).toBe(false);
  });

  it('does not flag speculative when opportunity itself is low', () => {
    const result = calculateProfitConfidenceScore(allFifty, 40);
    expect(result.isSpeculative).toBe(false);
  });
});
