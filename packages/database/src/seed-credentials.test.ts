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

  it('allows only an explicit mock-only staging fixture seed in a production runtime', () => {
    const stagingEnv = {
      ...VALID_ENV,
      NODE_ENV: 'production',
      DEPLOYMENT_ENVIRONMENT: 'staging',
      STAGING_SEED_ENABLED: 'true',
      AI_PROVIDER: 'mock',
      STORAGE_PROVIDER: 'mock',
      MARKETPLACE_ETSY_MODE: 'mock',
      FEATURE_LIVE_PUBLISHING_ENABLED: 'false',
      FEATURE_STORAGE_UPLOADS_ENABLED: 'false',
      FEATURE_ADVERTISING_ENABLED: 'false',
      FEATURE_PAID_INTEGRATIONS_ENABLED: 'false',
    };
    expect(resolveSeedFounderCredentials(stagingEnv)).toMatchObject({
      email: VALID_ENV.DEV_FOUNDER_EMAIL,
    });
    expect(() =>
      resolveSeedFounderCredentials({ ...stagingEnv, FEATURE_LIVE_PUBLISHING_ENABLED: 'true' }),
    ).toThrow(/disabled in production/i);
  });

  it('returns explicit non-placeholder credentials outside production', () => {
    expect(resolveSeedFounderCredentials(VALID_ENV)).toEqual({
      email: VALID_ENV.DEV_FOUNDER_EMAIL,
      password: VALID_ENV.DEV_FOUNDER_PASSWORD,
    });
  });

  it('normalizes the founder email before any seed lookup or write', () => {
    expect(
      resolveSeedFounderCredentials({
        ...VALID_ENV,
        DEV_FOUNDER_EMAIL: '  FOUNDER@EXAMPLE.TEST  ',
      }),
    ).toMatchObject({ email: 'founder@example.test' });
  });
});
