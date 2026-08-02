import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashProductListingBundle } from '@ventureos/security';

const mocks = vi.hoisted(() => ({
  approvalRequestFindFirst: vi.fn(),
  approvalRequestUpdate: vi.fn(),
  productPackageFindUnique: vi.fn(),
  productPackageFindFirst: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  enforceWorkspaceCapability: vi.fn(),
  prisma: {
    approvalRequest: {
      findFirst: mocks.approvalRequestFindFirst,
      update: mocks.approvalRequestUpdate,
    },
    productPackage: {
      findUnique: mocks.productPackageFindUnique,
      findFirst: mocks.productPackageFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

import { ApprovalInvalidForExecutionError, decideApprovalRequest } from '../approval-runner';

const listing = {
  id: 'listing-version',
  listingId: 'listing',
  title: 'Title',
  description: 'Description',
  tags: ['template'],
  category: 'templates',
  currency: 'EUR',
  priceEur: { toString: () => '10' },
  images: [],
  files: [],
  listing: { workspaceId: 'workspace', productVersionId: 'product-version' },
};

const artifact = {
  assetVersionIds: ['asset-version'],
  listing,
  images: listing.images,
  files: listing.files,
};

describe('product-listing approval decision policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.approvalRequestFindFirst.mockResolvedValue({
      id: 'approval',
      workspaceId: 'workspace',
      kind: 'PRODUCT_LISTING',
      state: 'PENDING',
      productPackageId: 'package',
      packageHash: hashProductListingBundle(artifact),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    mocks.productPackageFindUnique.mockResolvedValue({
      id: 'package',
      productVersionId: 'product-version',
    });
    mocks.approvalRequestUpdate.mockResolvedValue({});
  });

  it('expires same-package approval when canonical listing content drifted', async () => {
    mocks.productPackageFindFirst.mockResolvedValue({
      id: 'package',
      productVersionId: 'product-version',
      listingVersionId: 'listing-version',
      assetVersionIds: artifact.assetVersionIds,
      listingVersion: { ...listing, category: 'printables' },
    });

    await expect(
      decideApprovalRequest({
        workspaceId: 'workspace',
        approvalRequestId: 'approval',
        founderIdentity: 'founder',
        decision: 'APPROVE',
      }),
    ).rejects.toBeInstanceOf(ApprovalInvalidForExecutionError);

    expect(mocks.approvalRequestUpdate).toHaveBeenCalledWith({
      where: { id: 'approval' },
      data: { state: 'EXPIRED' },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
