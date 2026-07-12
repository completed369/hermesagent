import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __ventureosPrisma: PrismaClient | undefined;
}

/**
 * Singleton Prisma client. Reused across hot reloads in dev to avoid
 * exhausting Postgres connections.
 */
export const prisma: PrismaClient =
  globalThis.__ventureosPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__ventureosPrisma = prisma;
}
