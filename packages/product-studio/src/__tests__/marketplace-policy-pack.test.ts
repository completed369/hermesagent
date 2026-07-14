import { describe, expect, it } from 'vitest';
import {
  ETSY_DEV_PACK_CONTENT,
  ETSY_MARKETPLACE,
  ETSY_DEV_PACK_VERSION,
  isPolicyPackVersionExpired,
} from '../marketplace-policy-pack';

describe('ETSY_DEV_PACK_CONTENT', () => {
  it('is draft-mode-only (no live publication capability)', () => {
    expect(ETSY_DEV_PACK_CONTENT.draftModeOnly).toBe(true);
  });

  it('requires founder approval before publication', () => {
    expect(ETSY_DEV_PACK_CONTENT.publicationRequirements).toContain('founder approval');
    expect(ETSY_DEV_PACK_CONTENT.approvalRequirements.length).toBeGreaterThan(0);
  });

  it('declares a non-empty set of supported product types and pricing bounds', () => {
    expect(ETSY_DEV_PACK_CONTENT.supportedProductTypes.length).toBeGreaterThan(0);
    const pricing = ETSY_DEV_PACK_CONTENT.pricingRules as {
      minPriceEur: number;
      maxPriceEur: number;
    };
    expect(pricing.minPriceEur).toBeGreaterThan(0);
    expect(pricing.maxPriceEur).toBeGreaterThan(pricing.minPriceEur);
  });

  it('exposes stable identifiers', () => {
    expect(ETSY_MARKETPLACE).toBe('etsy');
    expect(ETSY_DEV_PACK_VERSION).toBe('v1');
  });
});

describe('isPolicyPackVersionExpired', () => {
  it('returns false when now is before reviewDueAt', () => {
    const reviewDueAt = new Date('2027-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:00:00Z');
    expect(isPolicyPackVersionExpired(reviewDueAt, now)).toBe(false);
  });

  it('returns true when now is after reviewDueAt', () => {
    const reviewDueAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2027-01-01T00:00:00Z');
    expect(isPolicyPackVersionExpired(reviewDueAt, now)).toBe(true);
  });

  it('returns false exactly at the boundary (not strictly after)', () => {
    const reviewDueAt = new Date('2026-01-01T00:00:00Z');
    expect(isPolicyPackVersionExpired(reviewDueAt, reviewDueAt)).toBe(false);
  });
});
