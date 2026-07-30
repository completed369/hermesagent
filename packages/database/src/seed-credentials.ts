const KNOWN_PLACEHOLDER_PASSWORDS = new Set(['change-me-dev-only', 'change-me', 'changeme']);

export interface SeedFounderCredentials {
  email: string;
  password: string;
}

/**
 * Fixture seeding is an explicit non-production action. Never derive a fully
 * privileged founder account from repository-known fallback credentials.
 */
export function resolveSeedFounderCredentials(
  env: NodeJS.ProcessEnv = process.env,
): SeedFounderCredentials {
  if (env.NODE_ENV === 'production') {
    throw new Error('Database fixture seeding is disabled in production.');
  }

  const email = env.DEV_FOUNDER_EMAIL?.trim();
  const password = env.DEV_FOUNDER_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error(
      'DEV_FOUNDER_EMAIL and DEV_FOUNDER_PASSWORD are required for database seeding.',
    );
  }
  if (KNOWN_PLACEHOLDER_PASSWORDS.has(password.toLowerCase())) {
    throw new Error('DEV_FOUNDER_PASSWORD must not use a repository placeholder value.');
  }

  return { email, password };
}
