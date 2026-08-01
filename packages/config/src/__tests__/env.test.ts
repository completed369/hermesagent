import { describe, expect, it } from 'vitest';
import { envSchema, __resetEnvCacheForTests, loadEnv } from '../env';

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

  it('applies safe defaults for optional values', () => {
    const result = envSchema.parse({
      DATABASE_URL: 'postgresql://localhost:5432/ventureos',
      AUTH_SECRET: 'x'.repeat(32),
    });
    expect(result.NODE_ENV).toBe('development');
    expect(result.AI_PROVIDER).toBe('mock');
    expect(result.FEATURE_LIVE_PUBLISHING_ENABLED).toBe(false);
    expect(result.GOVERNANCE_BOARD_APPROVAL_THRESHOLD).toBe(75);
    expect(result.API_TRUST_PROXY_HOPS).toBe(0);
  });

  it('accepts only a bounded trusted-proxy hop count', () => {
    const base = {
      DATABASE_URL: 'postgresql://localhost:5432/ventureos',
      AUTH_SECRET: 'x'.repeat(32),
    };
    expect(envSchema.parse({ ...base, API_TRUST_PROXY_HOPS: '1' }).API_TRUST_PROXY_HOPS).toBe(1);
    expect(envSchema.safeParse({ ...base, API_TRUST_PROXY_HOPS: '-1' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, API_TRUST_PROXY_HOPS: '11' }).success).toBe(false);
  });

  it('validates an optional dedicated authentication-abuse digest secret', () => {
    const base = {
      DATABASE_URL: 'postgresql://localhost:5432/ventureos',
      AUTH_SECRET: 'x'.repeat(32),
    };
    expect(
      envSchema.parse({ ...base, AUTH_ABUSE_DIGEST_SECRET: 'y'.repeat(32) })
        .AUTH_ABUSE_DIGEST_SECRET,
    ).toBe('y'.repeat(32));
    expect(envSchema.safeParse({ ...base, AUTH_ABUSE_DIGEST_SECRET: 'too-short' }).success).toBe(
      false,
    );
  });

  it('defaults and bounds the registration response timing floor', () => {
    const base = {
      DATABASE_URL: 'postgresql://localhost:5432/ventureos',
      AUTH_SECRET: 'x'.repeat(32),
    };
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
    const env = loadEnv({
      DATABASE_URL: 'postgresql://localhost:5432/ventureos',
      AUTH_SECRET: 'x'.repeat(32),
    } as NodeJS.ProcessEnv);
    expect(env.APP_NAME).toBe('VentureOS');
    __resetEnvCacheForTests();
  });
});
