import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaConfig } from 'prisma';
import { env } from 'prisma/config';

export default {
  experimental: {
    adapter: true,
  },
  engine: 'js',
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
  async adapter() {
    return new PrismaPg({ connectionString: env('DATABASE_URL') });
  },
} satisfies PrismaConfig;
