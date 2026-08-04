import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('staging image and topology contracts are fail-closed', () => {
  const dockerfile = read('Dockerfile.staging');
  const compose = read('docker-compose.staging.yml');
  const dockerignore = read('.dockerignore');
  const nextConfig = read('apps/web/next.config.mjs');
  const gate = read('scripts/staging-security-gate.sh');
  const ingressProxy = read('scripts/staging-ingress-proxy.mjs');
  const imageScan = read('scripts/verify-staging-images.sh');
  const ci = read('.github/workflows/ci.yml');
  const turbo = JSON.parse(read('turbo.json'));

  const service = (name) => {
    const marker = `  ${name}:\n`;
    const start = compose.indexOf(marker);
    assert.notEqual(start, -1, `missing ${name} service`);
    const tail = compose.slice(start + marker.length);
    const next = tail.search(/^  [a-z][a-z0-9-]*:\n/m);
    return next === -1 ? tail : tail.slice(0, next);
  };

  for (const target of ['AS api', 'AS worker', 'AS web', 'AS tools', 'AS ingress']) {
    assert.match(dockerfile, new RegExp(target));
  }
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /USER node/g);
  assert.match(dockerfile, /dist\/main\.js/);
  assert.match(dockerfile, /dist\/index\.js/);
  assert.match(dockerfile, /apps\/web\/server\.js/);
  assert.match(dockerfile, /VENTUREOS_STANDALONE_BUILD=true/);
  assert.match(nextConfig, /VENTUREOS_STANDALONE_BUILD === 'true'/);
  assert.ok(turbo.tasks.build.env.includes('VENTUREOS_STANDALONE_BUILD'));
  assert.match(nextConfig, /output: 'standalone'/);
  assert.match(nextConfig, /fileURLToPath\(new URL\('\.\.\/\.\.'\, import\.meta\.url\)\)/);

  assert.match(dockerignore, /^\.git$/m);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /tsbuildinfo/);
  assert.doesNotMatch(compose, /change-me|replace-with|not-a-real-secret/i);
  assert.match(compose, /staging-private:\s+internal: true/);
  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /127\.0\.0\.1:3001:3001/);
  for (const name of ['api', 'web']) {
    assert.doesNotMatch(service(name), /ports:/);
    assert.match(service(name), /networks: \[staging-private\]/);
    assert.doesNotMatch(service(name), /staging-ingress/);
  }
  for (const name of ['api-ingress', 'web-ingress']) {
    assert.match(
      service(name),
      /image: \$\{COMPOSE_PROJECT_NAME:-ventureos-phase15\}-ingress:local/,
    );
    assert.match(service(name), /read_only: true/);
    assert.match(service(name), /cap_drop: \[ALL\]/);
    assert.match(service(name), /networks: \[staging-private, staging-ingress\]/);
  }
  assert.match(compose, /API_INTERNAL_BASE_URL: http:\/\/api:3001/);
  assert.doesNotMatch(compose, /55432:5432/);
  assert.match(compose, /\.\/apps\/api\/test:\/workspace\/apps\/api\/test:ro/);
  assert.match(compose, /STORAGE_PROVIDER: mock/);
  assert.match(compose, /AI_PROVIDER: mock/);
  assert.match(compose, /MARKETPLACE_ETSY_MODE: mock/);
  assert.match(compose, /DEPLOYMENT_ENVIRONMENT: development/);
  assert.doesNotMatch(compose, /DEPLOYMENT_ENVIRONMENT: staging/);
  assert.match(compose, /FEATURE_LIVE_PUBLISHING_ENABLED: 'false'/);
  assert.match(compose, /read_only: true/g);
  assert.match(compose, /cap_drop: \[ALL\]/g);
  assert.match(
    gate,
    /if compose down --volumes --remove-orphans --timeout 30; then\s+rm -f "\$ENV_FILE"/,
  );
  assert.match(gate, /retaining \$ENV_FILE for recovery/);
  assert.match(gate, /trap 'finalize \$\?' EXIT/);
  assert.doesNotMatch(gate, /compose down --volumes --remove-orphans --timeout 30 \|\| true/);
  assert.match(gate, /External network egress is available to the API container/);
  assert.match(gate, /https:\/\/example\.com/);
  assert.match(ingressProxy, /new Map\(\[\s*\['api', 3001\],\s*\['web', 3000\],?\s*\]\)/);
  assert.doesNotMatch(ingressProxy, /UPSTREAM_HOST|UPSTREAM_PORT/);
  assert.match(imageScan, /ingress_image/);
  assert.match(
    ci,
    /if ! test -f \.staging\/phase15\.env; then\s+node scripts\/generate-staging-env\.mjs/,
  );
});

test('the immutable migration chain contains exactly eleven migrations', () => {
  const migrations = readdirSync(resolve(root, 'packages/database/prisma/migrations'), {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory());
  assert.equal(migrations.length, 11);
});
