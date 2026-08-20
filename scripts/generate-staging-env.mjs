import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const repositoryRoot = resolve(import.meta.dirname, '..');
const stagingRoot = join(repositoryRoot, '.staging');
let targetArgument = '.staging/phase15.env';
let targetWasProvided = false;
let force = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--force' && !force) {
    force = true;
    continue;
  }
  if (argument === '--target' && !targetWasProvided) {
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('--target requires a repository-local .staging environment file');
    }
    targetArgument = value;
    targetWasProvided = true;
    index += 1;
    continue;
  }
  throw new Error(
    'generate-staging-env accepts only --target <path> and the optional --force flag',
  );
}

const candidateTarget = resolve(repositoryRoot, targetArgument);
const targetRelative = relative(stagingRoot, candidateTarget);
const targetName = basename(candidateTarget);
if (
  !targetRelative ||
  isAbsolute(targetRelative) ||
  targetRelative.startsWith('..') ||
  dirname(targetRelative) !== '.' ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]*\.env$/.test(targetName)
) {
  throw new Error(
    'staging environment target must be a direct .env file inside repository .staging',
  );
}
const target = join(stagingRoot, targetName);

mkdirSync(stagingRoot, { recursive: true });
const stagingRootMetadata = lstatSync(stagingRoot);
if (!stagingRootMetadata.isDirectory() || stagingRootMetadata.isSymbolicLink()) {
  throw new Error('repository .staging must be a real directory');
}
if (existsSync(target)) {
  const targetMetadata = lstatSync(target);
  if (!targetMetadata.isFile() || targetMetadata.isSymbolicLink()) {
    throw new Error('staging environment target must be a regular file');
  }
}
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

writeFileSync(target, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
try {
  chmodSync(target, 0o600);
} catch {
  // Windows ACLs, rather than POSIX modes, protect this disposable local file.
}
console.log(`Generated synthetic staging environment: ${target}`);
