import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __ventureosPrisma: PrismaClient | undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Prisma');
}

const createPrismaClient = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

/**
 * Singleton Prisma client. Reused across hot reloads in dev to avoid
 * exhausting Postgres connections.
 */
export const prisma: PrismaClient = globalThis.__ventureosPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__ventureosPrisma = prisma;
}
