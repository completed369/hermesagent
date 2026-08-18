import { describe, expect, it } from 'vitest';
import {
  Stage6OperatorGateError,
  assertStage6BoardOutcome,
  assertStage6ScoreThresholds,
} from './stage6-preapproval-operator';

describe('Stage 6 preapproval operator gates', () => {
  it('accepts all three commercial scores at the documented threshold', () => {
    expect(() =>
      assertStage6ScoreThresholds({
        OPPORTUNITY: 70,
        PROFIT_CONFIDENCE: 70,
        EVIDENCE_QUALITY: 70,
      }),
    ).not.toThrow();
  });

  it('fails closed when any required score is below 70', () => {
    expect(() =>
      assertStage6ScoreThresholds({
        OPPORTUNITY: 76,
        PROFIT_CONFIDENCE: 69.99,
        EVIDENCE_QUALITY: 78,
      }),
    ).toThrowError(Stage6OperatorGateError);
  });

  it('accepts only a completed, unblocked board review that met threshold', () => {
    expect(() =>
      assertStage6BoardOutcome({ status: 'COMPLETED', meetsThreshold: true, blocked: false }),
    ).not.toThrow();
  });

  it.each([
    { status: 'RUNNING', meetsThreshold: true, blocked: false },
    { status: 'COMPLETED', meetsThreshold: false, blocked: false },
    { status: 'COMPLETED', meetsThreshold: true, blocked: true },
  ])('fails closed for non-passing board state %#', (review) => {
    expect(() => assertStage6BoardOutcome(review)).toThrowError(Stage6OperatorGateError);
  });
});
