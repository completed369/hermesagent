import { describe, expect, it } from 'vitest';
import { envSchema, __resetEnvCacheForTests, loadEnv } from '../env';

const validBaseEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/ventureos',
  AUTH_SECRET: 'x'.repeat(32),
  AI_PROVIDER: 'mock',
  STORAGE_PROVIDER: 'mock',
  MARKETPLACE_ETSY_MODE: 'mock',
} as const;

describe('envSchema', () => {
  it('fails closed when DATABASE_URL is missing', () => {
    const result = envSchema.safeParse({ AUTH_SECRET: 'x'.repeat(32) });
    expect(result.success).toBe(false);
  });

  it('fails closed when AUTH_SECRET is too short', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://x',
      AUTH_SECRET: 'short',
    });
    expect(result.success).toBe(false);
  });

  it.each(['AI_PROVIDER', 'STORAGE_PROVIDER', 'MARKETPLACE_ETSY_MODE'] as const)(
    'fails closed when required provider selection %s is missing',
    (providerKey) => {
      expect(envSchema.safeParse({ ...validBaseEnv, [providerKey]: undefined }).success).toBe(
        false,
      );
    },
  );

  it('applies safe defaults for optional values', () => {
    const result = envSchema.parse(validBaseEnv);
    expect(result.NODE_ENV).toBe('development');
    expect(result.AI_PROVIDER).toBe('mock');
    expect(result.FEATURE_LIVE_PUBLISHING_ENABLED).toBe(false);
    expect(result.FEATURE_STORAGE_UPLOADS_ENABLED).toBe(false);
    expect(result.GOVERNANCE_BOARD_APPROVAL_THRESHOLD).toBe(75);
    expect(result.API_TRUST_PROXY_HOPS).toBe(0);
  });

  it('fails closed for malformed boolean policy configuration', () => {
    const result = envSchema.safeParse({
      ...validBaseEnv,
      FEATURE_LIVE_PUBLISHING_ENABLED: 'yes',
    });
    expect(result.success).toBe(false);
  });

  it('validates reserved provider selections without enabling unavailable providers', () => {
    const base = validBaseEnv;
    expect(envSchema.safeParse({ ...base, ADVERTISING_PROVIDER_MODE: 'live' }).success).toBe(true);
    expect(envSchema.safeParse({ ...base, ADVERTISING_PROVIDER_MODE: 'mock' }).success).toBe(false);
  });

  it('accepts only a bounded trusted-proxy hop count', () => {
    const base = validBaseEnv;
    expect(envSchema.parse({ ...base, API_TRUST_PROXY_HOPS: '1' }).API_TRUST_PROXY_HOPS).toBe(1);
    expect(envSchema.safeParse({ ...base, API_TRUST_PROXY_HOPS: '-1' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, API_TRUST_PROXY_HOPS: '11' }).success).toBe(false);
  });

  it('defaults worker activity concurrency conservatively and enforces its bounds', () => {
    expect(envSchema.parse(validBaseEnv).WORKER_MAX_CONCURRENT_ACTIVITIES).toBe(4);
    expect(
      envSchema.parse({ ...validBaseEnv, WORKER_MAX_CONCURRENT_ACTIVITIES: '1' })
        .WORKER_MAX_CONCURRENT_ACTIVITIES,
    ).toBe(1);
    expect(
      envSchema.parse({ ...validBaseEnv, WORKER_MAX_CONCURRENT_ACTIVITIES: '16' })
        .WORKER_MAX_CONCURRENT_ACTIVITIES,
    ).toBe(16);
    expect(
      envSchema.safeParse({ ...validBaseEnv, WORKER_MAX_CONCURRENT_ACTIVITIES: '0' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...validBaseEnv, WORKER_MAX_CONCURRENT_ACTIVITIES: '17' }).success,
    ).toBe(false);
  });

  it('validates an optional dedicated authentication-abuse digest secret', () => {
    const base = validBaseEnv;
    expect(
      envSchema.parse({ ...base, AUTH_ABUSE_DIGEST_SECRET: 'y'.repeat(32) })
        .AUTH_ABUSE_DIGEST_SECRET,
    ).toBe('y'.repeat(32));
    expect(envSchema.safeParse({ ...base, AUTH_ABUSE_DIGEST_SECRET: 'too-short' }).success).toBe(
      false,
    );
  });

  it('defaults and bounds the registration response timing floor', () => {
    const base = validBaseEnv;
    expect(envSchema.parse(base).AUTH_REGISTRATION_MIN_RESPONSE_MS).toBe(300);
    expect(envSchema.safeParse({ ...base, AUTH_REGISTRATION_MIN_RESPONSE_MS: '50' }).success).toBe(
      true,
    );
    expect(envSchema.safeParse({ ...base, AUTH_REGISTRATION_MIN_RESPONSE_MS: '49' }).success).toBe(
      false,
    );
    expect(
      envSchema.safeParse({ ...base, AUTH_REGISTRATION_MIN_RESPONSE_MS: '2001' }).success,
    ).toBe(false);
  });

  it('memoizes loadEnv until reset', () => {
    __resetEnvCacheForTests();
    const env = loadEnv(validBaseEnv as NodeJS.ProcessEnv);
    expect(env.APP_NAME).toBe('VentureOS');
    __resetEnvCacheForTests();
  });

  it('enforces the fail-closed staging production contract', () => {
    const staging = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      DEPLOYMENT_ENVIRONMENT: 'staging',
      API_PUBLIC_ORIGIN: 'https://api.staging.ventureos.invalid',
      WEB_PUBLIC_ORIGIN: 'https://web.staging.ventureos.invalid',
      API_CORS_ORIGIN: 'https://web.staging.ventureos.invalid',
      AUTH_COOKIE_DOMAIN: 'ventureos.invalid',
      AUTH_SECRET: 'a'.repeat(64),
      AUTH_ABUSE_DIGEST_SECRET: 'b'.repeat(64),
      DEV_LOGIN_ENABLED: 'false',
    };
    expect(envSchema.safeParse(staging).success).toBe(true);
    expect(envSchema.safeParse({ ...staging, AUTH_COOKIE_DOMAIN: undefined }).success).toBe(false);
    expect(envSchema.safeParse({ ...staging, AUTH_COOKIE_DOMAIN: 'example.invalid' }).success).toBe(
      false,
    );
    expect(
      envSchema.safeParse({ ...staging, API_PUBLIC_ORIGIN: 'http://api.internal' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...staging, WEB_PUBLIC_ORIGIN: 'http://web.internal' }).success,
    ).toBe(false);
    expect(envSchema.safeParse({ ...staging, AI_PROVIDER: 'anthropic' }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...staging, FEATURE_LIVE_PUBLISHING_ENABLED: 'true' }).success,
    ).toBe(false);
    expect(envSchema.safeParse({ ...staging, DEV_LOGIN_ENABLED: 'true' }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...staging, AUTH_SECRET: 'change-me-placeholder-secret-value' })
        .success,
    ).toBe(false);
  });
});
