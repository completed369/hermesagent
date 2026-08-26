import { createHash } from 'node:crypto';
import {
  ETSY_DEV_PACK_CONTENT,
  ETSY_DEV_PACK_VERSION,
  ETSY_MARKETPLACE,
} from '@ventureos/product-studio/dist/marketplace-policy-pack.js';
import {
  calculateOpportunityScore,
  OPPORTUNITY_SCORE_FORMULA_VERSION,
} from '@ventureos/scoring-engine';
import { normalizeComplianceToken, normalizeProductType } from '@ventureos/policy-engine';
import { stage6PilotInputSchema, type Stage6PilotInput } from './stage6-pilot-input';

const NEAR_EXPIRY_HOURS = 30 * 24;

export const STAGE6_PREFLIGHT_VERSION = 'stage6-pilot-preflight-v1';
export const REVIEWED_STAGE6_PILOT_INPUT_DIGEST =
  '3cd676bc16309844db448a871c045548f64814d2bdcf09edb182aa72c29bebfa';

const REQUIRED_BLOCKERS = [
  'AUTHORITATIVE_POLICY_STATE_REQUIRED',
  'AUTHORITATIVE_TITLE_UNIQUENESS_REQUIRED',
  'AUTHORITATIVE_IDEMPOTENCY_STATE_REQUIRED',
  'AUTHORITATIVE_GATE_EXECUTION_REQUIRED',
  'AUTHORITATIVE_LISTING_POLICY_REVALIDATION_REQUIRED',
  'FOUNDER_APPROVAL_REQUIRED',
  'PUBLICATION_STATE_REVALIDATION_REQUIRED',
  'PRIVATE_STAGING_STATE_REVALIDATION_REQUIRED',
] as const;

const EVALUATED_SOURCE_INPUT_CRITERIA = [
  'marketplace-identifier',
  'supported-product-type',
  'restricted-category-declarations',
  'declared-trademark-presence',
  'declared-unlicensed-stock-presence',
  'title-length',
] as const;

const NOT_EVALUATED_SOURCE_CRITERIA = [
  'authoritative-policy-active-state',
  'authoritative-policy-review-due-state',
  'listing-description-and-tags',
  'listing-images',
  'digital-files',
  'pricing',
  'publication-requirements',
  'marketplace-account-or-api-state',
] as const;

const SAFE_SUPPORTED_PRODUCT_TYPE_CODES = [
  'DIGITAL_TEMPLATE_BUNDLE',
  'PRINTABLE',
  'PLANNER',
  'SPREADSHEET_TOOL',
] as const;

type SafeSupportedProductTypeCode = (typeof SAFE_SUPPORTED_PRODUCT_TYPE_CODES)[number];

const EXPECTED_KEYS = {
  root: ['pilot', 'compliance'],
  pilot: [
    'title',
    'description',
    'suggestedProductType',
    'suggestedMarketplace',
    'estimatedCostEur',
    'estimatedRevenueEur',
    'timeToLaunchDays',
    'risks',
    'targetCustomer',
    'channels',
    'evidence',
    'opportunityFactors',
    'profitConfidenceFactors',
  ],
  compliance: [
    'declaredCategories',
    'thirdPartyTrademarksPresent',
    'copyrightedStockWithoutLicence',
  ],
  targetCustomer: ['persona', 'painPoints', 'buyingTriggers'],
  channel: ['channel', 'rationale', 'priority'],
  evidence: [
    'sourceName',
    'sourceType',
    'sourceIdentifier',
    'retrievedAt',
    'freshnessRequirementHours',
    'region',
    'language',
    'collectionMethod',
    'originalExcerpt',
    'relevanceScore',
    'expiryDate',
    'termsOfUseNote',
    'personalDataClassification',
    'claimType',
    'statement',
    'value',
  ],
  opportunityFactors: [
    'demand',
    'trendStrength',
    'competitionAttractiveness',
    'expectedMargin',
    'productDifferentiation',
    'productionFeasibility',
    'organicMarketingPotential',
    'marketplacePolicyRisk',
    'intellectualPropertyRisk',
    'evidenceConfidence',
    'timeToLaunch',
  ],
  profitConfidenceFactors: [
    'sampleSize',
    'costCertainty',
    'marketplaceFeeCertainty',
    'comparableProductQuality',
    'forecastRangeWidth',
    'historicalModelAccuracy',
    'channelMaturity',
    'assumptionSensitivity',
  ],
} as const;

type EvidenceState = 'CURRENT' | 'NEAR_EXPIRY' | 'EXPIRED';

