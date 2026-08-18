import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __ventureosPrisma: PrismaClient | undefined;
}

let localPrisma: PrismaClient | undefined = globalThis.__ventureosPrisma;

const getPrismaClient = (): PrismaClient => {
  if (localPrisma) {
    return localPrisma;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to initialize Prisma');
  }

  localPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  if (process.env.NODE_ENV !== 'production') {
    globalThis.__ventureosPrisma = localPrisma;
  }

  return localPrisma;
};

/**
 * Lazily initialized singleton Prisma client. Pure imports remain side-effect free,
 * while the first database operation still fails closed when DATABASE_URL is absent.
 * The real client is reused across hot reloads in development.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
