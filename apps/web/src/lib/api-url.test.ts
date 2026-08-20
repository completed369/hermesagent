import { describe, expect, it } from 'vitest';

import { buildApiUrl } from './api-url';

describe('buildApiUrl', () => {
  it('keeps paths and query parameters on the configured API prefix', () => {
    expect(buildApiUrl('https://api-staging.ventureos.site', '/audit-events?limit=100')).toBe(
      'https://api-staging.ventureos.site/api/audit-events?limit=100',
    );
    expect(buildApiUrl('http://api:3001/', '/auth/me')).toBe('http://api:3001/api/auth/me');
  });

  it.each([
    '//attacker.invalid/path',
    '/../health',
    '/%2e%2e/health',
    '/records%2f..%2fhealth',
    '/records\\..\\health',
    '/records#fragment',
    '/records\u0000suffix',
  ])('rejects an unsafe API path: %s', (path) => {
    expect(() => buildApiUrl('http://api:3001', path)).toThrow();
  });

  it.each([
    'file:///etc/passwd',
    'http://user:password@api:3001',
    'http://api:3001/private',
    'http://api:3001?target=elsewhere',
  ])('rejects an unsafe API base URL: %s', (baseUrl) => {
    expect(() => buildApiUrl(baseUrl, '/auth/me')).toThrow();
  });
});
