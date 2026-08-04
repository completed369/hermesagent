import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const minio = vi.hoisted(() => ({
  bucketExists: vi.fn(),
  makeBucket: vi.fn(),
  putObject: vi.fn(),
  statObject: vi.fn(),
  presignedGetObject: vi.fn(),
}));
const database = vi.hoisted(() => ({
  enforceWorkspaceCapability: vi.fn(),
  hasAuditedCapabilityDispatch: vi.fn(),
}));

vi.mock('@ventureos/database', () => ({
  enforceWorkspaceCapability: database.enforceWorkspaceCapability,
  hasAuditedCapabilityDispatch: database.hasAuditedCapabilityDispatch,
}));

vi.mock('minio', () => ({
  Client: vi.fn(function MockMinioClient() {
    return minio;
  }),
}));
import { MinioStorageProvider } from '../storage/minio-storage-provider';
import { MockStorageProvider } from '../storage/mock-storage-provider';
import { isAllowedMimeType, isWithinSizeLimit } from '../storage/types';

describe('storage validation helpers', () => {
  it('allows known-safe MIME types', () => {
    expect(isAllowedMimeType('application/pdf')).toBe(true);
    expect(isAllowedMimeType('application/x-msdownload')).toBe(false);
  });

  it('enforces file size limits', () => {
    expect(isWithinSizeLimit(1024, 25)).toBe(true);
    expect(isWithinSizeLimit(26 * 1024 * 1024, 25)).toBe(false);
    expect(isWithinSizeLimit(0, 25)).toBe(false);
  });
});

