/**
 * LOCAL-DEVELOPMENT ONLY utility.
 *
 * Synchronises the founder account's password hash in PostgreSQL with the
 * DEV_FOUNDER_PASSWORD value from the repository root .env, and revokes the
 * founder's existing server-side sessions. It updates EXACTLY ONE user row
 * (by DEV_FOUNDER_EMAIL) and only that user's Session rows, inside a single
 * transaction. It does not call the seed and does not touch any other data.
 *
 * This is explicitly a developer-convenience tool for rotating an exposed
 * local-dev credential. It must never run against production: the target is
 * always the locally-seeded founder account identified by DEV_FOUNDER_EMAIL.
 *
 * Security properties:
 *  - Inputs come ONLY from environment variables (never a CLI email argument).
 *  - Missing/blank env values fail fast before any database access.
 *  - No fallback password is ever used.
 *  - Neither the email nor the password is ever printed or included in an
 *    error/exception message.
 *  - Password hashing uses the canonical @ventureos/auth helper (scrypt,
 *    salt:hash hex), identical to the format produced by the seed, so the
 *    result is verifiable by the normal login path.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from '@ventureos/auth';
import { prisma as defaultPrisma } from './client.js';

export interface ResetFounderParams {
  email: string;
  password: string;
  dryRun: boolean;
  prisma: PrismaClient;
}

/**
 * Validates environment inputs for the CLI. Throws a generic error (never
 * containing the email or password value) when a required value is missing
 * or blank. Returns the resolved inputs plus the dry-run flag.
 */
export function resolveInputs(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): { email: string; password: string; dryRun: boolean } {
  // Hard runtime guard: this utility must never run against production,
  // regardless of how it is invoked (dry-run or real). Refusal happens
  // before any database access and leaks no environment values.
  if (env.NODE_ENV === 'production') {
    throw new Error('Founder credential rotation is disabled in production.');
  }
  const dryRun = argv.includes('--dry-run');
  const email = env.DEV_FOUNDER_EMAIL;
  const password = env.DEV_FOUNDER_PASSWORD;
  if (!email || !email.trim()) {
    throw new Error('DEV_FOUNDER_EMAIL is required (set it in the local .env).');
  }
  if (!password || !password.trim()) {
    throw new Error('DEV_FOUNDER_PASSWORD is required (set it in the local .env).');
  }
  return { email, password, dryRun };
}

/**
 * Core, testable rotation logic. Finds exactly one founder user by email,
 * then (unless dry-run) recomputes the password hash and updates only that
 * user's passwordHash while deleting only that user's Session rows, all in a
 * single transaction. Never prints or returns the password.
 */
export async function resetFounderPassword(params: ResetFounderParams): Promise<void> {
  // Defense in depth: refuse production even if called directly (e.g. in a
  // unit test) rather than through run(). Leaks no env values.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Founder credential rotation is disabled in production.');
  }

  const { email, password, dryRun, prisma } = params;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error('Founder user not found for the configured DEV_FOUNDER_EMAIL.');
  }

  if (dryRun) {
    // Connection and existence are confirmed; perform no mutation.
    return;
  }

  const passwordHash = hashPassword(password);
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    await tx.session.deleteMany({
      where: { userId: user.id },
    });
  });
}

/** Runs the utility end-to-end using the real Prisma client. */
export async function run(
  prisma: PrismaClient = defaultPrisma,
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const { email, password, dryRun } = resolveInputs(argv, env);
  await resetFounderPassword({ email, password, dryRun, prisma });
}

if (require.main === module) {
  run()
    .then(() => {
      const dryRun = process.argv.includes('--dry-run');
      console.log(
        dryRun
          ? 'Founder credential rotation dry-run passed.'
          : 'Founder credential updated and existing sessions revoked.',
      );
      process.exit(0);
    })
    .catch((err: unknown) => {
      // Generic failure; never reveal the email or password value.
      console.error('[reset-founder-password] rotation failed; see above if applicable.');
      process.exitCode = 1;
    });
}
