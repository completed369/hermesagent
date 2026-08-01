import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthAbuseDigest } from '@ventureos/auth';
import { resolveInputs, resetFounderPassword, run } from './reset-founder-password.js';
import type { PrismaClient } from '@prisma/client';

interface UserUpdateArg {
  where: { id: string };
  data: { passwordHash: string };
}
interface SessionDeleteArg {
  where: { userId: string };
}
interface AuthAbuseDeleteArg {
  where: { channel: 'LOGIN'; scope: 'ACCOUNT'; keyDigest: string };
}

/** Minimal PrismaClient double covering only what the utility touches. */
function makePrisma(opts: { userExists?: boolean } = {}) {
  const captured: { update?: UserUpdateArg; del?: SessionDeleteArg; abuse?: AuthAbuseDeleteArg } =
    {};
  const userUpdate = vi.fn(async (arg: UserUpdateArg) => {
    captured.update = arg;
    return {};
  });
  const sessionDeleteMany = vi.fn(async (arg: SessionDeleteArg) => {
    captured.del = arg;
    return { count: 3 };
  });
  const authAbuseDeleteMany = vi.fn(async (arg: AuthAbuseDeleteArg) => {
    captured.abuse = arg;
    return { count: 1 };
  });
  const findUnique = vi.fn(async () =>
    opts.userExists === false ? null : { id: 'founder-id', passwordHash: 'old-hash' },
  );
  const tx = {
    user: { update: userUpdate },
    session: { deleteMany: sessionDeleteMany },
    authAbuseState: { deleteMany: authAbuseDeleteMany },
  };
  const prisma = {
    user: { findUnique },
    session: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    userUpdate,
    sessionDeleteMany,
    authAbuseDeleteMany,
    findUnique,
    captured,
  };
}

const SENTINEL_PASSWORD = 'sentinel-local-dev-password';
const SENTINEL_DIGEST_SECRET = 'sentinel-auth-abuse-digest-secret';

describe('resolveInputs', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  it('throws when DEV_FOUNDER_EMAIL is missing', () => {
    delete process.env.DEV_FOUNDER_EMAIL;
    process.env.DEV_FOUNDER_PASSWORD = SENTINEL_PASSWORD;
    expect(() => resolveInputs(['node', 'script'])).toThrow(/DEV_FOUNDER_EMAIL/);
  });

  it('throws when DEV_FOUNDER_PASSWORD is missing', () => {
    process.env.DEV_FOUNDER_EMAIL = 'founder@ventureos.local';
    delete process.env.DEV_FOUNDER_PASSWORD;
    expect(() => resolveInputs(['node', 'script'])).toThrow(/DEV_FOUNDER_PASSWORD/);
  });

  it('throws when DEV_FOUNDER_PASSWORD is blank', () => {
    process.env.DEV_FOUNDER_EMAIL = 'founder@ventureos.local';
    process.env.DEV_FOUNDER_PASSWORD = '   ';
    expect(() => resolveInputs(['node', 'script'])).toThrow(/DEV_FOUNDER_PASSWORD/);
  });

  it('does not include the password value in the thrown message', () => {
    let msg = '';
    try {
      resolveInputs(['node', 'script'], {
        DEV_FOUNDER_EMAIL: '',
        DEV_FOUNDER_PASSWORD: SENTINEL_PASSWORD,
      } as NodeJS.ProcessEnv);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toContain(SENTINEL_PASSWORD);
  });
});

