import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { prisma } from '@ventureos/database';
import { hashPassword, hashSessionToken } from '@ventureos/auth';
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
});
