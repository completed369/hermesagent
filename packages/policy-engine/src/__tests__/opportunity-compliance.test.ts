import { describe, expect, it } from 'vitest';
import {
  evaluateOpportunityCompliance,
  OPPORTUNITY_COMPLIANCE_FORMULA_VERSION,
} from '../opportunity-compliance';

const now = new Date('2026-08-15T09:00:00.000Z');
const policyPack = {
  marketplace: 'etsy',
  version: 'v1',
  isActive: true,
  reviewDueAt: '2027-01-01T00:00:00.000Z',
  supportedProductTypes: ['DIGITAL_TEMPLATE_BUNDLE', 'PRINTABLE'],
  restrictedCategories: ['adult content', 'weapons', 'counterfeit goods'],
  ipChecks: ['no third-party trademarks', 'no copyrighted stock imagery without a licence'],
};

function validInput() {
  return {
    marketplace: 'etsy',
    productType: 'Digital Template Bundle',
    declaredCategories: ['digital planning templates'],
    thirdPartyTrademarksPresent: false,
    copyrightedStockWithoutLicence: false,
    evidenceClaimIds: ['11111111-1111-4111-8111-111111111111'],
    policyPack,
    now,
  };
}

describe('evaluateOpportunityCompliance', () => {
  it('passes a supported, current and evidenced opportunity', () => {
    const result = evaluateOpportunityCompliance(validInput());
    expect(result.formulaVersion).toBe(OPPORTUNITY_COMPLIANCE_FORMULA_VERSION);
    expect(result.result).toBe('PASS');
    expect(result.hasCriticalBlocker).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.normalizedProductType).toBe('DIGITAL_TEMPLATE_BUNDLE');
  });

  it('fails closed when the policy pack is absent', () => {
    const result = evaluateOpportunityCompliance({ ...validInput(), policyPack: null });
    expect(result.result).toBe('BLOCKED');
    expect(result.blockers.map((blocker) => blocker.code)).toContain('POLICY_PACK_MISSING');
  });

  it('blocks an expired policy pack', () => {
    const result = evaluateOpportunityCompliance({
      ...validInput(),
      policyPack: { ...policyPack, reviewDueAt: '2026-08-14T00:00:00.000Z' },
    });
    expect(result.blockers.map((blocker) => blocker.code)).toContain('POLICY_PACK_EXPIRED');
  });

  it('blocks an unsupported product type', () => {
    const result = evaluateOpportunityCompliance({ ...validInput(), productType: 'Digital Guide' });
    expect(result.blockers.map((blocker) => blocker.code)).toContain('PRODUCT_TYPE_UNSUPPORTED');
  });

  it('blocks a restricted declared category', () => {
    const result = evaluateOpportunityCompliance({
      ...validInput(),
      declaredCategories: ['Printable weapons catalogue'],
    });
    expect(result.blockers.map((blocker) => blocker.code)).toContain('RESTRICTED_CATEGORY');
  });

  it('blocks explicit trademark and unlicensed copyrighted-stock declarations', () => {
    const result = evaluateOpportunityCompliance({
      ...validInput(),
      thirdPartyTrademarksPresent: true,
      copyrightedStockWithoutLicence: true,
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(['THIRD_PARTY_TRADEMARK', 'UNLICENSED_COPYRIGHTED_STOCK']),
    );
  });

  it('fails closed when opportunity evidence is absent', () => {
    const result = evaluateOpportunityCompliance({ ...validInput(), evidenceClaimIds: [] });
    expect(result.blockers.map((blocker) => blocker.code)).toContain('EVIDENCE_MISSING');
  });
});
