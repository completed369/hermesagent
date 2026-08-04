import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceCapabilityAdmission: vi.fn(),
  getTemporalClient: vi.fn(),
  ventureProposalFindFirst: vi.fn(),
  listingVersionFindFirst: vi.fn(),
  marketplaceAccountFindFirst: vi.fn(),
}));

vi.mock('../common/policy/capability-admission', () => ({
  enforceCapabilityAdmission: mocks.enforceCapabilityAdmission,
}));
vi.mock('@ventureos/config', () => ({
  loadEnv: () => ({ STORAGE_PROVIDER: 'mock', TEMPORAL_TASK_QUEUE: 'ventureos' }),
}));
vi.mock('@ventureos/workflows', () => ({
  getTemporalClient: mocks.getTemporalClient,
}));
vi.mock('@ventureos/database', () => ({
  CapabilityPolicyDeniedError: class CapabilityPolicyDeniedError extends Error {},
  Prisma: {},
  prisma: {
    ventureProposal: { findFirst: mocks.ventureProposalFindFirst },
    listingVersion: { findFirst: mocks.listingVersionFindFirst },
    marketplaceAccount: { findFirst: mocks.marketplaceAccountFindFirst },
  },
}));
vi.mock('@ventureos/marketplace-connectors', () => ({
  MarketplaceBlockedError: class MarketplaceBlockedError extends Error {},
  prepareListingForPublication: vi.fn(),
  requestPublicationApproval: vi.fn(),
  publishListing: vi.fn(),
}));

import { MarketplaceService } from './marketplace/marketplace.service';
import { ProductsService } from './products/products.service';

const auditService = { record: vi.fn() };

describe('multi-capability workflow admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ventureProposalFindFirst.mockResolvedValue({ id: 'proposal' });
    mocks.listingVersionFindFirst.mockResolvedValue({
      id: 'listing-version',
      listing: { marketplace: 'etsy' },
      publicationAttempts: [],
      approvalRequests: [],
    });
    mocks.marketplaceAccountFindFirst.mockResolvedValue(null);
  });

  it('does not contact Temporal when product storage admission is denied', async () => {
    mocks.enforceCapabilityAdmission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Operation is not available'));
    const service = new ProductsService(auditService as never);

    await expect(service.startGeneration('workspace', 'proposal', 'actor')).rejects.toThrow(
      'Operation is not available',
    );
    expect(mocks.enforceCapabilityAdmission).toHaveBeenNthCalledWith(
      2,
      'workspace',
      'STORAGE_UPLOAD',
      'mock',
    );
    expect(mocks.getTemporalClient).not.toHaveBeenCalled();
  });

  it('does not contact Temporal when a new marketplace connection exceeds admission', async () => {
    mocks.enforceCapabilityAdmission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Operation is not available'));
    const service = new MarketplaceService(auditService as never);

    await expect(service.startWorkflow('workspace', 'listing-version', 'actor')).rejects.toThrow(
      'Operation is not available',
    );
    expect(mocks.enforceCapabilityAdmission).toHaveBeenNthCalledWith(
      2,
      'workspace',
      'MARKETPLACE_CONNECTION',
    );
    expect(mocks.getTemporalClient).not.toHaveBeenCalled();
  });
});