describe('resetFounderPassword', () => {
  it('throws safely (no mutation) when the founder user does not exist', async () => {
    const { prisma, userUpdate, sessionDeleteMany } = makePrisma({ userExists: false });
    await expect(
      resetFounderPassword({
        email: 'missing@ventureos.local',
        password: SENTINEL_PASSWORD,
        abuseDigestSecret: SENTINEL_DIGEST_SECRET,
        dryRun: false,
        prisma,
      }),
    ).rejects.toThrow(/not found/i);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it('dry-run performs no user update and no session deletion', async () => {
    const { prisma, userUpdate, sessionDeleteMany, findUnique } = makePrisma();
    await resetFounderPassword({
      email: 'founder@ventureos.local',
      password: SENTINEL_PASSWORD,
      abuseDigestSecret: SENTINEL_DIGEST_SECRET,
      dryRun: true,
      prisma,
    });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('success updates the password, revokes sessions, and clears account cooldowns', async () => {
    const { prisma, userUpdate, sessionDeleteMany, authAbuseDeleteMany, captured } = makePrisma();
    await resetFounderPassword({
      email: 'founder@ventureos.local',
      password: SENTINEL_PASSWORD,
      abuseDigestSecret: SENTINEL_DIGEST_SECRET,
      dryRun: false,
      prisma,
    });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(sessionDeleteMany).toHaveBeenCalledTimes(1);
    expect(authAbuseDeleteMany).toHaveBeenCalledTimes(1);

    expect(captured.update?.where.id).toBe('founder-id');
    expect(typeof captured.update?.data.passwordHash).toBe('string');
    expect(captured.update?.data.passwordHash).not.toBe('old-hash');
    expect(captured.del?.where.userId).toBe('founder-id');
    expect(captured.abuse?.where).toMatchObject({ channel: 'LOGIN', scope: 'ACCOUNT' });
    expect(captured.abuse?.where.keyDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes the configured founder email before lookup and cooldown clearing', async () => {
    const { prisma, findUnique, captured } = makePrisma();

    await resetFounderPassword({
      email: '  FOUNDER@VENTUREOS.LOCAL  ',
      password: SENTINEL_PASSWORD,
      abuseDigestSecret: SENTINEL_DIGEST_SECRET,
      dryRun: false,
      prisma,
    });

    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'founder@ventureos.local' } });
    expect(captured.abuse?.where.keyDigest).toBe(
      createAuthAbuseDigest(SENTINEL_DIGEST_SECRET, 'account', 'founder@ventureos.local'),
    );
  });

  it('does not leak the password into console output on success', async () => {
    const { prisma } = makePrisma();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await run(prisma, ['node', 'script'], {
        DEV_FOUNDER_EMAIL: 'founder@ventureos.local',
        DEV_FOUNDER_PASSWORD: SENTINEL_PASSWORD,
        AUTH_SECRET: SENTINEL_DIGEST_SECRET,
      } as NodeJS.ProcessEnv);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
    const allOutput = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map((c) => String(c[0] ?? ''))
      .join('\n');
    expect(allOutput).not.toContain(SENTINEL_PASSWORD);
  });
});

describe('production refusal', () => {
  const PROD_ENV = {
    NODE_ENV: 'production',
    DEV_FOUNDER_EMAIL: 'founder@ventureos.local',
    DEV_FOUNDER_PASSWORD: SENTINEL_PASSWORD,
  } as NodeJS.ProcessEnv;

  it('rejects the production dry-run before any database access', async () => {
    const { prisma, userUpdate, sessionDeleteMany, findUnique } = makePrisma();
    await expect(run(prisma, ['node', 'script', '--dry-run'], PROD_ENV)).rejects.toThrow(
      /disabled in production/i,
    );
    expect(findUnique).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects real production execution before any database access', async () => {
    const { prisma, userUpdate, sessionDeleteMany, findUnique } = makePrisma();
    await expect(run(prisma, ['node', 'script'], PROD_ENV)).rejects.toThrow(
      /disabled in production/i,
    );
    expect(findUnique).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects a directly invoked production reset (no mutation)', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { prisma, userUpdate, sessionDeleteMany } = makePrisma();
    try {
      await expect(
        resetFounderPassword({
          email: 'founder@ventureos.local',
          password: SENTINEL_PASSWORD,
          abuseDigestSecret: SENTINEL_DIGEST_SECRET,
          dryRun: false,
          prisma,
        }),
      ).rejects.toThrow(/disabled in production/i);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it('does not leak any environment value in the production refusal message', async () => {
    let msg = '';
    try {
      resolveInputs(['node', 'script'], PROD_ENV);
    } catch (e) {
      msg = (e as Error).message;
    }
    // The message must refuse production without leaking the email or password.
    expect(msg).not.toContain(SENTINEL_PASSWORD);
    expect(msg).not.toContain('founder@ventureos.local');
    expect(msg).toMatch(/disabled in production/i);
  });
});
