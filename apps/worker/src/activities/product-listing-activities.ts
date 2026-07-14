import { loadEnv } from '@ventureos/config';
import { MinioStorageProvider } from '@ventureos/integrations';
import {
  generateProduct,
  generateListingAndApprovalRequest,
  type GenerateProductResult,
  type GenerateListingAndApprovalResult,
} from '@ventureos/product-studio';
import { writeAuditEvent } from '../lib/write-audit-event';

/**
 * Constructs the real MinIO-backed StorageProvider from env config -- the
 * same construction as apps/api's HealthService.readiness(), but here
 * because the WORKER (not the API request) is what actually calls
 * generateProductAssets(). @ventureos/product-studio stays environment-
 * agnostic; only the caller wires up a real provider.
 */
function buildStorageProvider(): MinioStorageProvider {
  const env = loadEnv();
  return new MinioStorageProvider({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
    bucket: env.MINIO_BUCKET,
    maxFileSizeMb: env.STORAGE_MAX_FILE_SIZE_MB,
  });
}

export interface GenerateProductActivityInput {
  workspaceId: string;
  ventureProposalId: string;
  actorId: string;
  workflowId: string;
}

export async function generateProductActivity(
  input: GenerateProductActivityInput,
): Promise<GenerateProductResult> {
  const result = await generateProduct({
    workspaceId: input.workspaceId,
    ventureProposalId: input.ventureProposalId,
    storageProvider: buildStorageProvider(),
  });
  await writeAuditEvent(input.workspaceId, {
    actorId: input.actorId,
    action: 'PRODUCT_GENERATED',
    entityType: 'Product',
    entityId: result.productId,
    workflowId: input.workflowId,
    after: result as unknown as Record<string, unknown>,
  });
  return result;
}

export interface GenerateListingActivityInput {
  workspaceId: string;
  productId: string;
  requestedBy: string;
  workflowId: string;
}

export async function generateListingActivity(
  input: GenerateListingActivityInput,
): Promise<GenerateListingAndApprovalResult> {
  const result = await generateListingAndApprovalRequest({
    workspaceId: input.workspaceId,
    productId: input.productId,
    requestedBy: input.requestedBy,
    workflowId: input.workflowId,
  });
  await writeAuditEvent(input.workspaceId, {
    actorId: input.requestedBy,
    action: 'LISTING_GENERATED',
    entityType: 'ListingVersion',
    entityId: result.listingVersionId,
    workflowId: input.workflowId,
    after: { listingId: result.listingId, seoScore: result.seoScore },
  });
  await writeAuditEvent(input.workspaceId, {
    actorId: input.requestedBy,
    action: 'APPROVAL_REQUESTED',
    entityType: 'ApprovalRequest',
    entityId: result.approvalRequestId,
    workflowId: input.workflowId,
    after: { kind: 'PRODUCT_LISTING', listingVersionId: result.listingVersionId },
  });
  return result;
}
