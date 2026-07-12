import { describe, expect, it } from 'vitest';
import { evaluateCorePolicies, hasBlockingFailure, type PolicyContext } from '../policies';

const validContext: PolicyContext = {
  now: new Date('2026-01-01T00:00:00Z'),
  approvalExists: true,
  approvalMatchesVersion: true,
  approvalMatchesHash: true,
  approvalExpired: false,
  requestedCostEur: 10,
  approvedMaxCostEur: 50,
  hasCriticalComplianceRisk: false,
  hasCriticalSecurityRisk: false,
  hasCriticalQualityIssue: false,
  hasMissingLicence: false,
  marketplacePolicyPackExpired: false,
  evidenceComplete: true,
  financialDataValid: true,
};

describe('evaluateCorePolicies', () => {
  it('passes cleanly and is non-blocking for a fully valid context', () => {
    const evaluations = evaluateCorePolicies(validContext);
    expect(hasBlockingFailure(evaluations)).toBe(false);
    expect(evaluations.every((e) => e.result === 'PASS')).toBe(true);
  });

  it('fails closed when the package hash changed after approval', () => {
    const evaluations = evaluateCorePolicies({ ...validContext, approvalMatchesHash: false });
    expect(hasBlockingFailure(evaluations)).toBe(true);
  });

  it('fails closed when spending exceeds the approved maximum', () => {
    const evaluations = evaluateCorePolicies({ ...validContext, requestedCostEur: 100 });
    expect(hasBlockingFailure(evaluations)).toBe(true);
  });

  it('fails closed on a critical security risk', () => {
    const evaluations = evaluateCorePolicies({ ...validContext, hasCriticalSecurityRisk: true });
    expect(hasBlockingFailure(evaluations)).toBe(true);
  });

  it('fails closed on an expired approval', () => {
    const evaluations = evaluateCorePolicies({ ...validContext, approvalExpired: true });
    expect(hasBlockingFailure(evaluations)).toBe(true);
  });
});
