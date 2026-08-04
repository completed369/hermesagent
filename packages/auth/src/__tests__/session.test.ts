import { describe, expect, it } from 'vitest';
import { generateSessionToken, hashSessionToken } from '../session';

describe('session tokens', () => {
  it('generates an opaque 32-byte random token', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });

  it('derives a deterministic SHA-256 digest without retaining the raw token', () => {
    const token = generateSessionToken();
    const digest = hashSessionToken(token);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toBe(token);
    expect(hashSessionToken(token)).toBe(digest);
    expect(hashSessionToken(`${token}x`)).not.toBe(digest);
  });
});
