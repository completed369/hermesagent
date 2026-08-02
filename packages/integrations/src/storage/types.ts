export interface UploadFileInput {
  workspaceId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  body: Buffer | NodeJS.ReadableStream;
}

export interface StoredFileMetadata {
  key: string;
  bucket: string;
  contentType: string;
  sizeBytes: number;
  contentHash: string;
  uploadedAt: string;
}

export function assertWorkspaceStorageKey(workspaceId: string, key: string): void {
  const requiredPrefix = `workspaces/${workspaceId}/`;
  if (!key.startsWith(requiredPrefix) || key.includes('..') || key.includes('\\')) {
    throw new Error('Storage object key is outside the authorized workspace namespace');
  }
}

export interface StorageProvider {
  readonly mode: 'mock' | 'minio' | 's3';
  upload(input: UploadFileInput): Promise<StoredFileMetadata>;
  getSignedDownloadUrl(workspaceId: string, key: string, ttlSeconds: number): Promise<string>;
  exists(workspaceId: string, key: string): Promise<boolean>;
  healthCheck(): Promise<{ healthy: boolean; message?: string }>;
}

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
] as const;

export function isAllowedMimeType(mime: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

export function isWithinSizeLimit(sizeBytes: number, maxSizeMb: number): boolean {
  return sizeBytes > 0 && sizeBytes <= maxSizeMb * 1024 * 1024;
}
