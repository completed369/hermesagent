import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const target = resolve(process.argv[2] ?? '.staging/phase15.env');
const force = process.argv.includes('--force');
if (existsSync(target) && !force) {
  console.log(`Synthetic staging environment already exists: ${target}`);
  process.exit(0);
}

const randomHex = (bytes = 32) => randomBytes(bytes).toString('hex');
const founderEmail = 'phase15-founder@ventureos.invalid';
const founderPassword = `V15-${randomHex(24)}`;
const postgresPassword = randomHex();
const authSecret = randomHex(48);
const authAbuseSecret = randomHex(48);
const lines = [
  'COMPOSE_PROJECT_NAME=ventureos-phase15',
  'STAGING_POSTGRES_USER=ventureos_phase15',
  `STAGING_POSTGRES_PASSWORD=${postgresPassword}`,
  'STAGING_POSTGRES_DB=ventureos_phase15',
  `STAGING_AUTH_SECRET=${authSecret}`,
  `STAGING_AUTH_ABUSE_DIGEST_SECRET=${authAbuseSecret}`,
  `STAGING_FOUNDER_EMAIL=${founderEmail}`,
  `STAGING_FOUNDER_PASSWORD=${founderPassword}`,
  `STAGING_MINIO_USER=v15${randomHex(8)}`,
  `STAGING_MINIO_PASSWORD=${randomHex()}`,
  `DEV_FOUNDER_EMAIL=${founderEmail}`,
  `DEV_FOUNDER_PASSWORD=${founderPassword}`,

  `AUTH_SECRET=${authSecret}`,
  `AUTH_ABUSE_DIGEST_SECRET=${authAbuseSecret}`,
  'AI_PROVIDER=mock',
  'STORAGE_PROVIDER=mock',
  'MARKETPLACE_ETSY_MODE=mock',
  'FEATURE_LIVE_PUBLISHING_ENABLED=false',
  'FEATURE_STORAGE_UPLOADS_ENABLED=false',
  'FEATURE_ADVERTISING_ENABLED=false',
  'FEATURE_PAID_INTEGRATIONS_ENABLED=false',
  'E2E_BASE_URL=http://localhost:3000',
  'E2E_EXTERNAL_SERVERS=true',
  '',
];

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
try {
  chmodSync(target, 0o600);
} catch {
  // Windows ACLs, rather than POSIX modes, protect this disposable local file.
}
console.log(`Generated synthetic staging environment: ${target}`);
