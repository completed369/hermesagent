import { describe, expect, it } from 'vitest';
import { resolveSeedFounderCredentials } from './seed-credentials.js';

const VALID_ENV = {
  NODE_ENV: 'test',
  DEV_FOUNDER_EMAIL: 'founder@example.test',
  DEV_FOUNDER_PASSWORD: 'Synthetic-Founder-Password-2026!',
} as NodeJS.ProcessEnv;

describe('resolveSeedFounderCredentials', () => {
  it('rejects missing founder credentials instead of creating a known account', () => {
    expect(() => resolveSeedFounderCredentials({ NODE_ENV: 'test' })).toThrow(
      /DEV_FOUNDER_EMAIL.*DEV_FOUNDER_PASSWORD/i,
    );
  });

  it('rejects the repository placeholder password', () => {
    expect(() =>
      resolveSeedFounderCredentials({
        ...VALID_ENV,
        DEV_FOUNDER_PASSWORD: 'change-me-dev-only',
      }),
    ).toThrow(/placeholder/i);
  });

  it('refuses to seed fixture data in production', () => {
    expect(() => resolveSeedFounderCredentials({ ...VALID_ENV, NODE_ENV: 'production' })).toThrow(
      /disabled in production/i,
    );
  });

  it('returns explicit non-placeholder credentials outside production', () => {
    expect(resolveSeedFounderCredentials(VALID_ENV)).toEqual({
      email: VALID_ENV.DEV_FOUNDER_EMAIL,
      password: VALID_ENV.DEV_FOUNDER_PASSWORD,
    });
  });
});
