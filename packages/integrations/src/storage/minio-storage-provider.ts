import { Client as MinioClient } from 'minio';
import { enforceWorkspaceCapability, hasAuditedCapabilityDispatch } from '@ventureos/database';
import { hashContent } from '@ventureos/security';
import type { StorageProvider, StoredFileMetadata, UploadFileInput } from './types.js';
import { assertWorkspaceStorageKey, isAllowedMimeType, isWithinSizeLimit } from './types.js';

export interface MinioStorageConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  maxFileSizeMb: number;
}

/**
 * S3-compatible storage adapter backed by MinIO for local/self-hosted
 * development. Swappable behind the StorageProvider interface so production
 * can later point at any S3-compatible provider without touching callers.
 */
export class MinioStorageProvider implements StorageProvider {
  readonly mode = 'minio' as const;
  private readonly client: MinioClient;

  constructor(private readonly config: MinioStorageConfig) {
    this.client = new MinioClient({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  async upload(input: UploadFileInput): Promise<StoredFileMetadata> {
    assertWorkspaceStorageKey(input.workspaceId, input.key);
    if (!isAllowedMimeType(input.contentType)) {
      throw new Error(`Rejected upload: MIME type not allowed: ${input.contentType}`);
    }
    if (!isWithinSizeLimit(input.sizeBytes, this.config.maxFileSizeMb)) {
      throw new Error(
        `Rejected upload: file size ${input.sizeBytes} bytes exceeds limit of ${this.config.maxFileSizeMb}MB`,
      );
    }

    await this.authorize(input.workspaceId);
    const maxBytes = this.config.maxFileSizeMb * 1024 * 1024;
    const buffer = Buffer.isBuffer(input.body)
      ? input.body
      : await streamToBuffer(input.body, maxBytes);
    if (!isWithinSizeLimit(buffer.length, this.config.maxFileSizeMb)) {
      throw new Error(
        `Rejected upload: actual file size ${buffer.length} bytes exceeds limit of ${this.config.maxFileSizeMb}MB`,
      );
    }
    await this.ensureBucket();
    await this.client.putObject(this.config.bucket, input.key, buffer, buffer.length, {
      'Content-Type': input.contentType,
    });

    return {
      key: input.key,
      bucket: this.config.bucket,
      contentType: input.contentType,
      sizeBytes: buffer.length,
      contentHash: hashContent(buffer),
      uploadedAt: new Date().toISOString(),
    };
  }

  async getSignedDownloadUrl(
    workspaceId: string,
    key: string,
    ttlSeconds: number,
  ): Promise<string> {
    assertWorkspaceStorageKey(workspaceId, key);
    await this.authorize(workspaceId);
    return this.client.presignedGetObject(this.config.bucket, key, ttlSeconds);
  }

  async exists(workspaceId: string, key: string): Promise<boolean> {
    assertWorkspaceStorageKey(workspaceId, key);
    await this.authorize(workspaceId);
    try {
      await this.client.statObject(this.config.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.client.bucketExists(this.config.bucket);
      return { healthy: true };
    } catch (err) {
      return { healthy: false, message: err instanceof Error ? err.message : 'unknown error' };
    }
  }

  private async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.config.bucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.config.bucket);
    }
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

async function streamToBuffer(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new Error(`Rejected upload: actual file size exceeds limit of ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
