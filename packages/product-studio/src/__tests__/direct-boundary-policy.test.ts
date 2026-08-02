import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceWorkspaceCapability: vi.fn(),
  dispatchWithWorkspaceCapability: vi.fn(),
  listingUpsert: vi.fn(),
  listingVersionFind: vi.fn(),
  qualityCheckCreate: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  enforceWorkspaceCapability: mocks.enforceWorkspaceCapability,
  dispatchWithWorkspaceCapability: mocks.dispatchWithWorkspaceCapability,
  prisma: {
    listing: { upsert: mocks.listingUpsert },
    listingVersion: { findFirstOrThrow: mocks.listingVersionFind },
    qualityCheck: { create: mocks.qualityCheckCreate },
  },
  Prisma: {},
}));

import { generateListing } from '../listing-generator';
import { generateProductAssets } from '../mock-product-generator';
import { persistQualityChecks } from '../qa-checker';
import { runSeoEvaluation } from '../seo-evaluator';

const denied = new Error('Operation is not available');

describe('product-studio direct capability boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceWorkspaceCapability.mockRejectedValue(denied);
    mocks.dispatchWithWorkspaceCapability.mockRejectedValue(new Error('storage boundary reached'));
  });

  it('blocks direct asset generation before storage dispatch or tenant mutation', async () => {
    const upload = vi.fn();
    await expect(
      generateProductAssets(
        {
          workspaceId: 'workspace-denied',
          productVersionId: 'foreign-version',
          opportunityTitle: 'Title',
          productType: 'DIGITAL_TEMPLATE_BUNDLE',
          suggestedMarketplace: 'etsy',
        },
        {
          mode: 'mock',
          upload,
          getSignedDownloadUrl: vi.fn(),
          exists: vi.fn(),
          healthCheck: vi.fn(),
        },
      ),
    ).rejects.toBe(denied);

    expect(mocks.enforceWorkspaceCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-denied',
        capability: 'PRODUCT_GENERATION',
        stage: 'DISPATCH',
      }),
    );
    expect(mocks.dispatchWithWorkspaceCapability).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('blocks direct listing generation before any listing mutation', async () => {
    await expect(
      generateListing({
        workspaceId: 'workspace-denied',
        productId: 'product',
        productVersionId: 'version',
        opportunityTitle: 'Title',
        opportunityDescription: 'Description',
        suggestedProductType: null,
        estimatedRevenueEur: null,
      }),
    ).rejects.toBe(denied);

    expect(mocks.enforceWorkspaceCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-denied',
        capability: 'MARKETPLACE_DRAFT',
        stage: 'DISPATCH',
      }),
    );
    expect(mocks.listingUpsert).not.toHaveBeenCalled();
  });

  it('blocks direct SEO persistence before reading or mutating listing data', async () => {
    await expect(runSeoEvaluation('workspace-denied', 'listing-version')).rejects.toBe(denied);

    expect(mocks.enforceWorkspaceCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-denied',
        capability: 'MARKETPLACE_DRAFT',
        stage: 'DISPATCH',
      }),
    );
    expect(mocks.listingVersionFind).not.toHaveBeenCalled();
  });

  it('blocks direct QA persistence before any quality-check mutation', async () => {
    await expect(
      persistQualityChecks('workspace-denied', 'product-version', {
        overallPassed: true,
        checks: [],
      }),
    ).rejects.toBe(denied);

    expect(mocks.enforceWorkspaceCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-denied',
        capability: 'PRODUCT_GENERATION',
        stage: 'DISPATCH',
      }),
    );
    expect(mocks.qualityCheckCreate).not.toHaveBeenCalled();
  });
});