export interface Stage6PilotPreflightPacket {
  preflightVersion: typeof STAGE6_PREFLIGHT_VERSION;
  result: 'PREPARED_BLOCKED';
  evaluatedAt: string;
  pilot: {
    key: string;
    inputDigest: string;
    titleDigest: string;
  };
  sourceInputCompatibility: {
    result: 'SUPPORTED_SUBSET' | 'INCOMPATIBLE';
    marketplace: string;
    policyPackVersion: string;
    supportedProductTypeCode: SafeSupportedProductTypeCode | null;
    evaluatedCriteria: string[];
    notEvaluatedCriteria: string[];
    riskCodes: string[];
  };
  opportunityScore: {
    formulaVersion: typeof OPPORTUNITY_SCORE_FORMULA_VERSION;
    score: number;
  };
  evidence: {
    count: number;
    sourceClasses: string[];
    personalDataClassifications: string[];
    state: EvidenceState;
    earliestExpiryAt: string;
    hoursUntilEarliestExpiry: number;
    riskCodes: string[];
  };
  execution: {
    persistencePerformed: false;
    dispatchPerformed: false;
    contactPerformed: false;
    providerActivated: false;
  };
  inputProvenance: {
    reviewedFixtureDigestMatch: boolean;
    productionRunnerInputMode: 'FIXED_REVIEWED_FIXTURE';
  };
  blockers: string[];
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExpectedKeys(
  value: unknown,
  expected: readonly string[],
  path: string,
): Record<string, unknown> {
  const object = objectAt(value, path);
  const unexpected = Object.keys(object).filter((key) => !expected.includes(key));
  if (unexpected.length > 0) throw new TypeError(`${path} contains unexpected fields`);
  return object;
}

function assertStrictPreflightShape(rawInput: unknown): void {
  const root = assertExpectedKeys(rawInput, EXPECTED_KEYS.root, 'input');
  const pilot = assertExpectedKeys(root.pilot, EXPECTED_KEYS.pilot, 'pilot');
  assertExpectedKeys(root.compliance, EXPECTED_KEYS.compliance, 'compliance');
  assertExpectedKeys(pilot.targetCustomer, EXPECTED_KEYS.targetCustomer, 'pilot.targetCustomer');
  if (Array.isArray(pilot.channels)) {
    pilot.channels.forEach((channel, index) =>
      assertExpectedKeys(channel, EXPECTED_KEYS.channel, `pilot.channels.${index}`),
    );
  }
  if (Array.isArray(pilot.evidence)) {
    pilot.evidence.forEach((evidence, index) =>
      assertExpectedKeys(evidence, EXPECTED_KEYS.evidence, `pilot.evidence.${index}`),
    );
  }
  assertExpectedKeys(
    pilot.opportunityFactors,
    EXPECTED_KEYS.opportunityFactors,
    'pilot.opportunityFactors',
  );
  assertExpectedKeys(
    pilot.profitConfidenceFactors,
    EXPECTED_KEYS.profitConfidenceFactors,
    'pilot.profitConfidenceFactors',
  );
}

function calculateEvidenceExpiry(evidence: Stage6PilotInput['pilot']['evidence'][number]): Date {
  const retrievedAt = new Date(evidence.retrievedAt);
  const freshnessExpiry = new Date(
    retrievedAt.getTime() + evidence.freshnessRequirementHours * 60 * 60 * 1000,
  );
  if (!evidence.expiryDate) return freshnessExpiry;
  const declaredExpiry = new Date(evidence.expiryDate);
  return declaredExpiry.getTime() < freshnessExpiry.getTime() ? declaredExpiry : freshnessExpiry;
}

function sourceInputCompatibility(input: Stage6PilotInput): {
  compatible: boolean;
  normalizedProductType: string | null;
  riskCodes: string[];
} {
  const risks: string[] = [];
  const marketplace = normalizeComplianceToken(input.pilot.suggestedMarketplace ?? '');
  const normalizedProductType = input.pilot.suggestedProductType
    ? normalizeProductType(input.pilot.suggestedProductType)
    : null;

  if (marketplace !== normalizeComplianceToken(ETSY_MARKETPLACE)) {
    risks.push('MARKETPLACE_SOURCE_MISMATCH');
  }
  if (
    !normalizedProductType ||
    !ETSY_DEV_PACK_CONTENT.supportedProductTypes
      .map(normalizeProductType)
      .includes(normalizedProductType)
  ) {
    risks.push('PRODUCT_TYPE_SOURCE_UNSUPPORTED');
  }
  const restricted = ETSY_DEV_PACK_CONTENT.restrictedCategories.map(normalizeComplianceToken);
  const declared = input.compliance.declaredCategories.map(normalizeComplianceToken);
  if (
    declared.some((category) =>
      restricted.some(
        (restrictedCategory) =>
          category === restrictedCategory || category.includes(restrictedCategory),
      ),
    )
  ) {
    risks.push('RESTRICTED_CATEGORY_DECLARED');
  }
  if (input.compliance.thirdPartyTrademarksPresent) risks.push('THIRD_PARTY_TRADEMARK_DECLARED');
  if (input.compliance.copyrightedStockWithoutLicence) {
    risks.push('UNLICENSED_COPYRIGHTED_STOCK_DECLARED');
  }
  const titleLimit = ETSY_DEV_PACK_CONTENT.listingFieldRequirements.title as {
    maxLength: number;
  };
  if (input.pilot.title.length > titleLimit.maxLength) risks.push('TITLE_EXCEEDS_SOURCE_LIMIT');

  return { compatible: risks.length === 0, normalizedProductType, riskCodes: risks };
}

function prepareStage6PilotPreflight(
  rawInput: unknown,
  evaluatedAt: Date,
): Stage6PilotPreflightPacket {
  if (!Number.isFinite(evaluatedAt.getTime())) throw new RangeError('evaluatedAt must be valid');
  assertStrictPreflightShape(rawInput);
  const input = stage6PilotInputSchema.parse(rawInput);
  if (input.pilot.evidence.some((item) => item.personalDataClassification !== 'NONE')) {
    throw new TypeError('offline preflight accepts only evidence classified NONE');
  }
  const compatibility = sourceInputCompatibility(input);
  const score = calculateOpportunityScore(input.pilot.opportunityFactors, evaluatedAt);
  const expiries = input.pilot.evidence.map(calculateEvidenceExpiry);
  const earliestExpiry = expiries.reduce((earliest, candidate) =>
    candidate.getTime() < earliest.getTime() ? candidate : earliest,
  );
  const hoursUntilEarliestExpiry = Math.floor(
    (earliestExpiry.getTime() - evaluatedAt.getTime()) / (60 * 60 * 1000),
  );
  const evidenceRiskCodes: string[] = [];
  let evidenceState: EvidenceState = 'CURRENT';
  if (hoursUntilEarliestExpiry < 0) {
    evidenceState = 'EXPIRED';
    evidenceRiskCodes.push('EVIDENCE_EXPIRED');
  } else if (hoursUntilEarliestExpiry <= NEAR_EXPIRY_HOURS) {
    evidenceState = 'NEAR_EXPIRY';
    evidenceRiskCodes.push('EVIDENCE_REVIEW_DUE_WITHIN_30_DAYS');
  }

  const blockers: string[] = [...REQUIRED_BLOCKERS];
  if (!compatibility.compatible) blockers.push('SOURCE_POLICY_INPUT_INCOMPATIBLE');
  if (evidenceState === 'EXPIRED') blockers.push('EVIDENCE_REFRESH_REQUIRED');

  return {
    preflightVersion: STAGE6_PREFLIGHT_VERSION,
    result: 'PREPARED_BLOCKED',
    evaluatedAt: evaluatedAt.toISOString(),
    pilot: {
      key: 'pet-sitting-operations-stage6',
      inputDigest: digest(input),
      titleDigest: digest(input.pilot.title.trim()),
    },
    sourceInputCompatibility: {
      result: compatibility.compatible ? 'SUPPORTED_SUBSET' : 'INCOMPATIBLE',
      marketplace: ETSY_MARKETPLACE,
      policyPackVersion: ETSY_DEV_PACK_VERSION,
      supportedProductTypeCode:
        SAFE_SUPPORTED_PRODUCT_TYPE_CODES.find(
          (code) => code === compatibility.normalizedProductType,
        ) ?? null,
      evaluatedCriteria: [...EVALUATED_SOURCE_INPUT_CRITERIA],
      notEvaluatedCriteria: [...NOT_EVALUATED_SOURCE_CRITERIA],
      riskCodes: compatibility.riskCodes,
    },
    opportunityScore: {
      formulaVersion: OPPORTUNITY_SCORE_FORMULA_VERSION,
      score: score.score,
    },
    evidence: {
      count: input.pilot.evidence.length,
      sourceClasses: [...new Set(input.pilot.evidence.map((item) => item.sourceType))].sort(),
      personalDataClassifications: [
        ...new Set(input.pilot.evidence.map((item) => item.personalDataClassification)),
      ].sort(),
      state: evidenceState,
      earliestExpiryAt: earliestExpiry.toISOString(),
      hoursUntilEarliestExpiry,
      riskCodes: evidenceRiskCodes,
    },
    execution: {
      persistencePerformed: false,
      dispatchPerformed: false,
      contactPerformed: false,
      providerActivated: false,
    },
    inputProvenance: {
      reviewedFixtureDigestMatch: digest(input) === REVIEWED_STAGE6_PILOT_INPUT_DIGEST,
      productionRunnerInputMode: 'FIXED_REVIEWED_FIXTURE',
    },
    blockers,
  };
}

/** Pure deterministic seam for adversarial tests. Production code must use the reviewed wrapper. */
export function prepareStage6PilotPreflightForTest(
  rawInput: unknown,
  trustedEvaluatedAt: Date,
): Stage6PilotPreflightPacket {
  return prepareStage6PilotPreflight(rawInput, trustedEvaluatedAt);
}

/** Fixed-fixture production entry: exact reviewed provenance plus the process's trusted clock. */
export function prepareReviewedStage6PilotPreflight(rawInput: unknown): Stage6PilotPreflightPacket {
  const packet = prepareStage6PilotPreflight(rawInput, new Date());
  if (!packet.inputProvenance.reviewedFixtureDigestMatch) {
    throw new TypeError('reviewed Stage 6 pilot fixture digest mismatch');
  }
  return packet;
}
