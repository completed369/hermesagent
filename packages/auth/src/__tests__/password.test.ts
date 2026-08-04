import { describe, expect, it } from 'vitest';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  verifyPasswordAsync,
} from '../password';

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('rejects malformed stored hashes safely', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
  });

  it('keeps the timing-equalization dummy value as a valid hash for the same verifier', () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword('arbitrary submitted password', DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it('verifies passwords asynchronously without blocking the event loop KDF path', async () => {
    const hash = hashPassword('correct horse battery staple');
    await expect(verifyPasswordAsync('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPasswordAsync('wrong password', hash)).resolves.toBe(false);
    await expect(verifyPasswordAsync('anything', 'not-a-valid-hash')).resolves.toBe(false);
  });

  it('hashes passwords asynchronously using the canonical verifier format', async () => {
    const hash = await hashPasswordAsync('correct horse battery staple');

    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });
});
