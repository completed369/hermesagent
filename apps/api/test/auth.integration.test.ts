import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { prisma } from '@ventureos/database';
import { hashPassword } from '@ventureos/auth';

/**
 * Requires a real, migrated, seeded PostgreSQL database reachable via
 * DATABASE_URL. Run `pnpm db:migrate && pnpm db:seed` first.
 */
describe('Auth flow (integration)', () => {
  let app: INestApplication;
  const testEmail = `it-test-${Date.now()}@ventureos.local`;
  const testPassword = 'integration-test-password';

  beforeAll(async () => {
    app = await NestFactory.create(AppModule);
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();

    const founderRole = await prisma.role.findUniqueOrThrow({ where: { key: 'FOUNDER' } });
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: 'ventureos-default' } });
    const user = await prisma.user.create({
      data: { email: testEmail, passwordHash: hashPassword(testPassword), displayName: 'Integration Test User' },
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
    const res = await request(server).post('/api/auth/login').send({ email: testEmail, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('logs in with a valid password and can then access a protected route', async () => {
    const server = app.getHttpServer();
    const loginRes = await request(server).post('/api/auth/login').send({ email: testEmail, password: testPassword });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers['set-cookie'];
    expect(cookie).toBeTruthy();

    const meRes = await request(server).get('/api/auth/me').set('Cookie', cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(testEmail);
  });
});
