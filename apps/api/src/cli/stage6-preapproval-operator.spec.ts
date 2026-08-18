import fs from 'node:fs';
import path from 'node:path';
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
    { status: 'COMPLETED', meetsThreshold: null, blocked: false },
    { status: 'COMPLETED', meetsThreshold: true, blocked: null },
  ])('fails closed for non-passing board state %#', (review) => {
    expect(() => assertStage6BoardOutcome(review)).toThrowError(Stage6OperatorGateError);
  });

  it('contains no founder-approval decision capability or direct business-state writes', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'stage6-preapproval-operator.ts'),
      'utf8',
    );

    const forbiddenText = [
      'ApprovalsService',
      'decideApprovalRequest',
      "from '../modules/approvals",
      "from '@ventureos/agent-runtime'",
      'founderDecisionSignal',
      'approval:decide',
    ];
    for (const value of forbiddenText) {
      expect(source.includes(value), value).toBe(false);
    }

    const forbiddenWrites = [
      /prisma\.opportunity\.create\(/,
      /prisma\.evidenceArtifact\.create\(/,
      /prisma\.evidenceClaim\.create\(/,
      /prisma\.ventureProposal\.create\(/,
      /prisma\.boardReview\.create\(/,
      /prisma\.approvalRequest\.create\(/,
      /prisma\.\$executeRaw/,
      /prisma\.\$queryRaw/,
    ];
    for (const pattern of forbiddenWrites) {
      expect(pattern.test(source), pattern.source).toBe(false);
    }

    expect(source).toContain("result: 'FOUNDER_APPROVAL_REQUIRED'");
    expect(source).toContain("approval.state !== 'PENDING'");
    expect(source).toContain('opportunitiesService.create(');
    expect(source).toContain('opportunitiesService.assessCompliance(');
    expect(source).toContain('opportunitiesService.promote(');
    expect(source).toContain('boardService.startReview(');
  });
});
