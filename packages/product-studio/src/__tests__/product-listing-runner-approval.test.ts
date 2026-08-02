import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceWorkspaceCapability: vi.fn(),
  dispatchWithWorkspaceCapability: vi.fn(),
  proposalFindFirst: vi.fn(),
  approvalRequestFindFirst: vi.fn(),
  approvalDecisionFindFirst: vi.fn(),
  productUpsert: vi.fn(),
  productVersionCount: vi.fn(),
  productVersionCreate: vi.fn(),
  productBriefCreate: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  enforceWorkspaceCapability: mocks.enforceWorkspaceCapability,
  dispatchWithWorkspaceCapability: mocks.dispatchWithWorkspaceCapability,
  prisma: {
    ventureProposal: { findFirst: mocks.proposalFindFirst },
    approvalRequest: { findFirst: mocks.approvalRequestFindFirst },
    approvalDecision: { findFirst: mocks.approvalDecisionFindFirst },
    product: { upsert: mocks.productUpsert },
    productVersion: {
      count: mocks.productVersionCount,
      create: mocks.productVersionCreate,
    },
    productBrief: { create: mocks.productBriefCreate },
  },
}));

vi.mock('../mock-product-generator', () => ({
  generateProductAssets: vi.fn(),
  targetAssetKinds: vi.fn(() => []),
}));
vi.mock('../qa-checker', () => ({ runQualityChecks: vi.fn(), persistQualityChecks: vi.fn() }));
vi.mock('../listing-generator', () => ({ generateListing: vi.fn() }));
vi.mock('../seo-evaluator', () => ({ runSeoEvaluation: vi.fn() }));

import { generateProduct, ProductGenerationBlockedError } from '../product-listing-runner';
import { hashObject } from '@ventureos/security';

const proposal = {
  id: '10000000-0000-4000-8000-000000000001',
  opportunity: {
    title: 'Approved product',
    suggestedProductType: null,
    suggestedMarketplace: null,
  },
  versions: [
    {
      id: '20000000-0000-4000-8000-000000000002',
      versionNumber: 2,
      snapshot: { title: 'Current proposal' },
    },
  ],
};

const approvalRequest = {
  id: '30000000-0000-4000-8000-000000000003',
  ventureProposalId: proposal.id,
  state: 'APPROVED',
};

describe('product generation approval binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceWorkspaceCapability.mockResolvedValue(undefined);
    mocks.proposalFindFirst.mockResolvedValue(proposal);
    mocks.approvalRequestFindFirst.mockResolvedValue(approvalRequest);
  });

  it('rejects an expired approval before creating product state', async () => {
    mocks.approvalDecisionFindFirst.mockResolvedValue({
      approvedArtifactVersionId: proposal.versions[0]!.id,
      approvedPackageHash: hashObject(proposal.versions[0]!.snapshot),
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      generateProduct({
        workspaceId: '40000000-0000-4000-8000-000000000004',
        ventureProposalId: proposal.id,
        storageProvider: {
          mode: 'mock',
          upload: vi.fn(),
          getSignedDownloadUrl: vi.fn(),
          exists: vi.fn(),
          healthCheck: vi.fn(),
        },
      }),
    ).rejects.toBeInstanceOf(ProductGenerationBlockedError);

    expect(mocks.productUpsert).not.toHaveBeenCalled();
    expect(mocks.dispatchWithWorkspaceCapability).not.toHaveBeenCalled();
  });

  it('revalidates approval binding at the final provider boundary', async () => {
    const driftedProposal = {
      ...proposal,
      versions: [{ ...proposal.versions[0]!, snapshot: { title: 'Drifted proposal' } }],
    };
    mocks.proposalFindFirst.mockResolvedValueOnce(proposal).mockResolvedValueOnce(driftedProposal);
    mocks.approvalDecisionFindFirst.mockResolvedValue({
      approvedArtifactVersionId: proposal.versions[0]!.id,
      approvedPackageHash: hashObject(proposal.versions[0]!.snapshot),
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.productUpsert.mockResolvedValue({ id: 'product' });
    mocks.productVersionCount.mockResolvedValue(0);
    mocks.productVersionCreate.mockResolvedValue({ id: 'product-version' });
    mocks.productBriefCreate.mockResolvedValue({ id: 'brief' });
    mocks.dispatchWithWorkspaceCapability.mockImplementation(async (params) => {
      await params.beforeFinalCheck();
      throw new Error('provider callback must not be reached');
    });

    await expect(
      generateProduct({
        workspaceId: '40000000-0000-4000-8000-000000000004',
        ventureProposalId: proposal.id,
        storageProvider: {
          mode: 'mock',
          upload: vi.fn(),
          getSignedDownloadUrl: vi.fn(),
          exists: vi.fn(),
          healthCheck: vi.fn(),
        },
      }),
    ).rejects.toBeInstanceOf(ProductGenerationBlockedError);
  });
});
