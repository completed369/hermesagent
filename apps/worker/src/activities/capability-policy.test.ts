import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  CapabilityPolicyDeniedError: class CapabilityPolicyDeniedError extends Error {},
  enforceWorkspaceCapability: vi.fn(),
  runBoardReview: vi.fn(),
  createApprovalRequest: vi.fn(),
  generateProduct: vi.fn(),
  generateListingAndApprovalRequest: vi.fn(),
  prepareListingForPublication: vi.fn(),
  requestPublicationApproval: vi.fn(),
  publishListing: vi.fn(),
  writeAuditEvent: vi.fn(),
  loadEnv: vi.fn(),
  MockStorageProvider: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  CapabilityPolicyDeniedError: mocks.CapabilityPolicyDeniedError,
  enforceWorkspaceCapability: mocks.enforceWorkspaceCapability,
  isCapabilityPolicyDeniedError: (error: unknown) =>
    error instanceof mocks.CapabilityPolicyDeniedError ||
    (error instanceof Error && error.name === 'CapabilityPolicyDeniedError'),
}));
vi.mock('@ventureos/agent-runtime', () => ({
  runBoardReview: mocks.runBoardReview,
  createApprovalRequest: mocks.createApprovalRequest,
  getApprovalRequestState: vi.fn(),
}));
vi.mock('@ventureos/product-studio', () => ({
  generateProduct: mocks.generateProduct,
  generateListingAndApprovalRequest: mocks.generateListingAndApprovalRequest,
}));
vi.mock('@ventureos/marketplace-connectors', () => ({
  prepareListingForPublication: mocks.prepareListingForPublication,
  requestPublicationApproval: mocks.requestPublicationApproval,
  publishListing: mocks.publishListing,
}));
vi.mock('@ventureos/config', () => ({ loadEnv: mocks.loadEnv }));
vi.mock('@ventureos/integrations', () => ({
  MinioStorageProvider: vi.fn(),
  MockStorageProvider: mocks.MockStorageProvider,
}));
vi.mock('../lib/write-audit-event', () => ({ writeAuditEvent: mocks.writeAuditEvent }));

import { createApprovalRequestActivity, runBoardReviewActivity } from './board-approval-activities';
import { generateProductActivity } from './product-listing-activities';
import { publishListingActivity } from './marketplace-activities';

describe('worker activity capability enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceWorkspaceCapability.mockRejectedValue(
      new mocks.CapabilityPolicyDeniedError('Operation is not available'),
    );
  });

  it('blocks a direct board activity before the model runner', async () => {
    await expect(
      runBoardReviewActivity({
        workspaceId: 'workspace-denied',
        ventureProposalId: 'proposal',
        actorId: 'actor',
        workflowId: 'workflow',
      }),
    ).rejects.toMatchObject({
      message: 'Operation is not available',
      type: 'CAPABILITY_POLICY_DENIED',
      nonRetryable: true,
    });
    expect(mocks.runBoardReview).not.toHaveBeenCalled();
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });

  it('blocks the separately queued approval-request activity before its writer', async () => {
    await expect(
      createApprovalRequestActivity({
        workspaceId: 'workspace-denied',
        ventureProposalId: 'proposal',
        boardReviewId: 'review',
        requestedBy: 'actor',
        workflowId: 'workflow',
      }),
    ).rejects.toMatchObject({
      type: 'CAPABILITY_POLICY_DENIED',
      nonRetryable: true,
    });
    expect(mocks.createApprovalRequest).not.toHaveBeenCalled();
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });

  it('blocks a direct product activity before storage or product generation', async () => {
    await expect(
      generateProductActivity({
        workspaceId: 'workspace-denied',
        ventureProposalId: 'proposal',
        actorId: 'actor',
        workflowId: 'workflow',
      }),
    ).rejects.toMatchObject({
      message: 'Operation is not available',
      type: 'CAPABILITY_POLICY_DENIED',
      nonRetryable: true,
    });
    expect(mocks.generateProduct).not.toHaveBeenCalled();
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });

  it('blocks a direct publication activity before the marketplace adapter', async () => {
    await expect(
      publishListingActivity({
        workspaceId: 'workspace-denied',
        listingVersionId: 'listing-version',
        approvalRequestId: 'approval',
        actorId: 'actor',
        workflowId: 'workflow',
      }),
    ).rejects.toMatchObject({
      message: 'Operation is not available',
      type: 'CAPABILITY_POLICY_DENIED',
      nonRetryable: true,
    });
    expect(mocks.publishListing).not.toHaveBeenCalled();
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });

  it('also makes a nested final-boundary policy denial non-retryable', async () => {
    mocks.enforceWorkspaceCapability.mockResolvedValue(undefined);
    mocks.runBoardReview.mockRejectedValue(
      new mocks.CapabilityPolicyDeniedError('Operation is not available'),
    );

    await expect(
      runBoardReviewActivity({
        workspaceId: 'workspace-revoked-after-precheck',
        ventureProposalId: 'proposal',
        actorId: 'actor',
        workflowId: 'workflow',
      }),
    ).rejects.toMatchObject({
      type: 'CAPABILITY_POLICY_DENIED',
      nonRetryable: true,
    });
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled();
  });

  it('audits a cached publication as a replay rather than another provider publication', async () => {
    mocks.enforceWorkspaceCapability.mockResolvedValue(undefined);
    mocks.publishListing.mockResolvedValue({
      publicationAttemptId: 'original-attempt',
      status: 'PUBLISHED',
      blockedReason: null,
      externalListingId: 'external-id',
      externalListingUrl: 'https://mock.example/external-id',
      replayed: true,
    });

    await publishListingActivity({
      workspaceId: 'workspace',
      listingVersionId: 'listing-version',
      approvalRequestId: 'approval',
      actorId: 'actor',
      workflowId: 'workflow',
    });

    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      'workspace',
      expect.objectContaining({ action: 'PUBLICATION_REPLAYED' }),
    );
  });

  it('constructs the storage provider without caller-injected authorization', async () => {
    mocks.enforceWorkspaceCapability.mockResolvedValue(undefined);
    mocks.loadEnv.mockReturnValue({ STORAGE_PROVIDER: 'mock' });
    mocks.MockStorageProvider.mockImplementation(() => ({ upload: vi.fn() }));
    mocks.generateProduct.mockImplementation(async ({ storageProvider }) => {
      await storageProvider.upload();
      return { productId: 'product' };
    });

    await generateProductActivity({
      workspaceId: 'workspace',
      ventureProposalId: 'proposal',
      actorId: 'actor',
      workflowId: 'workflow',
    });

    expect(mocks.MockStorageProvider).toHaveBeenCalledWith();
  });
});
