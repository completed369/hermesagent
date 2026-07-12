import { Client as MinioClient } from 'minio';
import { hashContent } from '@ventureos/security';
import type { StorageProvider, StoredFileMetadata, UploadFileInput } from './types';
import { isAllowedMimeType, isWithinSizeLimit } from './types';

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
    if (!isAllowedMimeType(input.contentType)) {
      throw new Error(`Rejected upload: MIME type not allowed: ${input.contentType}`);
    }
    if (!isWithinSizeLimit(input.sizeBytes, this.config.maxFileSizeMb)) {
      throw new Error(
        `Rejected upload: file size ${input.sizeBytes} bytes exceeds limit of ${this.config.maxFileSizeMb}MB`,
      );
    }
    // Reject path traversal in object keys.
    if (input.key.includes('..') || input.key.startsWith('/')) {
      throw new Error(`Rejected upload: unsafe object key: ${input.key}`);
    }

    await this.ensureBucket();

    const buffer = Buffer.isBuffer(input.body) ? input.body : await streamToBuffer(input.body);
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

  async getSignedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    return this.client.presignedGetObject(this.config.bucket, key, ttlSeconds);
  }

  async exists(key: string): Promise<boolean> {
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
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
