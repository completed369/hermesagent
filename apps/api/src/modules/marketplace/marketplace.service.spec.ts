import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listingVersionFindFirst: vi.fn(),
  prepareListingForPublication: vi.fn(),
  publishListing: vi.fn(),
  enforceCapabilityAdmission: vi.fn(),
  auditRecord: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  CapabilityPolicyDeniedError: class CapabilityPolicyDeniedError extends Error {},
  Prisma: {},
  prisma: {
    listingVersion: { findFirst: mocks.listingVersionFindFirst },
    marketplaceAccount: { findFirst: vi.fn() },
  },
}));
vi.mock('@ventureos/config', () => ({ loadEnv: vi.fn() }));
vi.mock('@ventureos/workflows', () => ({ getTemporalClient: vi.fn() }));
vi.mock('@ventureos/marketplace-connectors', () => ({
  MarketplaceBlockedError: class MarketplaceBlockedError extends Error {},
  prepareListingForPublication: mocks.prepareListingForPublication,
  requestPublicationApproval: vi.fn(),
  publishListing: mocks.publishListing,
  publicationPreparationAuditAction: (status: string) =>
    status === 'READY_FOR_PUBLISH'
      ? 'PUBLICATION_PREPARED'
      : status === 'FAILED'
        ? 'PUBLICATION_PREPARATION_FAILED'
        : 'PUBLICATION_PREPARATION_BLOCKED',
}));
vi.mock('../../common/policy/capability-admission', () => ({
  enforceCapabilityAdmission: mocks.enforceCapabilityAdmission,
}));

import { MarketplaceService } from './marketplace.service';

describe('MarketplaceService publication audit semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listingVersionFindFirst.mockResolvedValue({ id: 'listing-version' });
    mocks.enforceCapabilityAdmission.mockResolvedValue(undefined);
  });

  it.each([
    [true, 'PUBLICATION_REPLAYED'],
    [false, 'PUBLICATION_PUBLISHED'],
  ])('records replayed=%s as %s', async (replayed, expectedAction) => {
    mocks.publishListing.mockResolvedValue({
      publicationAttemptId: replayed ? 'original-attempt' : 'fresh-attempt',
      status: 'PUBLISHED',
      blockedReason: null,
      externalListingId: 'external-id',
      externalListingUrl: 'https://mock.example/external-id',
      replayed,
    });
    const service = new MarketplaceService({ record: mocks.auditRecord } as never);

    await service.publish('workspace', 'listing-version', 'approval', 'actor');

    expect(mocks.auditRecord).toHaveBeenCalledWith(
      'workspace',
      expect.objectContaining({ action: expectedAction }),
    );
  });

  it.each([
    ['BLOCKED_DISABLED', 'PUBLICATION_PREPARATION_BLOCKED'],
    ['FAILED', 'PUBLICATION_PREPARATION_FAILED'],
  ])('records prepare status %s truthfully as %s', async (status, expectedAction) => {
    mocks.prepareListingForPublication.mockResolvedValue({
      publicationAttemptId: 'attempt',
      status,
      blockedReason: 'synthetic block',
      externalListingId: null,
      externalListingUrl: null,
      replayed: false,
    });
    const service = new MarketplaceService({ record: mocks.auditRecord } as never);

    await service.prepare('workspace', 'listing-version', 'actor');

    expect(mocks.auditRecord).toHaveBeenCalledWith(
      'workspace',
      expect.objectContaining({ action: expectedAction }),
    );
  });
});