describe('MockStorageProvider', () => {
  beforeEach(() => {
    database.enforceWorkspaceCapability.mockReset();
    database.enforceWorkspaceCapability.mockResolvedValue(undefined);
  });

  it('rejects disallowed MIME types', async () => {
    const provider = new MockStorageProvider();
    await expect(
      provider.upload({
        workspaceId: 'workspace-test',
        key: 'workspaces/workspace-test/a.exe',
        contentType: 'application/x-msdownload',
        sizeBytes: 10,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow();
  });

  it('rejects path traversal in object keys', async () => {
    const provider = new MockStorageProvider();
    await expect(
      provider.upload({
        workspaceId: 'workspace-test',
        key: 'workspaces/workspace-test/../../etc/passwd',
        contentType: 'text/plain',
        sizeBytes: 10,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow();
  });

  it('stores and reports existence of valid uploads', async () => {
    const provider = new MockStorageProvider();
    const meta = await provider.upload({
      workspaceId: 'workspace-test',
      key: 'workspaces/workspace-test/ok.txt',
      contentType: 'text/plain',
      sizeBytes: 5,
      body: Buffer.from('hello'),
    });
    expect(meta.contentHash).toBeTruthy();
    expect(database.enforceWorkspaceCapability).toHaveBeenCalledWith({
      workspaceId: 'workspace-test',
      capability: 'STORAGE_UPLOAD',
      stage: 'DISPATCH',
      providerMode: 'mock',
      recordAllow: true,
    });
    expect(await provider.exists('workspace-test', 'workspaces/workspace-test/ok.txt')).toBe(true);
    expect(await provider.exists('workspace-test', 'workspaces/workspace-test/missing.txt')).toBe(
      false,
    );
  });

  it('denies before mutating mock storage', async () => {
    database.enforceWorkspaceCapability.mockRejectedValue(new Error('Operation is not available'));
    const provider = new MockStorageProvider();

    await expect(
      provider.upload({
        workspaceId: 'workspace-denied',
        key: 'workspaces/workspace-denied/blocked.txt',
        contentType: 'text/plain',
        sizeBytes: 1,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow('Operation is not available');
    database.enforceWorkspaceCapability.mockResolvedValue(undefined);
    expect(
      await provider.exists('workspace-denied', 'workspaces/workspace-denied/blocked.txt'),
    ).toBe(false);
  });

  it('rejects a cross-workspace key before authorization or storage mutation', async () => {
    const provider = new MockStorageProvider();

    await expect(
      provider.upload({
        workspaceId: 'workspace-a',
        key: 'workspaces/workspace-b/cross-tenant.txt',
        contentType: 'text/plain',
        sizeBytes: 1,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow('outside the authorized workspace namespace');
    expect(database.enforceWorkspaceCapability).not.toHaveBeenCalled();
    await expect(
      provider.exists('workspace-a', 'workspaces/workspace-b/cross-tenant.txt'),
    ).rejects.toThrow('outside the authorized workspace namespace');
  });

  it('rejects cross-workspace download and existence access', async () => {
    const provider = new MockStorageProvider();

    await expect(
      provider.getSignedDownloadUrl('workspace-a', 'workspaces/workspace-b/secret.txt', 60),
    ).rejects.toThrow('outside the authorized workspace namespace');
    await expect(
      provider.exists('workspace-a', 'workspaces/workspace-b/secret.txt'),
    ).rejects.toThrow('outside the authorized workspace namespace');
  });
});

describe('MinioStorageProvider policy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.enforceWorkspaceCapability.mockResolvedValue(undefined);
    minio.bucketExists.mockResolvedValue(true);
    minio.putObject.mockResolvedValue(undefined);
    minio.presignedGetObject.mockResolvedValue('https://storage.example.invalid/signed');
  });

  function createProvider() {
    return new MinioStorageProvider({
      endPoint: '127.0.0.1',
      port: 1,
      useSSL: false,
      accessKey: 'synthetic',
      secretKey: 'synthetic',
      bucket: 'synthetic',
      maxFileSizeMb: 1,
    });
  }

  it('fails closed at the provider boundary before network I/O', async () => {
    database.enforceWorkspaceCapability.mockRejectedValue(new Error('Operation is not available'));
    const provider = createProvider();

    await expect(
      provider.upload({
        workspaceId: 'workspace-denied',
        key: 'workspaces/workspace-denied/blocked.txt',
        contentType: 'text/plain',
        sizeBytes: 1,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow('Operation is not available');
    expect(database.enforceWorkspaceCapability).toHaveBeenCalledWith({
      workspaceId: 'workspace-denied',
      capability: 'STORAGE_UPLOAD',
      stage: 'DISPATCH',
      providerMode: 'minio',
      recordAllow: true,
    });
    expect(minio.bucketExists).not.toHaveBeenCalled();
    expect(minio.makeBucket).not.toHaveBeenCalled();
    expect(minio.statObject).not.toHaveBeenCalled();
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('authorizes before consuming a denied upload stream', async () => {
    database.enforceWorkspaceCapability.mockRejectedValue(new Error('Operation is not available'));
    let consumed = false;
    async function* body() {
      consumed = true;
      yield Buffer.from('x');
    }
    const provider = createProvider();

    await expect(
      provider.upload({
        workspaceId: 'workspace-denied',
        key: 'workspaces/workspace-denied/blocked.txt',
        contentType: 'text/plain',
        sizeBytes: 1,
        body: Readable.from(body()),
      }),
    ).rejects.toThrow('Operation is not available');

    expect(consumed).toBe(false);
    expect(minio.bucketExists).not.toHaveBeenCalled();
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('rejects when actual body bytes exceed the configured limit', async () => {
    const provider = createProvider();

    await expect(
      provider.upload({
        workspaceId: 'workspace-allowed',
        key: 'workspaces/workspace-allowed/oversized.txt',
        contentType: 'text/plain',
        sizeBytes: 1,
        body: Buffer.alloc(1024 * 1024 + 1),
      }),
    ).rejects.toThrow('exceeds limit');

    expect(minio.bucketExists).not.toHaveBeenCalled();
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('rejects a cross-workspace key before authorization or network I/O', async () => {
    const provider = createProvider();

    await expect(
      provider.upload({
        workspaceId: 'workspace-a',
        key: 'workspaces/workspace-b/cross-tenant.txt',
        contentType: 'text/plain',
        sizeBytes: 1,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow('outside the authorized workspace namespace');
    expect(database.enforceWorkspaceCapability).not.toHaveBeenCalled();
    expect(minio.bucketExists).not.toHaveBeenCalled();
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace signing and probing before MinIO I/O', async () => {
    const provider = createProvider();

    await expect(
      provider.getSignedDownloadUrl('workspace-a', 'workspaces/workspace-b/secret.txt', 60),
    ).rejects.toThrow('outside the authorized workspace namespace');
    await expect(
      provider.exists('workspace-a', 'workspaces/workspace-b/secret.txt'),
    ).rejects.toThrow('outside the authorized workspace namespace');

    expect(minio.presignedGetObject).not.toHaveBeenCalled();
    expect(minio.statObject).not.toHaveBeenCalled();
  });

  it('authorizes immediately before MinIO mutation on an allowed upload', async () => {
    const provider = createProvider();

    await provider.upload({
      workspaceId: 'workspace-allowed',
      key: 'workspaces/workspace-allowed/allowed.txt',
      contentType: 'text/plain',
      sizeBytes: 1,
      body: Buffer.from('x'),
    });

    expect(database.enforceWorkspaceCapability).toHaveBeenCalledWith({
      workspaceId: 'workspace-allowed',
      capability: 'STORAGE_UPLOAD',
      stage: 'DISPATCH',
      providerMode: 'minio',
      recordAllow: true,
    });
    expect(database.enforceWorkspaceCapability.mock.invocationCallOrder[0]).toBeLessThan(
      minio.bucketExists.mock.invocationCallOrder[0]!,
    );
    expect(minio.putObject).toHaveBeenCalledTimes(1);
  });

  it('suppresses only a duplicate allow inside an already-audited dispatch', async () => {
    database.hasAuditedCapabilityDispatch.mockReturnValue(true);
    const provider = createProvider();

    await provider.exists('workspace-allowed', 'workspaces/workspace-allowed/file.txt');

    expect(database.enforceWorkspaceCapability).toHaveBeenCalledWith(
      expect.objectContaining({ recordAllow: false }),
    );
  });
});
