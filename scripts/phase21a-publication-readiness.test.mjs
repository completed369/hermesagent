import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const imagePattern = /^\s*image:\s+([^\s#]+)/gm;

const serviceBlock = (compose, name) => {
  const marker = `  ${name}:\n`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name} service`);
  const tail = compose.slice(start + marker.length);
  const next = tail.search(/^  [a-z][a-z0-9-]*:\n/m);
  return next === -1 ? tail : tail.slice(0, next);
};

test('publication workflow is disabled by default and enforces explicit founder authorization', () => {
  const workflow = read('.github/workflows/publish-images.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /vars\.VENTUREOS_IMAGE_PUBLICATION_ENABLED == 'true'/);
  assert.match(workflow, /PUBLISH-IMMUTABLE-IMAGES/);
  assert.match(workflow, /environment: image-publication/);
  assert.match(workflow, /publish_authorized/);
});

test('publication workflow binds all evidence and publication to one exact reviewed source SHA', () => {
  const workflow = read('.github/workflows/publish-images.yml');
  assert.match(workflow, /VENTUREOS_APPROVED_PUBLICATION_SHA/);
  assert.match(workflow, /VENTUREOS_APPROVED_PUBLICATION_REF/);
  assert.match(workflow, /test "\$CURRENT_REF" = "\$EXPECTED_SOURCE_REF"/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /platforms: linux\/amd64/);
  assert.match(workflow, /sha-\$\{SOURCE_SHA\}/);
  assert.doesNotMatch(workflow, /:latest\b/);
});

test('publication workflow gates and records all five images', () => {
  const workflow = read('.github/workflows/publish-images.yml');
  for (const image of ['api', 'web', 'worker', 'tools', 'ingress']) {
    assert.match(workflow, new RegExp(`image: ${image}\\b`));
  }
  assert.match(workflow, /scanners: secret,misconfig/);
  assert.match(workflow, /--scanners vuln,secret/);
  assert.match(workflow, /format: spdx-json/);
  assert.match(workflow, /cosign sign --yes/);
  assert.match(workflow, /GitHub build-provenance attestation/);
  assert.match(workflow, /GitHub SBOM attestation/);
  assert.match(workflow, /Require exactly five unique digest-pinned images/);
  assert.match(workflow, /docker push "\$ref" 2>&1 \| tee \/tmp\/docker-push\.log/);
  assert.match(workflow, /VulnerabilityDB\.UpdatedAt/);
  assert.match(workflow, /known_exploited_vulnerabilities\.json/);
  assert.match(workflow, /comm -12/);
  assert.match(workflow, /validate-image-manifest\.mjs/);

  for (const line of workflow.split('\n').filter((entry) => /^\s*-?\s*uses:/.test(entry))) {
    assert.match(line, /@[0-9a-f]{40}(?:\s+#.*)?$/, `action must be pinned by commit: ${line}`);
  }
});

test('all staging Docker targets use immutable bases and the minimized tools runtime', () => {
  const dockerfile = read('Dockerfile.staging');
  const fromLines = dockerfile.split('\n').filter((line) => line.startsWith('FROM '));
  assert.ok(fromLines.length >= 6);
  const definedStages = new Set();
  for (const line of fromLines) {
    const match = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/);
    assert.ok(match, `invalid FROM instruction: ${line}`);
    const [, source, alias] = match;
    if (!definedStages.has(source)) {
      assert.match(source, /@sha256:[0-9a-f]{64}$/, `external base must be pinned: ${line}`);
    }
    if (alias) definedStages.add(alias);
  }
  assert.doesNotMatch(dockerfile, /FROM builder AS tools/);
  assert.match(dockerfile, /deploy --prod \/runtime\/tools/);
  assert.match(dockerfile, /runtime-secret-entrypoint\.mjs/);
  assert.match(
    dockerfile,
    /ENTRYPOINT \["\/nodejs\/bin\/node", "\/usr\/local\/bin\/runtime-secret-entrypoint\.mjs"/,
  );

  const scan = read('scripts/verify-staging-images.sh');
  assert.match(scan, /tools_image/);
  assert.match(scan, /check_common "\$tools_image"/);
  assert.match(scan, /check_common "\$ingress_image"/);
});

test('publication runtimes exclude the vulnerable build toolchain and scan-only Temporal sources', () => {
  const dockerfile = read('Dockerfile.staging');

  for (const target of ['api', 'worker', 'web', 'ingress']) {
    assert.match(dockerfile, new RegExp(`FROM runtime AS ${target}\\b`));
  }
  assert.match(dockerfile, /FROM runtime AS tools\b/);
  assert.match(dockerfile, /ENV PRISMA_CLI_BINARY_TARGETS=linux-static-x64/);
  assert.match(dockerfile, /PRISMA_SCHEMA_ENGINE_BINARY=\/app\/prisma-schema-engine/);
  assert.match(dockerfile, /schema-engine-linux-static-x64/);
  assert.match(dockerfile, /FROM node:22-trixie-slim@sha256:[0-9a-f]{64} AS runtime-node/);
  assert.match(
    dockerfile,
    /FROM gcr\.io\/distroless\/base-nossl-debian13@sha256:[0-9a-f]{64} AS runtime/,
  );
  assert.match(dockerfile, /COPY --from=runtime-node \/usr\/local\/bin\/node \/nodejs\/bin\/node/);
  assert.doesNotMatch(dockerfile, /distroless\/nodejs22-debian13/);
  assert.match(dockerfile, /@temporalio\+core-bridge@\*\/node_modules\/@temporalio\/core-bridge/);
  assert.match(dockerfile, /rm -rf "\$core_bridge\/sdk-core" "\$core_bridge\/bridge-macros"/);
  assert.match(dockerfile, /"\$core_bridge\/Cargo\.lock" "\$core_bridge\/Cargo\.toml"/);

  const scan = read('scripts/verify-staging-images.sh');
  assert.doesNotMatch(scan, /docker run --rm --entrypoint sh/);
  assert.match(scan, /docker export/);
  assert.match(scan, /verify-image-rootfs\.py/);
  assert.match(scan, /STAGING_IMAGE_CONTENT_SCAN_PASS/);

  const rootfsScan = read('scripts/verify-image-rootfs.py');
  for (const prohibited of ['sdk-core', 'bridge-macros', 'Cargo.lock', 'Cargo.toml']) {
    assert.match(rootfsScan, new RegExp(`"${prohibited.replace('.', '\\.')}"`));
  }
  assert.match(rootfsScan, /SECRET_PATTERN/);
  assert.match(rootfsScan, /is_third_party_pnpm_content/);
  assert.match(rootfsScan, /DEVELOPMENT_ONLY_PACKAGES/);
});

test('every third-party build and Compose runtime image is locked by digest', () => {
  const lock = JSON.parse(read('deploy/private-staging/third-party-images.lock.json'));
  for (const image of Object.values(lock.images)) {
    assert.match(image, /@sha256:[0-9a-f]{64}$/);
  }

  for (const path of ['docker-compose.yml', 'docker-compose.staging.yml']) {
    const imageLines = read(path)
      .split('\n')
      .filter((line) => /^\s*image:/.test(line));
    for (const line of imageLines) {
      if (!line.includes('${COMPOSE_PROJECT_NAME')) {
        assert.match(line, /@sha256:[0-9a-f]{64}$/);
      }
    }
  }

  const ciServiceImages = read('.github/workflows/ci.yml')
    .split('\n')
    .filter((line) => /^\s*image:/.test(line));
  assert.ok(ciServiceImages.length > 0);
  for (const line of ciServiceImages) {
    assert.match(line, /@sha256:[0-9a-f]{64}$/);
  }
});

test('private-staging deployment template is digest-only, private, and resource bounded', () => {
  const compose = read('deploy/private-staging/docker-compose.yml');
  const images = [...compose.matchAll(imagePattern)].map((match) => match[1]);
  assert.ok(images.length >= 9);
  for (const image of images) {
    assert.match(image, /@(?:\$\{[A-Z0-9_]+_DIGEST:\?|sha256:[0-9a-f]{64})/);
  }
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.doesNotMatch(compose, /^\s+ports:/m);
  assert.doesNotMatch(compose, /tmpfs: \[[^\]\n]+,\s+mode=/);
  assert.doesNotMatch(compose, /temporalio\/auto-setup/);
  assert.match(compose, /entrypoint: \[\/bin\/sh, \/opt\/ventureos\/bin\/temporal-schema\.sh\]/);
  assert.match(
    compose,
    /entrypoint: \[\/bin\/sh, \/opt\/ventureos\/bin\/temporal-entrypoint\.sh\]/,
  );
  assert.match(compose, /STAGING_API_ORIGIN:\?stable HTTPS origin required/);
  assert.match(compose, /STAGING_WEB_ORIGIN:\?stable HTTPS origin required/);
  assert.match(compose, /WORKER_MAX_CONCURRENT_ACTIVITIES: ['"]4['"]/);
  assert.match(compose, /TEMPORAL_SCHEMA_MODE: initialize/);
  assert.match(compose, /TEMPORAL_SCHEMA_MODE: upgrade/);
  assert.match(compose, /VENTUREOS_REQUIRED_DATABASE_ROLE: ventureos_owner/);

  for (const name of [
    'postgres',
    'temporal',
    'api',
    'worker',
    'web',
    'api-ingress',
    'web-ingress',
    'private-tunnel',
  ]) {
    const service = serviceBlock(compose, name);
    assert.match(service, /mem_limit:/, `${name} must have memory limit`);
    assert.match(service, /cpus:/, `${name} must have CPU limit`);
    assert.match(service, /pids_limit:/, `${name} must have PID limit`);
    assert.match(service, /logging:/, `${name} must rotate logs`);
  }
  assert.match(compose, /max-size: 20m/);
  assert.match(compose, /max-file: ['"]5['"]/);
  assert.match(compose, /DATABASE_URL_FILE: \/run\/secrets\//);
  assert.match(compose, /AUTH_SECRET_FILE: \/run\/secrets\//);
  for (const name of ['api-ingress', 'web-ingress']) {
    const service = serviceBlock(compose, name);
    assert.match(service, /healthcheck:/);
    assert.match(service, /\/nodejs\/bin\/node/);
    assert.doesNotMatch(service, /^\s+node,?$/m);
  }
});

test('PostgreSQL templates keep bootstrap, owner, runtime, migration, Temporal, and backup privileges separate', () => {
  const roles = read('deploy/private-staging/postgres/10-roles.sql');
  const privileges = read('deploy/private-staging/postgres/20-privileges.sql');
  for (const role of [
    'ventureos_bootstrap',
    'ventureos_owner',
    'ventureos_app',
    'ventureos_migrator',
    'ventureos_temporal',
    'ventureos_backup',
  ]) {
    assert.match(roles, new RegExp(`\\b${role}\\b`));
  }
  assert.match(roles, /ventureos_owner NOLOGIN/);
  assert.match(roles, /ventureos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(roles, /ventureos_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(roles, /ventureos_temporal LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(roles, /ventureos_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.doesNotMatch(roles, /PASSWORD\s+'[^']+'/i);
  assert.doesNotMatch(roles, /GRANT\s+ventureos_owner\s+TO\s+ventureos_app/i);
  assert.match(privileges, /GRANT CONNECT ON DATABASE ventureos TO ventureos_app/);
  assert.match(privileges, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  assert.match(privileges, /GRANT SELECT ON ALL TABLES IN SCHEMA public TO ventureos_backup/);
  assert.match(privileges, /GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ventureos_backup/);
  assert.doesNotMatch(privileges, /GRANT ALL .*ventureos_app/i);
  const secretAdapter = read('scripts/runtime-secret-entrypoint.mjs');
  assert.match(secretAdapter, /VENTUREOS_REQUIRED_DATABASE_ROLE/);
  assert.match(secretAdapter, /role=\$\{requiredRole\}/);
});

test('manifest schema and supply-chain policy documents are present and fail closed', () => {
  const schema = JSON.parse(read('deploy/private-staging/image-manifest.schema.json'));
  assert.equal(schema.properties.platform.const, 'linux/amd64');
  assert.equal(schema.properties.sourceCommit.pattern, '^[0-9a-f]{40}$');
  assert.deepEqual(schema.properties.images.required.sort(), [
    'api',
    'ingress',
    'tools',
    'web',
    'worker',
  ]);

  const vulnerability = read('docs/security/VULNERABILITY_ACCEPTANCE_POLICY.md');
  const signing = read('docs/security/IMAGE_SIGNING_POLICY.md');
  const sbom = read('docs/security/SBOM_PROVENANCE_POLICY.md');
  const access = read('docs/security/GHCR_PACKAGE_ACCESS_POLICY.md');
  assert.match(vulnerability, /zero Critical/i);
  assert.match(vulnerability, /Founder approval required/i);
  assert.match(signing, /token\.actions\.githubusercontent\.com/);
  assert.match(signing, /Founder approval required/i);
  assert.match(sbom, /SPDX JSON/);
  assert.match(sbom, /OIDC/);
  assert.match(access, /read:packages/);
  assert.match(access, /delete:packages.*prohibited/i);
});
