/**
 * VentureOS Phase 1 seed script.
 * Creates: founder user, founder role + permissions, founder workspace,
 * workspace membership, founder profile, and mock/disconnected integration
 * records (MinIO, Etsy mock, AI mock). Idempotent: safe to re-run.
 *
 * Run with: pnpm db:seed  (requires DATABASE_URL pointing at a real Postgres
 * instance and prior `pnpm db:generate` + `pnpm db:migrate:dev`.)
 */
import { scryptSync, randomBytes } from 'node:crypto';
import { prisma } from './client';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

const PERMISSIONS = [
  { key: 'workspace:manage', description: 'Manage workspace settings' },
  { key: 'approval:decide', description: 'Approve, reject or revise approval requests' },
  { key: 'approval:view', description: 'View approval requests' },
  { key: 'audit:view', description: 'View audit and security events' },
  { key: 'product:publish', description: 'Approve product/listing publication' },
  { key: 'integration:manage', description: 'Connect/disconnect integrations' },
  { key: 'workflow:view', description: 'View workflow runs' },
];

async function main() {
  console.log('[seed] starting VentureOS Phase 1 seed...');

  // --- Permissions (idempotent upsert) ---
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description },
      create: { key: perm.key, description: perm.description },
    });
  }

  // --- Founder role with all permissions ---
  const founderRole = await prisma.role.upsert({
    where: { key: 'FOUNDER' },
    update: {},
    create: { key: 'FOUNDER', name: 'Founder', description: 'Full authority workspace owner' },
  });

  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: founderRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: founderRole.id, permissionId: perm.id },
    });
  }

  await prisma.role.upsert({
    where: { key: 'VIEWER' },
    update: {},
    create: { key: 'VIEWER', name: 'Viewer', description: 'Read-only access' },
  });

  // --- Founder user (from env, never hardcoded real credentials) ---
  const founderEmail = process.env.DEV_FOUNDER_EMAIL ?? 'founder@ventureos.local';
  const founderPassword = process.env.DEV_FOUNDER_PASSWORD ?? 'change-me-dev-only';

  const founderUser = await prisma.user.upsert({
    where: { email: founderEmail },
    update: {},
    create: {
      email: founderEmail,
      passwordHash: hashPassword(founderPassword),
      displayName: 'Yiannis',
      isFounder: true,
    },
  });

  await prisma.founderProfile.upsert({
    where: { userId: founderUser.id },
    update: {},
    create: { userId: founderUser.id },
  });

  // --- Founder workspace ---
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'ventureos-default' },
    update: {},
    create: {
      name: 'VentureOS',
      slug: 'ventureos-default',
      mode: 'SINGLE_FOUNDER',
      baseCurrency: 'EUR',
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: founderUser.id } },
    update: { roleId: founderRole.id },
    create: { workspaceId: workspace.id, userId: founderUser.id, roleId: founderRole.id },
  });

  // --- Development integration records (all mock / disconnected by default) ---
  const integrations: Array<{ provider: string; mode: string }> = [
    { provider: 'minio', mode: 'READ_ONLY' },
    { provider: 'etsy', mode: 'MOCK' },
    { provider: 'ai-mock', mode: 'MOCK' },
  ];
  for (const integ of integrations) {
    await prisma.integration.upsert({
      where: { workspaceId_provider: { workspaceId: workspace.id, provider: integ.provider } },
      update: {},
      create: {
        workspaceId: workspace.id,
        provider: integ.provider,
        mode: integ.mode,
        writeEnabled: false,
        status: 'DISCONNECTED',
      },
    });
  }

  console.log('[seed] done.');
  console.log(`[seed] founder login: ${founderEmail} / (password from DEV_FOUNDER_PASSWORD env var)`);
  console.log(`[seed] workspace: ${workspace.name} (${workspace.slug})`);
}

main()
  .catch((err) => {
    console.error('[seed] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
