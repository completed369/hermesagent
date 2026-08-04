import { describe, expect, it } from 'vitest';
import {
  digestAuthIdentifier,
  normalizeAccountIdentifier,
  normalizeSourceIp,
} from './auth-identifiers';

const secret = 'synthetic-auth-identifier-test-secret';

describe('authentication identifier normalization', () => {
  it('normalizes account identifiers before digesting', () => {
    expect(normalizeAccountIdentifier('  Founder@Example.TEST  ')).toBe('founder@example.test');
  });

  it('canonicalizes IPv4 and IPv6 source addresses', () => {
    expect(normalizeSourceIp('192.0.2.10')).toBe('192.0.2.10');
    expect(normalizeSourceIp('2001:0db8:0000:0000:0000:ff00:0042:8329')).toBe(
      '2001:db8::ff00:42:8329',
    );
    expect(normalizeSourceIp('2001:db8::ff00:42:8329')).toBe('2001:db8::ff00:42:8329');
  });

  it('collapses IPv4-mapped IPv6 to the canonical IPv4 address', () => {
    expect(normalizeSourceIp('::ffff:192.0.2.10')).toBe('192.0.2.10');
    expect(normalizeSourceIp('::ffff:c000:020a')).toBe('192.0.2.10');
  });

  it('fails closed for an invalid source address', () => {
    expect(() => normalizeSourceIp('not-an-ip')).toThrow('Invalid source IP address');
  });

  it('stores deterministic domain-separated one-way digests', () => {
    const normalized = normalizeAccountIdentifier('Founder@Example.TEST');
    const accountDigest = digestAuthIdentifier('account', normalized, secret);
    const ipDigest = digestAuthIdentifier('ip', normalized, secret);

    expect(accountDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(accountDigest).toBe(digestAuthIdentifier('account', normalized, secret));
    expect(accountDigest).not.toContain(normalized);
    expect(accountDigest).not.toBe(ipDigest);
  });
});
