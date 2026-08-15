import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const dockerStage = (dockerfile, name) => {
  const marker = new RegExp(`^FROM [^\n]+ AS ${name}\n`, 'm');
  const match = marker.exec(dockerfile);
  assert.ok(match, `missing ${name} Docker stage`);
  const tail = dockerfile.slice(match.index + match[0].length);
  const next = tail.search(/^FROM /m);
  return next === -1 ? tail : tail.slice(0, next);
};

const ci = read('.github/workflows/ci.yml');
const compose = read('docker-compose.staging.yml');
const apiDockerfile = read('apps/api/Dockerfile');
const webDockerfile = read('apps/web/Dockerfile');
const workerDockerfile = read('apps/worker/Dockerfile');
const toolsDockerfile = read('packages/database/Dockerfile.tools');
const ingressDockerfile = read('deploy/private-staging/ingress/Dockerfile');
const ingressProxy = read('deploy/private-staging/ingress/proxy.mjs');
const imageScan = read('scripts/staging-image-scan.sh');
const gate = read('scripts/staging-security-gate.sh');

const expectedMigrationChain = [
  '20260713064032_init',
  '20260713140054_phase2_opportunity_evidence',
  '20260713162750_phase3_board_and_approvalphase3_board_and_approvalpp',
  '20260713173019_phase4_product_and_listing',
  '20260713215625_phase5_research_connectors',
  '20260714051039_phase6_marketplace_pilot',
  '20260714065131_phase6_marketplace_pilot',
  '20260714091408_phase7_finance_and_analytics',
  '20260714132415_phase8_multi_venture_and_saas',
  '20260730151000_hash_session_tokens',
  '20260801033000_auth_abuse_hardening',
  '20260814090000_agent_memory',
  '20260815123000_commercial_observation_provenance',
];

