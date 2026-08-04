import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import { hashPasswordAsync, verifyPasswordAsync } from '@ventureos/auth';
import { startTrialSubscription } from '@ventureos/billing';
import type { Env } from '@ventureos/config';
import { AuthService } from './auth.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthAbuseService } from './auth-abuse.service';

vi.mock('@ventureos/database', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    role: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    session: { create: vi.fn(), updateMany: vi.fn() },
    securityEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@ventureos/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ventureos/auth')>();
  return {
    ...actual,
    hashPasswordAsync: vi.fn().mockResolvedValue('salt:hash'),
    verifyPasswordAsync: vi.fn(),
  };
});

vi.mock('@ventureos/billing', () => ({
  startTrialSubscription: vi.fn().mockResolvedValue({}),
  SubscriptionAlreadyExistsError: class SubscriptionAlreadyExistsError extends Error {},
}));

const env = {
  AUTH_SESSION_MAX_AGE_SECONDS: 3600,
  AUTH_REGISTRATION_MIN_RESPONSE_MS: 300,
} as Env;

const request = { ip: '192.0.2.10', headers: { 'user-agent': 'auth-test' } };
const auditService = { record: vi.fn() } as unknown as AuditService;
const abuseContext = { accountDigest: 'a'.repeat(64), ipDigest: 'b'.repeat(64) };
const authAbuseService = {
  createContext: vi.fn(() => abuseContext),
  getActiveBlock: vi.fn().mockResolvedValue(null),
  recordAttempt: vi.fn().mockResolvedValue(null),
  clearLoginAccount: vi.fn().mockResolvedValue(undefined),
  cleanupExpired: vi.fn().mockResolvedValue(0),
} as unknown as AuthAbuseService;

function existingUser() {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'founder@example.test',
    passwordHash: 'real-salt:real-hash',
    displayName: 'Founder',
    isFounder: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
}

