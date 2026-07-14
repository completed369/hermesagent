/**
 * The Etsy Digital Products -- Development Pack (master spec section 21).
 * Mock and draft-only: this content describes what a real integration would
 * need to satisfy, but no live Etsy account or API call exists anywhere in
 * Phase 4 -- the `Integration` row for 'etsy' stays `mode: MOCK`,
 * `writeEnabled: false` until Phase 6's explicit founder-approved setup.
 */
export const ETSY_MARKETPLACE = 'etsy';
export const ETSY_DEV_PACK_VERSION = 'v1';

export interface MarketplacePolicyPackContent {
  supportedProductTypes: string[];
  listingFieldRequirements: Record<string, unknown>;
  imageRequirements: Record<string, unknown>;
  fileRequirements: Record<string, unknown>;
  restrictedCategories: string[];
  ipChecks: string[];
  pricingRules: Record<string, unknown>;
  apiCapabilities: string[];
  draftModeOnly: boolean;
  publicationRequirements: string[];
  rateLimits: Record<string, unknown>;
  approvalRequirements: string[];
}

export const ETSY_DEV_PACK_CONTENT: MarketplacePolicyPackContent = {
  supportedProductTypes: ['DIGITAL_TEMPLATE_BUNDLE', 'PRINTABLE', 'PLANNER', 'SPREADSHEET_TOOL'],
  listingFieldRequirements: {
    title: { maxLength: 140, required: true },
    description: { maxLength: 5000, required: true },
    tags: { max: 13, maxLengthEach: 20 },
    category: { required: true },
  },
  imageRequirements: { minCount: 1, maxCount: 10, minWidthPx: 2000, formats: ['PNG', 'JPEG'] },
  fileRequirements: {
    maxFileCount: 5,
    maxTotalSizeMb: 20,
    allowedTypes: ['PDF', 'ZIP', 'CSV', 'PNG', 'JPEG'],
  },
  restrictedCategories: ['adult content', 'weapons', 'counterfeit goods'],
  ipChecks: ['no third-party trademarks', 'no copyrighted stock imagery without a licence'],
  pricingRules: { minPriceEur: 0.2, maxPriceEur: 5000, currency: 'EUR' },
  apiCapabilities: [
    'create_draft_listing',
    'update_draft_listing',
    'upload_listing_image',
    'upload_digital_file',
  ],
  draftModeOnly: true,
  publicationRequirements: ['founder approval', 'QA passed', 'licence complete', 'SEO evaluated'],
  rateLimits: { requestsPerSecond: 5, requestsPerDay: 5000 },
  approvalRequirements: ['founder ApprovalRequest decided APPROVE or APPROVE_WITH_CONDITIONS'],
};

/** POL-010's real check, once a real reviewDueAt/lastVerifiedAt exists on the seeded pack version. */
export function isPolicyPackVersionExpired(reviewDueAt: Date, now: Date = new Date()): boolean {
  return now.getTime() > reviewDueAt.getTime();
}
