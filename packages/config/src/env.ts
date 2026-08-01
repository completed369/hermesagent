import { z } from 'zod';

/**
 * `z.coerce.boolean()` is just `Boolean(value)` under the hood, and
 * `Boolean("false")` is `true` in JavaScript -- any non-empty string coerces
 * to `true`. That silently broke `MINIO_USE_SSL=false` (client opened a TLS
 * handshake against MinIO's plain HTTP port). This helper actually parses
 * the string instead of relying on JS truthiness.
 */
function zBoolean(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v.trim().toLowerCase() === 'true'));
}

/**
 * Deterministic environment schema shared by apps/api and apps/worker.
 * Every variable consumed by backend code MUST be declared here.
 * Fail fast (fail closed) on startup if required variables are missing or malformed.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('VentureOS'),
  APP_BASE_CURRENCY: z.string().default('EUR'),
  APP_DEFAULT_LOCALE: z.string().default('en'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(3001),
  API_CORS_ORIGIN: z.string().default('http://localhost:3000'),
  API_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  AUTH_ABUSE_DIGEST_SECRET: z
    .string()
    .min(32, 'AUTH_ABUSE_DIGEST_SECRET must be at least 32 characters')
    .optional(),
  AUTH_REGISTRATION_MIN_RESPONSE_MS: z.coerce.number().int().min(50).max(2000).default(300),
  AUTH_SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(604800),
  AUTH_COOKIE_NAME: z.string().default('ventureos_session'),
  DEV_LOGIN_ENABLED: zBoolean(true),
  DEV_FOUNDER_EMAIL: z.string().email().optional(),
  DEV_FOUNDER_PASSWORD: z.string().optional(),

  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('ventureos-dev'),
  TEMPORAL_TASK_QUEUE: z.string().default('ventureos-main'),

  STORAGE_PROVIDER: z.enum(['minio', 's3']).default('minio'),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ROOT_USER: z.string().default('ventureos'),
  MINIO_ROOT_PASSWORD: z.string().default('change-me-dev-only'),
  MINIO_BUCKET: z.string().default('ventureos-dev'),
  MINIO_USE_SSL: zBoolean(false),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  STORAGE_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(25),

  AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  AI_PER_AGENT_TOKEN_LIMIT: z.coerce.number().int().positive().default(8000),
  AI_PER_AGENT_COST_LIMIT_EUR: z.coerce.number().positive().default(0.5),
  AI_PER_WORKFLOW_COST_LIMIT_EUR: z.coerce.number().positive().default(3),
  AI_PER_DAY_COST_LIMIT_EUR: z.coerce.number().positive().default(10),
  AI_PER_WORKSPACE_MONTHLY_LIMIT_EUR: z.coerce.number().positive().default(100),
  ANTHROPIC_API_KEY: z.string().optional(),

  MARKETPLACE_ETSY_MODE: z.enum(['mock', 'live']).default('mock'),

  FEATURE_LIVE_PUBLISHING_ENABLED: zBoolean(false),
  FEATURE_ADVERTISING_ENABLED: zBoolean(false),
  FEATURE_PAID_INTEGRATIONS_ENABLED: zBoolean(false),
  GOVERNANCE_BOARD_APPROVAL_THRESHOLD: z.coerce.number().min(0).max(100).default(75),
  GOVERNANCE_EVIDENCE_QUALITY_MINIMUM: z.coerce.number().min(0).max(100).default(70),

  OTEL_ENABLED: zBoolean(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Parses and validates process.env. Throws (fails closed) on the first call
 * if configuration is invalid, rather than allowing the app to boot in an
 * unsafe or undefined state.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}

/** Test-only helper to reset the memoized env between test cases. */
export function __resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