function registrationTransactionClient() {
  const user = {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'new@example.test',
    passwordHash: 'salt:hash',
    displayName: 'New Founder',
    isFounder: true,
  };
  const workspaceCreate = vi.fn(async ({ data }: { data: { name: string; slug: string } }) => ({
    id: '00000000-0000-4000-8000-000000000003',
    ...data,
  }));
  const tx = {
    user: { create: vi.fn().mockResolvedValue(user) },
    founderProfile: { create: vi.fn().mockResolvedValue({}) },
    workspace: { create: workspaceCreate },
    workspaceMember: { create: vi.fn().mockResolvedValue({}) },
    workspaceBranding: { create: vi.fn().mockResolvedValue({}) },
    securityEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  return { tx, workspaceCreate };
}

describe('AuthService login password verification', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.securityEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.session.create).mockResolvedValue({} as never);
    vi.mocked(verifyPasswordAsync).mockResolvedValue(false);
    vi.mocked(authAbuseService.getActiveBlock).mockResolvedValue(null);
    vi.mocked(authAbuseService.recordAttempt).mockResolvedValue(null);
    service = new AuthService(env, auditService, authAbuseService);
  });

  it('verifies the submitted password for an existing user failure', async () => {
    const user = existingUser();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user);

    await expect(service.login(user.email, 'wrong-password', request)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(verifyPasswordAsync).toHaveBeenCalledOnce();
    expect(verifyPasswordAsync).toHaveBeenCalledWith('wrong-password', user.passwordHash);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('still verifies the submitted password against a valid dummy hash for a missing user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(service.login('missing@example.test', 'wrong-password', request)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(verifyPasswordAsync).toHaveBeenCalledOnce();
    expect(verifyPasswordAsync).toHaveBeenCalledWith(
      'wrong-password',
      expect.stringMatching(/^[0-9a-f]+:[0-9a-f]+$/),
    );
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('uses the same generic external exception for missing and existing users', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(existingUser())
      .mockResolvedValueOnce(null);

    const existingFailure = service.login('founder@example.test', 'wrong-password', request);
    const missingFailure = service.login('missing@example.test', 'wrong-password', request);

    await expect(existingFailure).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password',
    });
    await expect(missingFailure).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password',
    });
  });

  it('returns a generic cooldown failure and creates no session when the account threshold is reached', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser());
    vi.mocked(authAbuseService.recordAttempt).mockResolvedValue({
      reasonCode: 'LOGIN_ACCOUNT_COOLDOWN',
      retryAfterSeconds: 60,
    });

    await expect(
      service.login('founder@example.test', 'wrong-password', request),
    ).rejects.toMatchObject({
      status: 429,
      message: 'Authentication temporarily unavailable',
      retryAfterSeconds: 60,
    });

    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('does not let a correct password bypass an active source-IP cooldown', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser());
    vi.mocked(verifyPasswordAsync).mockResolvedValue(true);
    vi.mocked(authAbuseService.getActiveBlock).mockResolvedValue({
      reasonCode: 'LOGIN_IP_COOLDOWN',
      retryAfterSeconds: 300,
    });

    await expect(
      service.login('founder@example.test', 'correct-password', request),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 300 });
    expect(verifyPasswordAsync).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(authAbuseService.clearLoginAccount).not.toHaveBeenCalled();
  });

  it('clears account failure state on an allowed successful login', async () => {
    const user = existingUser();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user);
    vi.mocked(verifyPasswordAsync).mockResolvedValue(true);

    await service.login(' FOUNDER@EXAMPLE.TEST ', 'correct-password', request);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'founder@example.test' },
    });
    expect(authAbuseService.clearLoginAccount).toHaveBeenCalledWith(abuseContext);
    expect(prisma.session.create).toHaveBeenCalledOnce();
  });

  it('records failed authentication without the submitted identifier, password, or raw IP', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      service.login('Sensitive.User@Example.TEST', 'submitted-password', request),
    ).rejects.toThrow(UnauthorizedException);

    const event = vi.mocked(prisma.securityEvent.create).mock.calls[0]?.[0];
    expect(event).toBeDefined();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('Sensitive.User@Example.TEST');
    expect(serialized).not.toContain('submitted-password');
    expect(serialized).not.toContain('192.0.2.10');
    expect(serialized).toContain('INVALID_CREDENTIALS');
  });

  it('returns a generic accepted result for duplicate registration without creating a session', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser());

    const result = await service.register(
      ' FOUNDER@EXAMPLE.TEST ',
      'not-a-real-password',
      'Founder',
      'Founder Workspace',
      request,
    );

    expect(result).toEqual({ accepted: true });
    expect(hashPasswordAsync).toHaveBeenCalledWith('not-a-real-password');
    expect(authAbuseService.recordAttempt).toHaveBeenCalledWith('REGISTER', abuseContext);
    expect(prisma.session.create).not.toHaveBeenCalled();
    const eventPayload = JSON.stringify(vi.mocked(prisma.securityEvent.create).mock.calls);
    expect(eventPayload).not.toContain('FOUNDER@EXAMPLE.TEST');
    expect(eventPayload).not.toContain('192.0.2.10');
    expect(eventPayload).not.toContain('not-a-real-password');
  });

  it('returns the generic accepted result when concurrent registration wins the email race', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingUser());
    vi.mocked(prisma.role.findUnique).mockResolvedValue({ id: 'founder-role' } as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockRejectedValue({ code: 'P2002' });

    await expect(
      service.register(
        'founder@example.test',
        'not-a-real-password',
        'Founder',
        'Founder Workspace',
        request,
      ),
    ).resolves.toEqual({ accepted: true });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    expect(auditService.record).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('holds accepted duplicate registration responses to the configured timing floor', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser());
      let settled = false;
      const result = service
        .register(
          'founder@example.test',
          'not-a-real-password',
          'Founder',
          'Founder Workspace',
          request,
        )
        .then((value) => {
          settled = true;
          return value;
        });

      await vi.advanceTimersByTimeAsync(299);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ accepted: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries slug collisions with a new suffix through the bounded retry budget', async () => {
    const { tx, workspaceCreate } = registrationTransactionClient();
    workspaceCreate
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: ['slug'] } })
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: ['slug'] } })
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: ['slug'] } })
      .mockResolvedValueOnce({
        id: '00000000-0000-4000-8000-000000000003',
        name: 'Shared Workspace',
        slug: 'shared-workspace-retried',
      });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.role.findUnique).mockResolvedValue({ id: 'founder-role' } as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await expect(
      service.register(
        'new@example.test',
        'not-a-real-password',
        'New Founder',
        'Shared Workspace',
        request,
      ),
    ).resolves.toEqual({ accepted: true });

    const slugs = workspaceCreate.mock.calls.map((call) => call[0].data.slug);
    expect(slugs).toHaveLength(4);
    expect(slugs[0]).toBe('shared-workspace');
    expect(new Set(slugs).size).toBe(4);
    expect(slugs.slice(1).every((slug) => /^shared-workspace-[0-9a-f]{8}$/.test(slug))).toBe(true);
    expect(startTrialSubscription).toHaveBeenCalledOnce();
    expect(startTrialSubscription).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000003', tx);
    expect(auditService.record).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000003',
      expect.objectContaining({ action: 'WORKSPACE_REGISTERED' }),
      tx,
    );
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('fails generically and observes the timing floor after exhausting slug retries', async () => {
    vi.useFakeTimers();
    try {
      const { tx, workspaceCreate } = registrationTransactionClient();
      workspaceCreate.mockRejectedValue({
        code: 'P2002',
        message: 'Unique constraint failed on workspaces_slug_key',
        meta: { target: ['slug'] },
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.role.findUnique).mockResolvedValue({ id: 'founder-role' } as never);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

      let settled = false;
      const result = service
        .register(
          'new@example.test',
          'not-a-real-password',
          'New Founder',
          'Shared Workspace',
          request,
        )
        .then(
          () => undefined,
          (error: unknown) => {
            settled = true;
            return error;
          },
        );

      await vi.advanceTimersByTimeAsync(299);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await result;
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error).toMatchObject({ status: 503, message: 'Registration temporarily unavailable' });
      expect(JSON.stringify(error)).not.toContain('workspaces_slug_key');
      expect(prisma.$transaction).toHaveBeenCalledTimes(4);
      expect(startTrialSubscription).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
      expect(prisma.session.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry or expose an unconfirmed P2002 constraint', async () => {
    const { tx, workspaceCreate } = registrationTransactionClient();
    workspaceCreate.mockRejectedValue({
      code: 'P2002',
      message: 'internal unique detail',
      meta: { target: ['unrelatedField'] },
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.role.findUnique).mockResolvedValue({ id: 'founder-role' } as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    const error = await service
      .register(
        'new@example.test',
        'not-a-real-password',
        'New Founder',
        'Shared Workspace',
        request,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).toBe('Registration temporarily unavailable');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
