import { z } from 'zod';

export const PolicyEvaluationSchema = z.object({
  policyId: z.string(),
  policyVersion: z.string(),
  result: z.enum(['PASS', 'FAIL', 'WARN']),
  explanation: z.string(),
  inputs: z.record(z.unknown()),
  blocking: z.boolean(),
  remediation: z.string().optional(),
  evaluatedAt: z.string().datetime(),
});
export type PolicyEvaluation = z.infer<typeof PolicyEvaluationSchema>;

export interface PolicyContext {
  now: Date;
  approvalExists: boolean;
  approvalMatchesVersion: boolean;
  approvalMatchesHash: boolean;
  approvalExpired: boolean;
  requestedCostEur: number;
  approvedMaxCostEur: number;
  hasCriticalComplianceRisk: boolean;
  hasCriticalSecurityRisk: boolean;
  hasCriticalQualityIssue: boolean;
  hasMissingLicence: boolean;
  marketplacePolicyPackExpired: boolean;
  evidenceComplete: boolean;
  financialDataValid: boolean;
}

function evalResult(
  id: string,
  version: string,
  pass: boolean,
  explanation: string,
  inputs: Record<string, unknown>,
  blocking: boolean,
  now: Date,
  remediation?: string,
): PolicyEvaluation {
  return {
    policyId: id,
    policyVersion: version,
    result: pass ? 'PASS' : 'FAIL',
    explanation,
    inputs,
    blocking: !pass && blocking,
    remediation: pass ? undefined : remediation,
    evaluatedAt: now.toISOString(),
  };
}

/**
 * Evaluates the core deterministic policy set (master spec section 20).
 * Returns one PolicyEvaluation per policy; the caller must fail closed if
 * ANY blocking evaluation has result FAIL.
 */
export function evaluateCorePolicies(ctx: PolicyContext): PolicyEvaluation[] {
  const v = 'v1';
  const now = ctx.now;
  return [
    evalResult(
      'POL-001-external-publication-requires-approval',
      v,
      ctx.approvalExists,
      'External publication requires a valid founder approval record.',
      { approvalExists: ctx.approvalExists },
      true,
      now,
      'Create and obtain a founder approval before publishing.',
    ),
    evalResult(
      'POL-002-approval-matches-version',
      v,
      ctx.approvalMatchesVersion,
      'Approval must reference the exact current artefact version.',
      { approvalMatchesVersion: ctx.approvalMatchesVersion },
      true,
      now,
      'Re-request approval for the current artefact version.',
    ),
    evalResult(
      'POL-003-approval-matches-hash',
      v,
      ctx.approvalMatchesHash,
      'Approval must reference the exact current package hash.',
      { approvalMatchesHash: ctx.approvalMatchesHash },
      true,
      now,
      'Re-request approval; the package has changed since approval was granted.',
    ),
    evalResult(
      'POL-004-approval-not-expired',
      v,
      !ctx.approvalExpired,
      'Approval must not be expired.',
      { approvalExpired: ctx.approvalExpired },
      true,
      now,
      'Request a fresh approval.',
    ),
    evalResult(
      'POL-005-spending-within-max',
      v,
      ctx.requestedCostEur <= ctx.approvedMaxCostEur,
      'Spending must not exceed the approved maximum.',
      { requestedCostEur: ctx.requestedCostEur, approvedMaxCostEur: ctx.approvedMaxCostEur },
      true,
      now,
      'Reduce spend or request a higher approved maximum.',
    ),
    evalResult(
      'POL-006-no-critical-compliance-risk',
      v,
      !ctx.hasCriticalComplianceRisk,
      'Critical compliance risk blocks publication.',
      { hasCriticalComplianceRisk: ctx.hasCriticalComplianceRisk },
      true,
      now,
      'Resolve the compliance veto before proceeding.',
    ),
    evalResult(
      'POL-007-no-critical-security-risk',
      v,
      !ctx.hasCriticalSecurityRisk,
      'Critical security risk blocks execution.',
      { hasCriticalSecurityRisk: ctx.hasCriticalSecurityRisk },
      true,
      now,
      'Resolve the security veto before proceeding.',
    ),
    evalResult(
      'POL-008-no-critical-quality-issue',
      v,
      !ctx.hasCriticalQualityIssue,
      'Critical quality issue blocks publication.',
      { hasCriticalQualityIssue: ctx.hasCriticalQualityIssue },
      true,
      now,
      'Resolve the quality veto before proceeding.',
    ),
    evalResult(
      'POL-009-no-missing-licence',
      v,
      !ctx.hasMissingLicence,
      'Missing licence blocks publication.',
      { hasMissingLicence: ctx.hasMissingLicence },
      true,
      now,
      'Attach all required licence records.',
    ),
    evalResult(
      'POL-010-marketplace-pack-not-expired',
      v,
      !ctx.marketplacePolicyPackExpired,
      'Expired marketplace policy pack blocks publication.',
      { marketplacePolicyPackExpired: ctx.marketplacePolicyPackExpired },
      true,
      now,
      'Refresh/re-verify the marketplace policy pack.',
    ),
    evalResult(
      'POL-011-financial-data-valid',
      v,
      ctx.financialDataValid,
      'Invalid financial data blocks founder submission.',
      { financialDataValid: ctx.financialDataValid },
      true,
      now,
      'Fix financial assumptions/calculations before submitting.',
    ),
    evalResult(
      'POL-012-evidence-complete',
      v,
      ctx.evidenceComplete,
      'Missing evidence blocks board completion.',
      { evidenceComplete: ctx.evidenceComplete },
      true,
      now,
      'Attach required evidence records.',
    ),
  ];
}

export function hasBlockingFailure(evaluations: PolicyEvaluation[]): boolean {
  return evaluations.some((e) => e.result === 'FAIL' && e.blocking);
}
