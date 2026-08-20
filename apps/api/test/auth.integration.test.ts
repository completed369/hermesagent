import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { prisma } from '@ventureos/database';
import { createAuthAbuseDigest, hashPassword, hashSessionToken } from '@ventureos/auth';
import { loadEnv } from '@ventureos/config';

/**
 * Requires a real, migrated, seeded PostgreSQL database reachable via
 * DATABASE_URL. Run `pnpm db:migrate && pnpm db:seed` first.
 */
describe('Auth flow (integration)', () => {
  let app: INestApplication;
  const env = loadEnv();
  const testEmail = `it-test-${Date.now()}@ventureos.local`;
  const testPassword = 'integration-test-password';

  async function clearAuthAbuseState(accountEmails: string[]): Promise<void> {
    const secret = env.AUTH_ABUSE_DIGEST_SECRET ?? env.AUTH_SECRET;
    const keyDigests = [
      createAuthAbuseDigest(secret, 'ip', '127.0.0.1'),
      ...accountEmails.map((email) =>
        createAuthAbuseDigest(secret, 'account', email.trim().toLowerCase()),
      ),
    ];
    await prisma.authAbuseState.deleteMany({ where: { keyDigest: { in: keyDigests } } });
  }

  async function login() {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPassword });
    const setCookie = response.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookie) throw new Error('Login did not return a session cookie');
    const rawToken = cookie.split(';', 1)[0]?.split('=', 2)[1];
    if (!rawToken) throw new Error('Session cookie did not contain a token');
    return { response, cookie, rawToken };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule);
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();

    const founderRole = await prisma.role.findUniqueOrThrow({ where: { key: 'FOUNDER' } });
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: 'ventureos-default' },
    });
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: hashPassword(testPassword),
        displayName: 'Integration Test User',
      },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, roleId: founderRole.id },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { email: testEmail } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects unauthenticated access to a protected route', async () => {
    const server = app.getHttpServer();
    const res = await request(server).get('/api/workspaces/current');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid password', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('stores only a token digest while preserving authenticated lookup', async () => {
    const { response: loginRes, cookie, rawToken } = await login();
    expect(loginRes.status).toBe(200);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');

    const digest = hashSessionToken(rawToken);
    const persisted = await prisma.session.findUnique({ where: { tokenDigest: digest } });
    const rawLookup = await prisma.session.findUnique({ where: { tokenDigest: rawToken } });
    expect(persisted).not.toBeNull();
    expect(persisted?.tokenDigest).toBe(digest);
    expect(persisted?.tokenDigest).not.toBe(rawToken);
    expect(persisted?.activeWorkspaceId).not.toBeNull();
    if (!persisted?.activeWorkspaceId) {
      throw new Error('Login session did not receive an active workspace');
    }
    expect(
      await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: persisted.activeWorkspaceId,
            userId: persisted.userId,
          },
        },
      }),
    ).not.toBeNull();
    expect(rawLookup).toBeNull();

    const meRes = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(testEmail);
  });

  it('rejects cross-origin logout and accepts the configured web origin', async () => {
    const { cookie, rawToken } = await login();
    const digest = hashSessionToken(rawToken);

    const rejected = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie);
    expect(rejected.status).toBe(403);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { tokenDigest: digest } })).revokedAt,
    ).toBeNull();

    const accepted = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', env.API_CORS_ORIGIN);
    expect(accepted.status).toBe(200);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { tokenDigest: digest } })).revokedAt,
    ).not.toBeNull();

    const meRes = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie);
    expect(meRes.status).toBe(401);
  });

  it('returns a controlled shared cooldown response without storing raw authentication inputs', async () => {
    await clearAuthAbuseState([testEmail]);
    const attemptedPassword = 'definitely-not-the-founder-password';

    try {
      for (let attempt = 1; attempt < 5; attempt += 1) {
        const response = await request(app.getHttpServer()).post('/api/auth/login').send({
          email: testEmail,
          password: attemptedPassword,
        });
        expect(response.status).toBe(401);
      }

      const blocked = await request(app.getHttpServer()).post('/api/auth/login').send({
        email: testEmail,
        password: attemptedPassword,
      });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
      expect(blocked.body.message).toBe('Authentication temporarily unavailable');

      const event = await prisma.securityEvent.findFirst({
        where: { type: 'LOGIN_FAILURE' },
        orderBy: { createdAt: 'desc' },
      });
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain(testEmail);
      expect(serialized).not.toContain(attemptedPassword);
      expect(serialized).not.toContain('127.0.0.1');
    } finally {
      await clearAuthAbuseState([testEmail]);
    }
  });

  it('does not trust spoofed forwarding headers when proxy trust is disabled', async () => {
    const attemptedEmails = Array.from(
      { length: 20 },
      (_, index) => `missing-${index + 1}@ventureos.invalid`,
    );
    await clearAuthAbuseState(attemptedEmails);

    try {
      for (let attempt = 1; attempt < 20; attempt += 1) {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .set('X-Forwarded-For', `198.51.100.${attempt}`)
          .send({ email: `missing-${attempt}@ventureos.invalid`, password: 'invalid-password' });
        expect(response.status).toBe(401);
      }

      const blocked = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.200')
        .send({ email: 'missing-20@ventureos.invalid', password: 'invalid-password' });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
    } finally {
      await clearAuthAbuseState(attemptedEmails);
    }
  });

  it('returns an indistinguishable accepted response for new and existing registration identifiers', async () => {
    const registrationEmail = `registration-${Date.now()}@ventureos.local`;
    const body = {
      email: registrationEmail,
      password: 'registration-integration-password',
      displayName: 'Registration Integration User',
      workspaceName: `Registration Integration ${Date.now()}`,
    };

    try {
      const first = await request(app.getHttpServer()).post('/api/auth/register').send(body);
      const duplicate = await request(app.getHttpServer()).post('/api/auth/register').send(body);

      expect(first.status).toBe(202);
      expect(duplicate.status).toBe(202);
      expect(duplicate.body).toEqual(first.body);
      expect(first.headers['set-cookie']).toBeUndefined();
      expect(duplicate.headers['set-cookie']).toBeUndefined();
      expect(await prisma.user.count({ where: { email: registrationEmail } })).toBe(1);
    } finally {
      const registered = await prisma.user.findUnique({
        where: { email: registrationEmail },
        include: { memberships: { select: { workspaceId: true } } },
      });
      for (const membership of registered?.memberships ?? []) {
        await prisma.workspace.delete({ where: { id: membership.workspaceId } });
      }
      await prisma.user.delete({ where: { email: registrationEmail } }).catch(() => undefined);
      await clearAuthAbuseState([registrationEmail]);
    }
  });

  it('applies the registration response floor before rejecting an invalid admitted JSON payload', async () => {
    const startedAt = Date.now();
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'not-an-email',
        password: 'too-short',
        displayName: '',
        workspaceName: '',
      })
      .expect(400);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(280);
    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'Invalid registration request',
      }),
    );
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rolls back every provisioning row when trial creation fails', async () => {
    const runId = Date.now();
    const registrationEmail = `registration-rollback-${runId}@ventureos.local`;
    const workspaceName = `Registration Rollback ${runId}`;
    const workspaceSlug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const trialPlan = await prisma.plan.findUniqueOrThrow({ where: { key: 'TRIAL' } });

    await clearAuthAbuseState([registrationEmail]);
    try {
      await prisma.plan.update({
        where: { id: trialPlan.id },
        data: { key: `TRIAL_DISABLED_${runId}` },
      });

      const response = await request(app.getHttpServer()).post('/api/auth/register').send({
        email: registrationEmail,
        password: 'registration-rollback-password',
        displayName: 'Registration Rollback User',
        workspaceName,
      });

      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Registration temporarily unavailable');
      expect(await prisma.user.count({ where: { email: registrationEmail } })).toBe(0);
      expect(await prisma.workspace.count({ where: { slug: workspaceSlug } })).toBe(0);
    } finally {
      await prisma.plan.update({ where: { id: trialPlan.id }, data: { key: 'TRIAL' } });
      await prisma.workspace.deleteMany({ where: { slug: workspaceSlug } });
      await prisma.user.deleteMany({ where: { email: registrationEmail } });
      await clearAuthAbuseState([registrationEmail]);
    }
  });

  it('atomically registers concurrent distinct emails sharing one workspace name', async () => {
    const runId = Date.now();
    const emails = [`same-slug-a-${runId}@ventureos.local`, `same-slug-b-${runId}@ventureos.local`];
    const workspaceName = `Concurrent Shared Workspace ${runId}`;
    const baseSlug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    await clearAuthAbuseState(emails);
    try {
      const startedAt = Date.now();
      const responses = await Promise.all(
        emails.map((email, index) =>
          request(app.getHttpServer())
            .post('/api/auth/register')
            .send({
              email,
              password: 'registration-concurrency-password',
              displayName: `Concurrent Founder ${index + 1}`,
              workspaceName,
            }),
        ),
      );
      const elapsedMs = Date.now() - startedAt;

      for (const response of responses) {
        expect(response.status).toBe(202);
        expect(response.body).toEqual({
          message: 'Registration request accepted. Sign in to continue.',
        });
        expect(response.headers['set-cookie']).toBeUndefined();
      }
      expect(elapsedMs).toBeGreaterThanOrEqual(env.AUTH_REGISTRATION_MIN_RESPONSE_MS);

      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        include: {
          founderProfile: true,
          memberships: {
            include: { workspace: { include: { branding: true, subscription: true } } },
          },
        },
      });
      expect(users).toHaveLength(2);
      expect(users.every((user) => user.founderProfile !== null)).toBe(true);
      expect(users.every((user) => user.memberships.length === 1)).toBe(true);

      const workspaces = users.map((user) => user.memberships[0]!.workspace);
      expect(workspaces.every((workspace) => workspace.name === workspaceName)).toBe(true);
      expect(new Set(workspaces.map((workspace) => workspace.slug)).size).toBe(2);
      expect(workspaces.some((workspace) => workspace.slug === baseSlug)).toBe(true);
      expect(
        workspaces.some((workspace) =>
          new RegExp(`^${baseSlug}-[0-9a-f]{8}$`).test(workspace.slug),
        ),
      ).toBe(true);
      expect(workspaces.every((workspace) => workspace.branding !== null)).toBe(true);
      expect(workspaces.every((workspace) => workspace.subscription !== null)).toBe(true);
    } finally {
      const registered = await prisma.user.findMany({
        where: { email: { in: emails } },
        include: { memberships: { select: { workspaceId: true } } },
      });
      const workspaceIds = [
        ...new Set(registered.flatMap((user) => user.memberships.map((item) => item.workspaceId))),
      ];
      for (const workspaceId of workspaceIds) {
        await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
      }
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      await clearAuthAbuseState(emails);
    }
  });
});
