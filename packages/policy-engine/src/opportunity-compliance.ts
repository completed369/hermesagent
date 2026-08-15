export const OPPORTUNITY_COMPLIANCE_FORMULA_VERSION = 'opportunity-compliance-v1';

export type OpportunityComplianceBlockerCode =
  | 'MARKETPLACE_MISSING'
  | 'POLICY_PACK_MISSING'
  | 'POLICY_PACK_MARKETPLACE_MISMATCH'
  | 'POLICY_PACK_INACTIVE'
  | 'POLICY_PACK_EXPIRED'
  | 'PRODUCT_TYPE_MISSING'
  | 'PRODUCT_TYPE_UNSUPPORTED'
  | 'CATEGORY_DECLARATION_MISSING'
  | 'RESTRICTED_CATEGORY'
  | 'THIRD_PARTY_TRADEMARK'
  | 'UNLICENSED_COPYRIGHTED_STOCK'
  | 'EVIDENCE_MISSING';

export interface OpportunityCompliancePolicyPack {
  marketplace: string;
  version: string;
  isActive: boolean;
  reviewDueAt: Date | string;
  supportedProductTypes: string[];
  restrictedCategories: string[];
  ipChecks: string[];
}

export interface OpportunityComplianceInput {
  marketplace: string | null | undefined;
  productType: string | null | undefined;
  declaredCategories: string[];
  thirdPartyTrademarksPresent: boolean;
  copyrightedStockWithoutLicence: boolean;
  evidenceClaimIds: string[];
  policyPack: OpportunityCompliancePolicyPack | null;
  now?: Date;
}

export interface OpportunityComplianceBlocker {
  code: OpportunityComplianceBlockerCode;
  reason: string;
}

export interface OpportunityComplianceResult {
  formulaVersion: string;
  result: 'PASS' | 'BLOCKED';
  hasCriticalBlocker: boolean;
  blockers: OpportunityComplianceBlocker[];
  normalizedProductType: string | null;
  evaluatedAt: string;
}

export function normalizeComplianceToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeProductType(value: string): string {
  return normalizeComplianceToken(value).replaceAll(' ', '_').toUpperCase();
}

function validDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new RangeError('policyPack.reviewDueAt must be valid');
  return date;
}

/**
 * Gate-1 compliance assessment. This function never calls an AI model and
 * never infers approval from free-text agent output. It evaluates explicit
 * founder declarations against the current versioned marketplace policy pack
 * and fails closed when required policy/evidence context is missing.
 */
export function evaluateOpportunityCompliance(
  input: OpportunityComplianceInput,
): OpportunityComplianceResult {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be valid');

  const blockers: OpportunityComplianceBlocker[] = [];
  const marketplace = input.marketplace?.trim() || null;
  const productType = input.productType?.trim() || null;
  const normalizedProductType = productType ? normalizeProductType(productType) : null;

  if (!marketplace) {
    blockers.push({
      code: 'MARKETPLACE_MISSING',
      reason: 'A target marketplace is required for the compliance assessment.',
    });
  }

  if (!input.policyPack) {
    blockers.push({
      code: 'POLICY_PACK_MISSING',
      reason: 'No active marketplace policy pack is available for assessment.',
    });
  } else {
    const packMarketplace = normalizeComplianceToken(input.policyPack.marketplace);
    const requestedMarketplace = marketplace ? normalizeComplianceToken(marketplace) : null;
    if (requestedMarketplace && packMarketplace !== requestedMarketplace) {
      blockers.push({
        code: 'POLICY_PACK_MARKETPLACE_MISMATCH',
        reason: 'The loaded policy pack does not match the opportunity marketplace.',
      });
    }
    if (!input.policyPack.isActive) {
      blockers.push({
        code: 'POLICY_PACK_INACTIVE',
        reason: 'The marketplace policy pack is inactive.',
      });
    }
    if (validDate(input.policyPack.reviewDueAt).getTime() < now.getTime()) {
      blockers.push({
        code: 'POLICY_PACK_EXPIRED',
        reason: 'The marketplace policy pack is past its review-due date.',
      });
    }

    if (!normalizedProductType) {
      blockers.push({
        code: 'PRODUCT_TYPE_MISSING',
        reason: 'A product type is required to evaluate marketplace support.',
      });
    } else {
      const supported = new Set(input.policyPack.supportedProductTypes.map(normalizeProductType));
      if (!supported.has(normalizedProductType)) {
        blockers.push({
          code: 'PRODUCT_TYPE_UNSUPPORTED',
          reason: `Product type ${normalizedProductType} is not supported by policy pack ${input.policyPack.version}.`,
        });
      }
    }

    const declaredCategories = input.declaredCategories
      .map(normalizeComplianceToken)
      .filter(Boolean);
    if (declaredCategories.length === 0) {
      blockers.push({
        code: 'CATEGORY_DECLARATION_MISSING',
        reason: 'At least one product/category declaration is required.',
      });
    } else {
      const restricted = input.policyPack.restrictedCategories
        .map(normalizeComplianceToken)
        .filter(Boolean);
      const matches = declaredCategories.filter((category) =>
        restricted.some(
          (blockedCategory) => category === blockedCategory || category.includes(blockedCategory),
        ),
      );
      if (matches.length > 0) {
        blockers.push({
          code: 'RESTRICTED_CATEGORY',
          reason: `Restricted marketplace category declared: ${matches.join(', ')}.`,
        });
      }
    }

    const checks = input.policyPack.ipChecks.map(normalizeComplianceToken);
    if (input.thirdPartyTrademarksPresent && checks.some((check) => check.includes('trademark'))) {
      blockers.push({
        code: 'THIRD_PARTY_TRADEMARK',
        reason: 'Third-party trademark use conflicts with the current marketplace IP policy check.',
      });
    }
    if (
      input.copyrightedStockWithoutLicence &&
      checks.some(
        (check) =>
          check.includes('copyright') || check.includes('stock') || check.includes('licence'),
      )
    ) {
      blockers.push({
        code: 'UNLICENSED_COPYRIGHTED_STOCK',
        reason:
          'Copyrighted stock content without a licence conflicts with the current IP policy check.',
      });
    }
  }

  if (new Set(input.evidenceClaimIds).size === 0) {
    blockers.push({
      code: 'EVIDENCE_MISSING',
      reason: 'At least one opportunity evidence claim is required for compliance review.',
    });
  }

  return {
    formulaVersion: OPPORTUNITY_COMPLIANCE_FORMULA_VERSION,
    result: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    hasCriticalBlocker: blockers.length > 0,
    blockers,
    normalizedProductType,
    evaluatedAt: now.toISOString(),
  };
}
