import { describe, expect, it } from 'vitest';
import { computeFreshnessScore, computeReliabilityScore } from '../evidence-scoring';

describe('computeFreshnessScore', () => {
  const now = new Date('2026-07-14T12:00:00.000Z');

  it('returns 100 at the moment of retrieval', () => {
    const score = computeFreshnessScore({
      retrievedAt: now,
      freshnessRequirementHours: 24,
      now,
    });
    expect(score).toBe(100);
  });

  it('decays linearly toward the 2x-requirement horizon', () => {
    const retrievedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h old
    const score = computeFreshnessScore({
      retrievedAt,
      freshnessRequirementHours: 24, // horizon = 48h; 24h old = 50%
      now,
    });
    expect(score).toBe(50);
  });

  it('floors at 0 once age reaches or exceeds 2x the freshness requirement', () => {
    const retrievedAt = new Date(now.getTime() - 100 * 60 * 60 * 1000);
    const score = computeFreshnessScore({
      retrievedAt,
      freshnessRequirementHours: 24,
      now,
    });
    expect(score).toBe(0);
  });

  it('never returns a negative score for a "future" retrievedAt (clock skew safety)', () => {
    const retrievedAt = new Date(now.getTime() + 60 * 60 * 1000);
    const score = computeFreshnessScore({ retrievedAt, freshnessRequirementHours: 24, now });
    expect(score).toBe(100);
  });
});

describe('computeReliabilityScore', () => {
  it('ranks source types per the master-spec-section-16 preferred order', () => {
    const official = computeReliabilityScore({
      sourceType: 'OFFICIAL_API',
      promptInjectionFlagged: false,
      disabled: false,
    });
    const founder = computeReliabilityScore({
      sourceType: 'FOUNDER_PROVIDED',
      promptInjectionFlagged: false,
      disabled: false,
    });
    const browse = computeReliabilityScore({
      sourceType: 'PERMITTED_BROWSER_RESEARCH',
      promptInjectionFlagged: false,
      disabled: false,
    });
    const manual = computeReliabilityScore({
      sourceType: 'MANUAL_IMPORT',
      promptInjectionFlagged: false,
      disabled: false,
    });
    expect(official).toBeGreaterThan(founder);
    expect(founder).toBeGreaterThan(browse);
    expect(browse).toBeGreaterThan(manual);
  });

  it('penalizes a source whose payload was flagged for prompt injection', () => {
    const clean = computeReliabilityScore({
      sourceType: 'PERMITTED_BROWSER_RESEARCH',
      promptInjectionFlagged: false,
      disabled: false,
    });
    const flagged = computeReliabilityScore({
      sourceType: 'PERMITTED_BROWSER_RESEARCH',
      promptInjectionFlagged: true,
      disabled: false,
    });
    expect(flagged).toBeLessThan(clean);
  });

  it('forces reliability to 0 for a disabled contract, regardless of source type', () => {
    const score = computeReliabilityScore({
      sourceType: 'OFFICIAL_API',
      promptInjectionFlagged: false,
      disabled: true,
    });
    expect(score).toBe(0);
  });

  it('never goes below 0 even when disabled and flagged together', () => {
    const score = computeReliabilityScore({
      sourceType: 'MANUAL_IMPORT',
      promptInjectionFlagged: true,
      disabled: true,
    });
    expect(score).toBe(0);
  });
});
