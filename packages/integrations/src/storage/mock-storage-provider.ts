import { hashContent } from '@ventureos/security';
import type { StorageProvider, StoredFileMetadata, UploadFileInput } from './types';
import { isAllowedMimeType, isWithinSizeLimit } from './types';

/**
 * In-memory storage provider used in unit/integration tests so tests never
 * depend on a running MinIO instance.
 */
export class MockStorageProvider implements StorageProvider {
  private readonly files = new Map<string, { buffer: Buffer; meta: StoredFileMetadata }>();

  constructor(private readonly maxFileSizeMb: number = 25) {}

  async upload(input: UploadFileInput): Promise<StoredFileMetadata> {
    if (!isAllowedMimeType(input.contentType)) {
      throw new Error(`Rejected upload: MIME type not allowed: ${input.contentType}`);
    }
    if (!isWithinSizeLimit(input.sizeBytes, this.maxFileSizeMb)) {
      throw new Error(`Rejected upload: file too large`);
    }
    if (input.key.includes('..') || input.key.startsWith('/')) {
      throw new Error(`Rejected upload: unsafe object key: ${input.key}`);
    }
    const buffer = Buffer.isBuffer(input.body) ? input.body : Buffer.from('');
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

  async getSignedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    return `mock://signed/${encodeURIComponent(key)}?ttl=${ttlSeconds}`;
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  async healthCheck(): Promise<{ healthy: boolean }> {
    return { healthy: true };
  }
}
