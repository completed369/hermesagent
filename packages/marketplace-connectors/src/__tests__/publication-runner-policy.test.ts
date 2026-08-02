import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceWorkspaceCapability: vi.fn(),
  dispatchWithWorkspaceCapability: vi.fn(),
  listingVersionFindFirst: vi.fn(),
  approvalRequestFindFirst: vi.fn(),
  marketplaceAccountFindFirst: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  txMarketplaceAccountFindFirst: vi.fn(),
  txMarketplaceAccountCreate: vi.fn(),
  txIntegrationUpsert: vi.fn(),
  publicationAttemptCreate: vi.fn(),
  publicationAttemptUpdate: vi.fn(),
  publicationAttemptCount: vi.fn(),
  txPublicationAttemptCreate: vi.fn(),
  publicationAttemptFindFirst: vi.fn(),
  approvalDecisionFindFirst: vi.fn(),
  approvalRequestUpdate: vi.fn(),
  marketplaceAccountFindFirstOrThrow: vi.fn(),
  createDraftAdapter: vi.fn(),
  uploadImageAdapter: vi.fn(),
  uploadFileAdapter: vi.fn(),
  publishAdapter: vi.fn(),
  withIdempotency: vi.fn(),
  productPackageFindUnique: vi.fn(),
  productPackageFindFirst: vi.fn(),
  writeMarketplaceHealth: vi.fn(),
  hashProductListingBundle: vi.fn(() => 'approved-hash'),
}));

