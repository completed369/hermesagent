import { describe, expect, it } from 'vitest';
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
  it('rejects disallowed MIME types', async () => {
    const provider = new MockStorageProvider();
    await expect(
      provider.upload({
        key: 'a.exe',
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
        key: '../../etc/passwd',
        contentType: 'text/plain',
        sizeBytes: 10,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow();
  });

  it('stores and reports existence of valid uploads', async () => {
    const provider = new MockStorageProvider();
    const meta = await provider.upload({
      key: 'ok.txt',
      contentType: 'text/plain',
      sizeBytes: 5,
      body: Buffer.from('hello'),
    });
    expect(meta.contentHash).toBeTruthy();
    expect(await provider.exists('ok.txt')).toBe(true);
    expect(await provider.exists('missing.txt')).toBe(false);
  });
});
