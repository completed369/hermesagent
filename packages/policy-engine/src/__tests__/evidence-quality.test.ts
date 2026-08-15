import { describe, expect, it } from 'vitest';
import {
  calculateOpportunityEvidenceQuality,
  OPPORTUNITY_EVIDENCE_QUALITY_FORMULA_VERSION,
} from '../evidence-quality';

describe('calculateOpportunityEvidenceQuality', () => {
  const now = new Date('2026-08-15T08:00:00.000Z');

  it('uses the documented 50/30/20 reliability/relevance/freshness weighting', () => {
    const result = calculateOpportunityEvidenceQuality(
      [
        {
          id: 'artifact-a',
          reliabilityScore: 80,
          relevanceScore: 70,
          freshnessScore: 60,
        },
      ],
      now,
    );

    expect(result.formulaVersion).toBe(OPPORTUNITY_EVIDENCE_QUALITY_FORMULA_VERSION);
    expect(result.score).toBe(73);
    expect(result.dataFreshnessScore).toBe(60);
    expect(result.meetsMinimum).toBe(true);
  });

  it('counts one source artifact once even when supplied repeatedly', () => {
    const repeated = {
      id: 'artifact-a',
      reliabilityScore: 90,
      relevanceScore: 90,
      freshnessScore: 90,
    };
    const result = calculateOpportunityEvidenceQuality([repeated, repeated], now);

    expect(result.artifactCount).toBe(1);
    expect(result.score).toBe(90);
  });

  it('keeps explicitly expired evidence in the denominator with zero contribution', () => {
    const result = calculateOpportunityEvidenceQuality(
      [
        {
          id: 'fresh',
          reliabilityScore: 100,
          relevanceScore: 100,
          freshnessScore: 100,
        },
        {
          id: 'expired',
          reliabilityScore: 100,
          relevanceScore: 100,
          freshnessScore: 100,
          expiryDate: '2026-08-14T08:00:00.000Z',
        },
      ],
      now,
    );

    expect(result.score).toBe(50);
    expect(result.dataFreshnessScore).toBe(50);
    expect(result.artifactScores.find((artifact) => artifact.id === 'expired')?.expired).toBe(true);
    expect(result.meetsMinimum).toBe(false);
  });

  it('fails closed when no evidence exists', () => {
    const result = calculateOpportunityEvidenceQuality([], now);
    expect(result.score).toBeNull();
    expect(result.dataFreshnessScore).toBeNull();
    expect(result.artifactCount).toBe(0);
    expect(result.meetsMinimum).toBe(false);
  });

  it('rejects invalid score dimensions instead of clamping untrusted values', () => {
    expect(() =>
      calculateOpportunityEvidenceQuality(
        [
          {
            id: 'invalid',
            reliabilityScore: 101,
            relevanceScore: 80,
            freshnessScore: 80,
          },
        ],
        now,
      ),
    ).toThrow(RangeError);
  });
});