vi.mock('@ventureos/database', () => ({
  CapabilityFinalCheckBlockedError: class CapabilityFinalCheckBlockedError extends Error {
    constructor(message = 'Operation is not available') {
      super(message);
      this.name = 'CapabilityFinalCheckBlockedError';
    }
  },
  CapabilityPolicyDeniedError: class CapabilityPolicyDeniedError extends Error {},
  isCapabilityPolicyDeniedError: (error: unknown) =>
    error instanceof Error &&
    error.name === 'CapabilityPolicyDeniedError' &&
    (error as Error & { code?: string }).code === 'CAPABILITY_POLICY_DENIED',
  dispatchWithWorkspaceCapability: mocks.dispatchWithWorkspaceCapability,
  enforceWorkspaceCapability: mocks.enforceWorkspaceCapability,
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
  prisma: {
    listingVersion: { findFirst: mocks.listingVersionFindFirst },
    approvalRequest: {
      findFirst: mocks.approvalRequestFindFirst,
      update: mocks.approvalRequestUpdate,
    },
    approvalDecision: { findFirst: mocks.approvalDecisionFindFirst },
    productPackage: {
      findUnique: mocks.productPackageFindUnique,
      findFirst: mocks.productPackageFindFirst,
    },
    marketplaceAccount: {
      findFirst: mocks.marketplaceAccountFindFirst,
      findFirstOrThrow: mocks.marketplaceAccountFindFirstOrThrow,
    },
    publicationAttempt: {
      findFirst: mocks.publicationAttemptFindFirst,
      create: mocks.publicationAttemptCreate,
      update: mocks.publicationAttemptUpdate,
      count: mocks.publicationAttemptCount,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../idempotency.js', () => ({
  withIdempotency: mocks.withIdempotency,
}));

vi.mock('../health.js', () => ({ writeMarketplaceHealth: mocks.writeMarketplaceHealth }));

vi.mock('../mock-etsy-client.js', () => ({
  fetchMockCreateDraftListing: mocks.createDraftAdapter,
  fetchMockUploadListingImage: mocks.uploadImageAdapter,
  fetchMockUploadListingFile: mocks.uploadFileAdapter,
  fetchMockPublishListing: mocks.publishAdapter,
}));

vi.mock('@ventureos/security', () => ({
  hashObject: vi.fn(() => 'approved-hash'),
  hashProductListingBundle: mocks.hashProductListingBundle,
}));

import { MarketplaceBlockedError } from '../errors.js';
import { prepareListingForPublication, publishListing } from '../publication-runner.js';

const tx = {
  $queryRaw: mocks.queryRaw,
  marketplaceAccount: {
    findFirst: mocks.txMarketplaceAccountFindFirst,
    create: mocks.txMarketplaceAccountCreate,
  },
  integration: { upsert: mocks.txIntegrationUpsert },
  publicationAttempt: {
    create: mocks.txPublicationAttemptCreate,
    count: mocks.publicationAttemptCount,
  },
};

describe('marketplace publication capability and tenant boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.enforceWorkspaceCapability.mockResolvedValue(undefined);
    mocks.txMarketplaceAccountFindFirst.mockResolvedValue({
      id: 'account',
      workspaceId: 'workspace',
      marketplace: 'etsy',
      mode: 'MOCK',
      disabled: false,
      disabledReason: null,
      rateLimitPerDay: null,
    });
    mocks.publicationAttemptCount.mockResolvedValue(0);
    mocks.txPublicationAttemptCreate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'reserved-attempt',
        status: 'RESERVED',
        blockedReason: null,
        ...data,
      }),
    );
    mocks.publicationAttemptUpdate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'reserved-attempt',
        blockedReason: null,
        ...data,
      }),
    );
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.dispatchWithWorkspaceCapability.mockImplementation(
      async (
        params: { beforeDispatch?: () => Promise<void> | void },
        dispatch: () => Promise<unknown> | unknown,
      ) => {
        try {
          await params.beforeDispatch?.();
        } catch (error) {
          if (error instanceof Error && error.name === 'CapabilityFinalCheckBlockedError') {
            throw error;
          }
          throw Object.assign(new Error('Operation is not available'), {
            name: 'CapabilityPolicyDeniedError',
            code: 'CAPABILITY_POLICY_DENIED',
          });
        }
        return dispatch();
      },
    );
    mocks.withIdempotency.mockImplementation(
      async (params: {
        beforeExecute?: (claim: { idempotencyKeyId: string }) => Promise<void> | void;
        onExecutionSuccess?: (result: unknown) => void;
        execute: () => Promise<unknown>;
      }) => {
        await params.beforeExecute?.({ idempotencyKeyId: 'idempotency-key' });
        const result = await params.execute();
        params.onExecutionSuccess?.(result);
        return {
          result,
          replayed: false,
          idempotencyKeyId: 'idempotency-key',
        };
      },
    );
    mocks.createDraftAdapter.mockReturnValue({ externalListingId: 'draft-id', state: 'draft' });
    mocks.uploadImageAdapter.mockReturnValue({ externalAssetId: 'image-id' });
    mocks.uploadFileAdapter.mockReturnValue({ externalAssetId: 'file-id' });
    mocks.publishAdapter.mockReturnValue({
      externalListingId: 'draft-id',
      externalListingUrl: 'https://mock.etsy.example/listing/draft-id',
      state: 'active',
    });
    mocks.productPackageFindUnique.mockResolvedValue({
      id: 'package',
      productVersionId: 'product-version',
      listingVersionId: 'version',
      assetVersionIds: [],
      packageHash: 'approved-hash',
    });
    mocks.productPackageFindFirst.mockResolvedValue({
      id: 'package',
      productVersionId: 'product-version',
      listingVersionId: 'version',
      assetVersionIds: [],
      packageHash: 'approved-hash',
    });
  });

  it('scopes the listing lookup to the supplied workspace before any account operation', async () => {
    mocks.listingVersionFindFirst.mockResolvedValue(null);

    await expect(
      prepareListingForPublication({ workspaceId: 'workspace-a', listingVersionId: 'version-b' }),
    ).rejects.toBeInstanceOf(MarketplaceBlockedError);
    expect(mocks.listingVersionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'version-b',
          listing: { workspaceId: 'workspace-a' },
        },
      }),
    );
    expect(mocks.marketplaceAccountFindFirst).not.toHaveBeenCalled();
  });

  it('denies first-account creation inside the locked transaction before mutation', async () => {
    mocks.listingVersionFindFirst.mockResolvedValue({
      id: 'version',
      title: 'title',
      description: 'description',
      tags: [],
      priceEur: { toString: () => '10' },
      images: [],
      files: [],
      listing: { workspaceId: 'workspace', marketplace: 'etsy' },
    });
    mocks.approvalRequestFindFirst.mockResolvedValue({ id: 'approval' });
    mocks.marketplaceAccountFindFirst.mockResolvedValue(null);
    mocks.txMarketplaceAccountFindFirst.mockResolvedValue(null);
    mocks.enforceWorkspaceCapability
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Operation is not available'));

    await expect(
      prepareListingForPublication({ workspaceId: 'workspace', listingVersionId: 'version' }),
    ).rejects.toThrow('Operation is not available');
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.enforceWorkspaceCapability).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace',
        capability: 'MARKETPLACE_CONNECTION',
        providerMode: 'mock',
      }),
      tx,
    );
    expect(mocks.txIntegrationUpsert).not.toHaveBeenCalled();
    expect(mocks.txMarketplaceAccountCreate).not.toHaveBeenCalled();
  });

  it('propagates a structurally identical cross-build policy denial without failure writes', async () => {
    const crossBuildDenial = Object.assign(new Error('Operation is not available'), {
      name: 'CapabilityPolicyDeniedError',
      code: 'CAPABILITY_POLICY_DENIED',
    });
    mocks.listingVersionFindFirst.mockResolvedValue({
      id: 'version',
      title: 'title',
      description: 'description',
      tags: [],
      priceEur: { toString: () => '10' },
      images: [],
      files: [],
      listing: { workspaceId: 'workspace', marketplace: 'etsy' },
    });
    mocks.approvalRequestFindFirst.mockResolvedValue({ id: 'approval' });
    mocks.marketplaceAccountFindFirst.mockResolvedValue({
      id: 'account',
      mode: 'MOCK',
      disabled: false,
      disabledReason: null,
      rateLimitPerDay: null,
    });
    mocks.dispatchWithWorkspaceCapability.mockRejectedValue(crossBuildDenial);
    mocks.publicationAttemptCreate.mockResolvedValue({
      id: 'failed-attempt',
      status: 'FAILED',
      blockedReason: null,
    });

    await expect(
      prepareListingForPublication({ workspaceId: 'workspace', listingVersionId: 'version' }),
    ).rejects.toBe(crossBuildDenial);
    expect(mocks.publicationAttemptCreate).not.toHaveBeenCalled();
  });

  it.each([
    [
      'listing removed',
      null,
      {
        id: 'account',
        mode: 'MOCK',
        disabled: false,
        disabledReason: null,
        rateLimitPerDay: null,
      },
    ],
    [
      'account disabled',
      {
        id: 'version',
        title: 'title',
        description: 'description',
        tags: [],
        priceEur: { toString: () => '10' },
        images: [],
        files: [],
        listing: { workspaceId: 'workspace', marketplace: 'etsy' },
      },
      {
        id: 'account',
        mode: 'MOCK',
        disabled: true,
        disabledReason: 'revoked',
        rateLimitPerDay: null,
      },
    ],
  ])(
    'revalidates final local state without misclassifying %s as a policy denial',
    async (_label, finalListing, finalAccount) => {
      const initialListing = {
        id: 'version',
        title: 'title',
        description: 'description',
        tags: [],
        priceEur: { toString: () => '10' },
        images: [],
        files: [],
        listing: { workspaceId: 'workspace', marketplace: 'etsy' },
      };
      const initialAccount = {
        id: 'account',
        mode: 'MOCK',
        disabled: false,
        disabledReason: null,
        rateLimitPerDay: null,
      };
      mocks.listingVersionFindFirst
        .mockResolvedValueOnce(initialListing)
        .mockResolvedValueOnce(finalListing);
      mocks.approvalRequestFindFirst.mockResolvedValue({ id: 'approval' });
      mocks.marketplaceAccountFindFirst
        .mockResolvedValueOnce(initialAccount)
        .mockResolvedValueOnce(finalAccount);

      await expect(
        prepareListingForPublication({ workspaceId: 'workspace', listingVersionId: 'version' }),
      ).resolves.toMatchObject({ status: 'FAILED' });

      expect(mocks.createDraftAdapter).not.toHaveBeenCalled();
      expect(mocks.publicationAttemptCreate).not.toHaveBeenCalled();
    },
  );

  it('attaches final local-state revalidation to draft, image, and file adapter dispatches', async () => {
    const listing = {
      id: 'version',
      listingId: 'listing',
      title: 'title',
      description: 'description',
      tags: [],
      category: 'category',
      currency: 'EUR',
      priceEur: { toString: () => '10' },
      images: [
        {
          id: 'image',
          productAssetVersionId: 'asset-image',
          position: 0,
          altText: 'Preview',
        },
      ],
      files: [
        {
          id: 'file',
          productAssetVersionId: 'asset-file',
          displayName: 'download.zip',
        },
      ],
      listing: {
        workspaceId: 'workspace',
        marketplace: 'etsy',
        productVersionId: 'product-version',
      },
    };
    const account = {
      id: 'account',
      mode: 'MOCK',
      disabled: false,
      disabledReason: null,
      rateLimitPerDay: null,
    };
    mocks.listingVersionFindFirst.mockResolvedValue(listing);
    mocks.approvalRequestFindFirst.mockResolvedValue({
      id: 'approval',
      productPackageId: 'package',
    });
    mocks.approvalDecisionFindFirst.mockResolvedValue({
      approvalRequestId: 'approval',
      decision: 'APPROVE',
      approvedArtifactVersionId: 'package',
      approvedPackageHash: 'approved-hash',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    mocks.marketplaceAccountFindFirst.mockResolvedValue(account);
    mocks.publicationAttemptCreate.mockResolvedValue({
      id: 'attempt',
      status: 'READY_FOR_PUBLISH',
      blockedReason: null,
    });

    await prepareListingForPublication({ workspaceId: 'workspace', listingVersionId: 'version' });

    expect(mocks.dispatchWithWorkspaceCapability).toHaveBeenCalledTimes(3);
    for (const [params] of mocks.dispatchWithWorkspaceCapability.mock.calls) {
      expect(params.beforeDispatch).toEqual(expect.any(Function));
    }
    expect(mocks.createDraftAdapter).toHaveBeenCalledOnce();
    expect(mocks.uploadImageAdapter).toHaveBeenCalledOnce();
    expect(mocks.uploadFileAdapter).toHaveBeenCalledOnce();

    const finalCheck = mocks.dispatchWithWorkspaceCapability.mock.calls[0]?.[0].beforeDispatch;
    mocks.listingVersionFindFirst.mockResolvedValue({
      ...listing,
      listing: { ...listing.listing, productVersionId: 'different-product-version' },
    });
    await expect(finalCheck()).rejects.toThrow('Marketplace draft approval is no longer valid');
  });

  it('rejects same-version listing-content drift under an older PRODUCT_LISTING approval', async () => {
    const oldListing = {
      id: 'version',
      listingId: 'listing',
      title: 'old title',
      description: 'old description',
      tags: ['old'],
      category: 'category',
      currency: 'EUR',
      priceEur: { toString: () => '10' },
      images: [
        {
          id: 'image',
          productAssetVersionId: 'asset-image',
          position: 0,
          altText: 'Preview',
        },
      ],
      files: [
        {
          id: 'file',
          productAssetVersionId: 'asset-file',
          displayName: 'download.zip',
        },
      ],
      listing: { marketplace: 'etsy', productVersionId: 'product-version' },
    };
    const currentListing = {
      ...oldListing,
      title: 'current title',
      description: 'current description',
      tags: ['current'],
      priceEur: { toString: () => '12' },
    };
    mocks.listingVersionFindFirst
      .mockResolvedValueOnce(oldListing)
      .mockResolvedValueOnce(currentListing)
      .mockResolvedValueOnce(currentListing);
    mocks.approvalRequestFindFirst.mockResolvedValue({
      id: 'approval',
      productPackageId: 'package',
    });
    mocks.approvalDecisionFindFirst.mockResolvedValue({
      approvalRequestId: 'approval',
      decision: 'APPROVE',
      approvedArtifactVersionId: 'package',
      approvedPackageHash: 'approved-hash',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    mocks.marketplaceAccountFindFirst.mockResolvedValue({
      id: 'account',
      workspaceId: 'workspace',
      marketplace: 'etsy',
      mode: 'MOCK',
      disabled: false,
      disabledReason: null,
      rateLimitPerDay: null,
    });
    mocks.hashProductListingBundle.mockReturnValueOnce('drifted-hash');

    await expect(
      prepareListingForPublication({ workspaceId: 'workspace', listingVersionId: 'version' }),
    ).resolves.toMatchObject({ status: 'FAILED' });

    expect(mocks.createDraftAdapter).not.toHaveBeenCalled();
    expect(mocks.hashProductListingBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            id: 'image',
            productAssetVersionId: 'asset-image',
            position: 0,
            altText: 'Preview',
          },
        ],
        files: [
          {
            id: 'file',
            productAssetVersionId: 'asset-file',
            displayName: 'download.zip',
          },
        ],
      }),
    );
  });

  it('atomically reserves and blocks a concurrent daily-rate slot before adapter dispatch', async () => {
    const listing = {
      id: 'version',
      listingId: 'listing',
      title: 'title',
      description: 'description',
      tags: [],
      category: 'category',
      currency: 'EUR',
      priceEur: { toString: () => '10' },
      images: [],
      files: [],
      listing: { marketplace: 'etsy', productVersionId: 'product-version' },
    };
    const limitedAccount = {
      id: 'account',
      workspaceId: 'workspace',
      marketplace: 'etsy',
      mode: 'MOCK',
      disabled: false,
      disabledReason: null,
      rateLimitPerDay: 1,
    };
    mocks.listingVersionFindFirst.mockResolvedValue(listing);
    mocks.approvalRequestFindFirst.mockResolvedValue({ id: 'approval' });
    mocks.marketplaceAccountFindFirst.mockResolvedValue(limitedAccount);
    mocks.txMarketplaceAccountFindFirst.mockResolvedValue(limitedAccount);
    mocks.publicationAttemptCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    mocks.txPublicationAttemptCreate.mockImplementationOnce(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 'blocked', ...data }),
    );

    const result = await prepareListingForPublication({
      workspaceId: 'workspace',
      listingVersionId: 'version',
    });

    expect(result).toMatchObject({ status: 'BLOCKED_RATE_LIMIT' });
    expect(mocks.createDraftAdapter).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalled();
  });

  function arrangePublish() {
    const preparedAttempt = {
      id: 'prepared-attempt',
      listingVersionId: 'version',
      marketplace: 'etsy',
      marketplaceAccountId: 'account',
      externalListingId: 'draft-id',
      status: 'READY_FOR_PUBLISH',
    };
    const approval = {
      id: 'publication-approval',
      workspaceId: 'workspace',
      listingVersionId: 'version',
      kind: 'PUBLICATION',
      state: 'APPROVED',
      affectedResources: ['PublicationAttempt:prepared-attempt'],
    };
    const decision = {
      approvalRequestId: approval.id,
      decision: 'APPROVE',
      approvedArtifactVersionId: 'version',
      approvedPackageHash: 'approved-hash',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    };
    const listingVersion = {
      id: 'version',
      listingId: 'listing',
      title: 'title',
      description: 'description',
      tags: [],
      category: 'category',
      currency: 'EUR',
      priceEur: { toString: () => '10' },
    };
    const account = {
      id: 'account',
      workspaceId: 'workspace',
      marketplace: 'etsy',
      mode: 'MOCK',
      disabled: false,
      disabledReason: null,
      rateLimitPerDay: null,
    };

    mocks.publicationAttemptFindFirst.mockResolvedValue(preparedAttempt);
    mocks.approvalRequestFindFirst.mockResolvedValue(approval);
    mocks.approvalDecisionFindFirst.mockResolvedValue(decision);
    mocks.listingVersionFindFirst.mockResolvedValue(listingVersion);
    mocks.marketplaceAccountFindFirstOrThrow.mockResolvedValue(account);
    mocks.marketplaceAccountFindFirst.mockResolvedValue(account);
    mocks.publicationAttemptCreate.mockResolvedValue({
      id: 'published-attempt',
      status: 'PUBLISHED',
      blockedReason: null,
    });
    mocks.approvalRequestUpdate.mockResolvedValue(approval);
    return { preparedAttempt };
  }

  it('attaches exact approval, prepared-attempt, account, and listing revalidation to publish dispatch', async () => {
    arrangePublish();

    await publishListing({
      workspaceId: 'workspace',
      listingVersionId: 'version',
      approvalRequestId: 'publication-approval',
    });

    expect(mocks.dispatchWithWorkspaceCapability).toHaveBeenCalledOnce();
    expect(mocks.dispatchWithWorkspaceCapability.mock.calls[0]?.[0].beforeDispatch).toEqual(
      expect.any(Function),
    );
    expect(mocks.publishAdapter).toHaveBeenCalledOnce();
    expect(mocks.txPublicationAttemptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ idempotencyKeyId: 'idempotency-key' }),
    });
    expect(mocks.publicationAttemptUpdate).toHaveBeenCalledWith({
      where: {
        id: 'reserved-attempt',
        status: 'RESERVED',
        idempotencyKeyId: 'idempotency-key',
      },
      data: {
        status: 'PUBLISHED',
        blockedReason: null,
        externalListingId: 'draft-id',
        externalListingUrl: 'https://mock.etsy.example/listing/draft-id',
        idempotencyKeyId: 'idempotency-key',
        completedAt: expect.any(Date),
      },
    });
  });

  it('does not persist provider error details in publication state or health', async () => {
    arrangePublish();
    mocks.publishAdapter.mockRejectedValueOnce(
      new Error('provider token=secret-token upstream stack detail'),
    );

    await expect(
      publishListing({
        workspaceId: 'workspace',
        listingVersionId: 'version',
        approvalRequestId: 'publication-approval',
      }),
    ).resolves.toMatchObject({ status: 'FAILED' });

    const safeMessage = 'Marketplace publication operation failed';
    expect(mocks.publicationAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ errorMessage: safeMessage }) }),
    );
    expect(mocks.approvalRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ executionResult: { error: safeMessage } }),
      }),
    );
    expect(mocks.writeMarketplaceHealth).toHaveBeenCalledWith(
      'workspace',
      'etsy',
      'MOCK',
      expect.objectContaining({ healthy: false, message: safeMessage }),
    );
  });

  it('preserves publication truth when the ancillary health write fails after provider success', async () => {
    arrangePublish();
    mocks.writeMarketplaceHealth.mockRejectedValueOnce(new Error('health persistence unavailable'));

    const result = await publishListing({
      workspaceId: 'workspace',
      listingVersionId: 'version',
      approvalRequestId: 'publication-approval',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(mocks.publicationAttemptUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executionSuccess: false }) }),
    );
  });

  it('never marks provider success failed when response-cache persistence fails', async () => {
    arrangePublish();
    mocks.withIdempotency.mockImplementationOnce(
      async (params: {
        beforeExecute?: (claim: { idempotencyKeyId: string }) => Promise<void> | void;
        onExecutionSuccess?: (result: unknown) => void;
        execute: () => Promise<unknown>;
      }) => {
        await params.beforeExecute?.({ idempotencyKeyId: 'idempotency-key' });
        const result = await params.execute();
        params.onExecutionSuccess?.(result);
        throw new Error('response cache unavailable');
      },
    );

    await expect(
      publishListing({
        workspaceId: 'workspace',
        listingVersionId: 'version',
        approvalRequestId: 'publication-approval',
      }),
    ).rejects.toThrow('response cache unavailable');

    expect(mocks.publicationAttemptUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executionSuccess: false }) }),
    );
  });

  it('preserves publication truth when approval execution metadata cannot be persisted', async () => {
    arrangePublish();
    mocks.approvalRequestUpdate.mockRejectedValueOnce(
      new Error('approval metadata persistence unavailable'),
    );

    const result = await publishListing({
      workspaceId: 'workspace',
      listingVersionId: 'version',
      approvalRequestId: 'publication-approval',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(mocks.publicationAttemptUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executionSuccess: false }) }),
    );
  });

  it('never relabels provider success as failed when the local success write fails', async () => {
    arrangePublish();
    mocks.publicationAttemptUpdate.mockRejectedValueOnce(
      new Error('publication success persistence unavailable'),
    );

    await expect(
      publishListing({
        workspaceId: 'workspace',
        listingVersionId: 'version',
        approvalRequestId: 'publication-approval',
      }),
    ).rejects.toThrow('publication success persistence unavailable');

    expect(mocks.publicationAttemptUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.publicationAttemptUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executionSuccess: false }) }),
    );
  });

  it('reconciles a reserved attempt from cached provider success before replaying it', async () => {
    const { preparedAttempt } = arrangePublish();
    mocks.publicationAttemptFindFirst
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'reserved-attempt',
        status: 'RESERVED',
        blockedReason: null,
      });
    mocks.withIdempotency.mockImplementationOnce(
      async (params: { beforeReplay?: () => Promise<void> | void }) => {
        await params.beforeReplay?.();
        return {
          result: {
            externalListingId: 'draft-id',
            externalListingUrl: 'https://mock.etsy.example/listing/draft-id',
            state: 'active',
          },
          replayed: true,
          idempotencyKeyId: 'idempotency-key',
        };
      },
    );

    const result = await publishListing({
      workspaceId: 'workspace',
      listingVersionId: 'version',
      approvalRequestId: 'publication-approval',
    });

    expect(result).toMatchObject({ status: 'PUBLISHED', replayed: true });
    expect(mocks.publicationAttemptFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        idempotencyKeyId: 'idempotency-key',
        status: 'RESERVED',
      }),
    });
    expect(mocks.publicationAttemptUpdate).toHaveBeenCalledWith({
      where: {
        id: 'reserved-attempt',
        status: 'RESERVED',
        idempotencyKeyId: 'idempotency-key',
      },
      data: {
        status: 'PUBLISHED',
        blockedReason: null,
        externalListingId: 'draft-id',
        externalListingUrl: 'https://mock.etsy.example/listing/draft-id',
        idempotencyKeyId: 'idempotency-key',
        completedAt: expect.any(Date),
      },
    });
  });

  it('denies publication when the prepared attempt disappears before final dispatch', async () => {
    const { preparedAttempt } = arrangePublish();
    mocks.publicationAttemptFindFirst
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(null);

    await expect(
      publishListing({
        workspaceId: 'workspace',
        listingVersionId: 'version',
        approvalRequestId: 'publication-approval',
      }),
    ).resolves.toMatchObject({ status: 'FAILED' });

    expect(mocks.publishAdapter).not.toHaveBeenCalled();
    expect(mocks.publicationAttemptCreate).not.toHaveBeenCalled();
    expect(mocks.approvalRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executionSuccess: false }) }),
    );
  });

  it('revalidates policy and local state before accepting a cached publication replay', async () => {
    arrangePublish();
    mocks.withIdempotency.mockImplementationOnce(
      async (params: { beforeReplay?: () => Promise<void> | void }) => {
        await params.beforeReplay?.();
        return {
          result: {
            externalListingId: 'draft-id',
            externalListingUrl: 'https://mock.etsy.example/listing/draft-id',
            state: 'active',
          },
          replayed: true,
        };
      },
    );
    mocks.dispatchWithWorkspaceCapability.mockRejectedValueOnce(
      Object.assign(new Error('Operation is not available'), {
        name: 'CapabilityPolicyDeniedError',
        code: 'CAPABILITY_POLICY_DENIED',
      }),
    );

    await expect(
      publishListing({
        workspaceId: 'workspace',
        listingVersionId: 'version',
        approvalRequestId: 'publication-approval',
      }),
    ).rejects.toMatchObject({ name: 'CapabilityPolicyDeniedError' });

    expect(mocks.publishAdapter).not.toHaveBeenCalled();
    expect(mocks.publicationAttemptCreate).not.toHaveBeenCalled();
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalled();
  });

  it('returns the original success for a cached publication without consuming approval again', async () => {
    const { preparedAttempt } = arrangePublish();
    const originalAttempt = {
      id: 'original-published-attempt',
      status: 'PUBLISHED',
      blockedReason: null,
      idempotencyKeyId: 'idempotency-key',
      externalListingId: 'original-external-id',
      externalListingUrl: 'https://mock.etsy.example/listing/original-external-id',
    };
    mocks.publicationAttemptFindFirst
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(originalAttempt);
    mocks.withIdempotency.mockImplementationOnce(
      async (params: { beforeReplay?: () => Promise<void> | void }) => {
        await params.beforeReplay?.();
        return {
          result: {
            externalListingId: 'draft-id',
            externalListingUrl: 'https://mock.etsy.example/listing/draft-id',
            state: 'active',
          },
          replayed: true,
          idempotencyKeyId: 'idempotency-key',
        };
      },
    );

    const result = await publishListing({
      workspaceId: 'workspace',
      listingVersionId: 'version',
      approvalRequestId: 'publication-approval',
    });

    expect(result).toEqual({
      publicationAttemptId: originalAttempt.id,
      status: 'PUBLISHED',
      blockedReason: null,
      externalListingId: 'original-external-id',
      externalListingUrl: 'https://mock.etsy.example/listing/original-external-id',
      replayed: true,
    });
    expect(mocks.publishAdapter).not.toHaveBeenCalled();
    expect(mocks.publicationAttemptFindFirst).toHaveBeenLastCalledWith({
      where: {
        idempotencyKeyId: 'idempotency-key',
        status: 'PUBLISHED',
        listingVersionId: 'version',
        marketplaceAccountId: 'account',
        marketplace: 'etsy',
        listingVersion: { listing: { workspaceId: 'workspace' } },
        marketplaceAccount: { workspaceId: 'workspace' },
      },
      orderBy: { completedAt: 'asc' },
    });
    expect(mocks.publicationAttemptCreate).toHaveBeenCalledWith({
      data: {
        listingVersionId: 'version',
        marketplace: 'etsy',
        marketplaceAccountId: 'account',
        status: 'IDEMPOTENT_REPLAY',
        blockedReason: null,
        externalListingId: 'original-external-id',
        externalListingUrl: 'https://mock.etsy.example/listing/original-external-id',
        idempotencyKeyId: 'idempotency-key',
        completedAt: expect.any(Date),
      },
    });
    expect(mocks.publicationAttemptUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED' }) }),
    );
    expect(mocks.publicationAttemptUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: originalAttempt.id } }),
    );
    expect(mocks.txPublicationAttemptCreate).not.toHaveBeenCalled();
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign-workspace success'],
    ['wrong listing version'],
    ['wrong marketplace account'],
    ['failed original attempt'],
    ['missing original success'],
  ])('fails generically when schema-supported filters exclude a %s', async () => {
    const { preparedAttempt } = arrangePublish();
    mocks.publicationAttemptFindFirst
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.withIdempotency.mockImplementationOnce(
      async (params: { beforeReplay?: () => Promise<void> | void }) => {
        await params.beforeReplay?.();
        return {
          result: {
            externalListingId: 'cached-id',
            externalListingUrl: 'https://mock.etsy.example/listing/cached-id',
            state: 'active',
          },
          replayed: true,
          idempotencyKeyId: 'idempotency-key',
        };
      },
    );

    await expect(
      publishListing({
        workspaceId: 'workspace',
        listingVersionId: 'version',
        approvalRequestId: 'publication-approval',
      }),
    ).rejects.toThrow('Marketplace publication replay is unavailable');

    expect(mocks.publicationAttemptFindFirst).toHaveBeenCalledWith({
      where: {
        idempotencyKeyId: 'idempotency-key',
        status: 'PUBLISHED',
        listingVersionId: 'version',
        marketplaceAccountId: 'account',
        marketplace: 'etsy',
        listingVersion: { listing: { workspaceId: 'workspace' } },
        marketplaceAccount: { workspaceId: 'workspace' },
      },
      orderBy: { completedAt: 'asc' },
    });
    expect(mocks.publishAdapter).not.toHaveBeenCalled();
    expect(mocks.publicationAttemptUpdate).not.toHaveBeenCalled();
    expect(mocks.publicationAttemptCreate).not.toHaveBeenCalled();
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalled();
  });

  it('does not reserve or consume rate capacity for an idempotent replay', async () => {
    const { preparedAttempt } = arrangePublish();
    const limitedAccount = {
      id: 'account',
      workspaceId: 'workspace',
      marketplace: 'etsy',
      mode: 'MOCK',
      disabled: false,
      disabledReason: null,
      rateLimitPerDay: 2,
    };
    mocks.marketplaceAccountFindFirstOrThrow.mockResolvedValue(limitedAccount);
    mocks.txMarketplaceAccountFindFirst.mockResolvedValue(limitedAccount);
    mocks.publicationAttemptFindFirst
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce({
        id: 'original-published-attempt',
        status: 'PUBLISHED',
        blockedReason: null,
        externalListingId: 'draft-id',
        externalListingUrl: 'https://mock.etsy.example/listing/draft-id',
      });
    mocks.withIdempotency.mockImplementationOnce(
      async (params: { beforeReplay?: () => Promise<void> | void }) => {
        await params.beforeReplay?.();
        return {
          result: {
            externalListingId: 'draft-id',
            externalListingUrl: 'https://mock.etsy.example/listing/draft-id',
            state: 'active',
          },
          replayed: true,
          idempotencyKeyId: 'idempotency-key',
        };
      },
    );

    await publishListing({
      workspaceId: 'workspace',
      listingVersionId: 'version',
      approvalRequestId: 'publication-approval',
    });

    expect(mocks.publicationAttemptCount).not.toHaveBeenCalled();
    expect(mocks.txPublicationAttemptCreate).not.toHaveBeenCalled();
    expect(mocks.publishAdapter).not.toHaveBeenCalled();
  });

  it('blocks cached replay when the current approval is invalidated', async () => {
    const { preparedAttempt } = arrangePublish();
    mocks.approvalRequestFindFirst
      .mockResolvedValueOnce({
        id: 'publication-approval',
        workspaceId: 'workspace',
        listingVersionId: 'version',
        kind: 'PUBLICATION',
        state: 'APPROVED',
        affectedResources: ['PublicationAttempt:prepared-attempt'],
      })
      .mockResolvedValueOnce(null);
    mocks.publicationAttemptFindFirst
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(preparedAttempt);
    mocks.withIdempotency.mockImplementationOnce(
      async (params: { beforeReplay?: () => Promise<void> | void }) => {
        await params.beforeReplay?.();
        throw new Error('unreachable');
      },
    );

    await expect(
      publishListing({
        workspaceId: 'workspace',
        listingVersionId: 'version',
        approvalRequestId: 'publication-approval',
      }),
    ).rejects.toMatchObject({ name: 'CapabilityFinalCheckBlockedError' });

    expect(mocks.publishAdapter).not.toHaveBeenCalled();
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalled();
  });

  it('blocks cached replay when the current marketplace account is disabled', async () => {
    const { preparedAttempt } = arrangePublish();
    mocks.marketplaceAccountFindFirst.mockResolvedValue({
      id: 'account',
      workspaceId: 'workspace',
      marketplace: 'etsy',
      mode: 'MOCK',
      disabled: true,
      disabledReason: 'disabled',
      rateLimitPerDay: null,
    });
    mocks.publicationAttemptFindFirst
      .mockResolvedValueOnce(preparedAttempt)
      .mockResolvedValueOnce(preparedAttempt);
    mocks.withIdempotency.mockImplementationOnce(
      async (params: { beforeReplay?: () => Promise<void> | void }) => {
        await params.beforeReplay?.();
        throw new Error('unreachable');
      },
    );

    await expect(
      publishListing({
        workspaceId: 'workspace',
        listingVersionId: 'version',
        approvalRequestId: 'publication-approval',
      }),
    ).rejects.toMatchObject({ name: 'CapabilityFinalCheckBlockedError' });

    expect(mocks.publishAdapter).not.toHaveBeenCalled();
    expect(mocks.approvalRequestUpdate).not.toHaveBeenCalled();
  });
});
