import { hashContent } from '@ventureos/security';
import { enforceWorkspaceCapability, hasAuditedCapabilityDispatch } from '@ventureos/database';
import type { StorageProvider, StoredFileMetadata, UploadFileInput } from './types.js';
import { assertWorkspaceStorageKey, isAllowedMimeType, isWithinSizeLimit } from './types.js';

/**
 * In-memory storage provider used in unit/integration tests so tests never
 * depend on a running MinIO instance.
 */
export class MockStorageProvider implements StorageProvider {
  readonly mode = 'mock' as const;
  private readonly files = new Map<string, { buffer: Buffer; meta: StoredFileMetadata }>();

  constructor(private readonly maxFileSizeMb: number = 25) {}

  async upload(input: UploadFileInput): Promise<StoredFileMetadata> {
    assertWorkspaceStorageKey(input.workspaceId, input.key);
    if (!isAllowedMimeType(input.contentType)) {
      throw new Error(`Rejected upload: MIME type not allowed: ${input.contentType}`);
    }
    if (!isWithinSizeLimit(input.sizeBytes, this.maxFileSizeMb)) {
      throw new Error(`Rejected upload: file too large`);
    }

    const buffer = Buffer.isBuffer(input.body) ? input.body : Buffer.from('');
    await this.authorize(input.workspaceId);
    const meta: StoredFileMetadata = {
      key: input.key,
      bucket: 'mock-bucket',
      contentType: input.contentType,
      sizeBytes: buffer.length,
      contentHash: hashContent(buffer),
      uploadedAt: new Date().toISOString(),
    };
    this.files.set(input.key, { buffer, meta });
    return meta;
  }

  async getSignedDownloadUrl(
    workspaceId: string,
    key: string,
    ttlSeconds: number,
  ): Promise<string> {
    assertWorkspaceStorageKey(workspaceId, key);
    await this.authorize(workspaceId);
    return `mock://signed/${encodeURIComponent(key)}?ttl=${ttlSeconds}`;
  }

  async exists(workspaceId: string, key: string): Promise<boolean> {
    assertWorkspaceStorageKey(workspaceId, key);
    await this.authorize(workspaceId);
    return this.files.has(key);
  }

  async healthCheck(): Promise<{ healthy: boolean }> {
    return { healthy: true };
  }

  private async authorize(workspaceId: string): Promise<void> {
    const dispatch = {
      workspaceId,
      capability: 'STORAGE_UPLOAD' as const,
      providerMode: this.mode,
    };
    await enforceWorkspaceCapability({
      ...dispatch,
      stage: 'DISPATCH',
      recordAllow: !hasAuditedCapabilityDispatch(dispatch),
    });
  }
}