// Fail closed if an application runtime image or source shape drifts from the
// reviewed production-like staging contract.
test('staging image and topology contracts are fail-closed', () => {
  const apiRuntime = dockerStage(apiDockerfile, 'runtime');
  const webRuntime = dockerStage(webDockerfile, 'runtime');
  const workerRuntime = dockerStage(workerDockerfile, 'runtime');
  const toolsRuntime = dockerStage(toolsDockerfile, 'runtime');
  const ingressRuntime = dockerStage(ingressDockerfile, 'runtime');

  assert.match(apiRuntime, /gcr\.io\/distroless\/nodejs24-debian12@sha256:/);
  assert.match(webRuntime, /gcr\.io\/distroless\/nodejs24-debian12@sha256:/);
  assert.match(workerRuntime, /gcr\.io\/distroless\/nodejs24-debian12@sha256:/);
  assert.match(toolsRuntime, /node:24-bookworm-slim@sha256:/);
  assert.match(ingressRuntime, /gcr\.io\/distroless\/nodejs24-debian12@sha256:/);
  assert.match(apiRuntime, /USER nonroot/);
  assert.match(webRuntime, /USER nonroot/);
  assert.match(workerRuntime, /USER nonroot/);
  assert.match(toolsRuntime, /USER nonroot/);
  assert.match(ingressRuntime, /USER nonroot/);
  assert.match(apiRuntime, /COPY --from=build --chown=nonroot:nonroot/);
  assert.match(webRuntime, /COPY --from=build --chown=nonroot:nonroot/);
  assert.match(workerRuntime, /COPY --from=build --chown=nonroot:nonroot/);
  assert.match(toolsRuntime, /COPY --from=build --chown=nonroot:nonroot/);
  assert.match(ingressRuntime, /COPY --from=build --chown=nonroot:nonroot/);
  assert.match(apiRuntime, /CMD \["apps\/api\/dist\/main\.js"\]/);
  assert.match(webRuntime, /CMD \["apps\/web\/server\.js"\]/);
  assert.match(workerRuntime, /CMD \["apps\/worker\/dist\/index\.js"\]/);
  assert.match(toolsRuntime, /ENTRYPOINT \["\/usr\/local\/bin\/docker-entrypoint\.sh"\]/);
  assert.match(ingressRuntime, /CMD \["\/app\/proxy\.mjs"\]/);

  assert.match(compose, /read_only: true/g);
  assert.match(compose, /cap_drop:\s+\n\s+- ALL/g);
  assert.match(compose, /security_opt:\s+\n\s+- no-new-privileges:true/g);
  assert.doesNotMatch(compose, /network_mode:\s*host/);
  assert.doesNotMatch(compose, /privileged:\s*true/);
  assert.doesNotMatch(compose, /\/var\/run\/docker\.sock/);
  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.match(compose, /ventureos-internal:/);
  assert.match(compose, /internal:\s*true/);
  assert.match(compose, /ventureos-egress:/);
  assert.match(compose, /ventureos-edge:/);
  assert.match(compose, /api-ingress:/);
  assert.match(compose, /web-ingress:/);
  assert.match(compose, /private-tunnel:/);
  assert.match(compose, /ventureos-api@sha256:/);
  assert.match(compose, /ventureos-web@sha256:/);
  assert.match(compose, /ventureos-worker@sha256:/);
  assert.match(compose, /ventureos-tools@sha256:/);
  assert.match(compose, /ventureos-ingress@sha256:/);
  assert.match(compose, /postgres:16-alpine@sha256:/);
  assert.match(compose, /temporalio\/server:1\.24\.2@sha256:/);
  assert.match(compose, /cloudflare\/cloudflared:2026\.7\.0@sha256:/);
  assert.match(compose, /deploy:\s+resources:\s+limits:/s);

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

test('the immutable migration chain matches the reviewed sequence', () => {
  const migrations = readdirSync(resolve(root, 'packages/database/prisma/migrations'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(migrations, expectedMigrationChain);
});

test('the API egress probe uses distroless Node and remains fail-closed', () => {
  const probe = gate.match(
    /if compose exec -T api [^\n]+https:\/\/example\.com[^\n]+; then\n([\s\S]*?)\n  fi/,
  );

  assert.ok(probe, 'staging gate must contain the API external-egress probe');
  assert.match(probe[0], /compose exec -T api \/nodejs\/bin\/node -e/);
  assert.doesNotMatch(probe[0], /compose exec -T api node -e/);
  assert.match(probe[0], /then\(\(\)=>process\.exit\(0\)\)/);
  assert.match(probe[1], /External network egress is available to the API container/);
  assert.match(probe[1], /return 1/);
});

test('the API integration timeout is explicit, bounded, and isolated from unit tests', () => {
  const apiPackage = JSON.parse(read('apps/api/package.json'));
  assert.match(apiPackage.scripts['test:integration'], /vitest run --config vitest\.integration\.config\.ts/);
  assert.match(read('apps/api/vitest.integration.config.ts'), /testTimeout:\s*30_000/);
  assert.match(read('apps/api/vitest.integration.config.ts'), /hookTimeout:\s*30_000/);
  assert.doesNotMatch(apiPackage.scripts['test:unit'], /integration/);
});

test('subscription-provider teardown uses bounded bulk cleanup without a hook timeout', () => {
  const testSource = read('apps/api/test/subscription-provider.integration.spec.ts');
  assert.match(testSource, /deleteMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*\[workspaceA\.id, workspaceB\.id\]/s);
  assert.doesNotMatch(testSource, /afterAll\([^,]+,\s*\d+\s*\)/s);
});

test('type-only runtime pruning is target-specific and fail-closed', () => {
  const script = read('scripts/prune-type-only-runtime-deps.mjs');
  assert.match(script, /const expectedPackagesByTarget/);
  assert.match(script, /api:\s*new Set/);
  assert.match(script, /worker:\s*new Set/);
  assert.match(script, /web:\s*new Set/);
  assert.match(script, /throw new Error\(`Unexpected type-only runtime package/);
});

test('generated Scarf compile-cache pruning is API-only, narrow, and fail-closed', () => {
  const script = read('scripts/prune-generated-scarf-runtime-deps.mjs');
  assert.match(script, /const allowedTarget = 'api'/);
  assert.match(script, /throw new Error\(`Unexpected target/);
  assert.match(script, /node_modules\/\.cache\/scarf/);
});
