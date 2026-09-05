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

const composeService = (compose, name) => {
  const marker = `  ${name}:\n`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name} service`);
  const tail = compose.slice(start + marker.length);
  const next = tail.search(/^  [a-z][a-z0-9-]*:\n/m);
  return next === -1 ? tail : tail.slice(0, next);
};

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

  for (const target of ['AS api', 'AS worker', 'AS web', 'AS tools', 'AS ingress']) {
    assert.match(dockerfile, new RegExp(target));
  }
  assert.match(
    dockerfile,
    /FROM gcr\.io\/distroless\/base-nossl-debian13@sha256:[a-f0-9]{64} AS runtime/,
  );
  assert.match(dockerfile, /COPY --from=runtime-node \/usr\/local\/bin\/node \/nodejs\/bin\/node/);
  assert.match(dockerfile, /COPY --from=runtime-libgcc .*libgcc_s\.so\.1/);
  assert.match(dockerfile, /COPY --from=runtime-libgcc .*libstdc\+\+\.so\.6\*/);
  assert.match(dockerfile, /COPY --from=runtime-libgcc .*status\.d\/libstdc\+\+6/);
  assert.match(dockerfile, /ENV PRISMA_CLI_BINARY_TARGETS=linux-static-x64/);
  assert.match(dockerStage(dockerfile, 'deployer'), /schema-engine-linux-static-x64/);
  assert.match(dockerStage(dockerfile, 'deployer'), /test -x "\$static_schema_engine"/);
  assert.match(
    dockerStage(dockerfile, 'tools'),
    /PRISMA_SCHEMA_ENGINE_BINARY=\/app\/prisma-schema-engine/,
  );
  assert.match(dockerfile, /FROM runtime AS tools/);
  assert.doesNotMatch(dockerfile, /distroless\/nodejs22-debian13/);
  assert.match(dockerStage(dockerfile, 'runtime'), /ENTRYPOINT \["\/nodejs\/bin\/node"\]/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /COPY patches \.\/patches[\s\S]*RUN pnpm install --frozen-lockfile/);
  for (const target of ['api', 'worker', 'tools', 'web', 'ingress']) {
    const stage = dockerStage(dockerfile, target);
    assert.match(stage, /^USER 65532:65532$/m, `${target} must declare the exact runtime user`);
  }
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
    assert.doesNotMatch(composeService(compose, name), /ports:/);
    assert.match(composeService(compose, name), /networks: \[staging-private\]/);
    assert.doesNotMatch(composeService(compose, name), /staging-ingress/);
  }
  for (const name of ['api-ingress', 'web-ingress']) {
    assert.match(
      composeService(compose, name),
      /image: \$\{COMPOSE_PROJECT_NAME:-ventureos-phase15\}-ingress:local/,
    );
    assert.match(composeService(compose, name), /read_only: true/);
    assert.match(composeService(compose, name), /cap_drop: \[ALL\]/);
    assert.match(composeService(compose, name), /networks: \[staging-private, staging-ingress\]/);
  }
  for (const name of ['api', 'worker', 'web', 'api-ingress', 'web-ingress']) {
    const healthcheck = composeService(compose, name).match(
      /healthcheck:\n([\s\S]*?)(?=\n    [a-z]|$)/,
    );
    assert.ok(healthcheck, `${name} must declare a healthcheck`);
    assert.match(healthcheck[0], /['"]\/nodejs\/bin\/node['"]/);
    assert.doesNotMatch(healthcheck[0], /['"]node['"]/);
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
  assert.match(gate, /node scripts\/generate-staging-env\.mjs --target "\$ENV_FILE"/);
  assert.match(
    ci,
    /if ! test -f \.staging\/phase15\.env; then\s+node scripts\/generate-staging-env\.mjs/,
  );
});

test('runtime entrypoint changes trigger the complete image security matrix', () => {
  const workflow = read('.github/workflows/runtime-substrate-remediation.yml');

  assert.match(workflow, /paths:\s*[\s\S]*?- 'scripts\/runtime-secret-entrypoint\.mjs'/);
  assert.match(workflow, /image: \[api, web, worker, tools, ingress\]/);
  assert.match(workflow, /Enforce fresh scanner database and CISA KEV policy/);
  assert.match(workflow, /Generate SPDX JSON SBOM/);
});

test('the immutable migration chain matches the reviewed sequence', () => {
  const migrations = readdirSync(resolve(root, 'packages/database/prisma/migrations'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(migrations, [
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
    '20260819190000_collaborative_workspace_invites',
    '20260820013000_workspace_scoped_sessions',
    '20260821113000_operational_audit_spine',
    '20260821130000_acp_approval_bridge',
    '20260825120000_acp_task_run_spine',
    '20260825190000_durable_agent_bridge_foundation',
    '20260825230000_durable_broker_reservations',
    '20260826043000_acp_cost_governance_ledger',
    '20260827090000_acp_dispatch_outbox',
    '20260827140000_acp_egress_handoff_claims',
    '20260831142000_durable_codex_registration',
    '20260831170000_durable_codex_capability_evidence',
    '20260831203000_durable_codex_heartbeat_evidence',
    '20260831210000_codex_validation_dispatch_evidence',
    '20260831220000_codex_validation_egress_handoff',
    '20260901013000_codex_validation_round_trip_evidence',
    '20260901040000_executable_authority_trust_state',
    '20260901080000_codex_validation_cancellation_evidence',
    '20260901100000_codex_validation_usage_observation_evidence',
    '20260901130000_codex_validation_process_sessions',
    '20260901153000_codex_process_session_claim_trust',
    '20260901170000_codex_process_session_recovery_leases',
    '20260901190000_codex_process_session_completion_trust',
    '20260901210000_codex_process_session_recovery_completion',
    '20260902030000_retained_native_supervisor_trust_state',
    '20260905183000_retained_native_module_trust_state',
  ]);
  const unsafeRestoreReference =
    /(?:password|passwd|secret|token|cookie|authorization|chain[-_.:/ ]?of[-_.:/ ]?thought)/u;
  const migrationHead = migrations.at(-1);
  assert.match(migrationHead, /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u);
  assert.doesNotMatch(
    migrationHead.toLowerCase(),
    unsafeRestoreReference,
    `migration head must remain compatible with restore-drill safe references: ${migrationHead}`,
  );
});

test('the API egress probe uses distroless Node and remains fail-closed', () => {
  const gate = read('scripts/staging-security-gate.sh');
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
  const integrationCommand = apiPackage.scripts['test:integration'];
  const unitCommand = apiPackage.scripts['test:unit'];

  assert.match(integrationCommand, /(?:^|\s)--testTimeout=15000(?:\s|$)/);
  assert.doesNotMatch(unitCommand, /--testTimeout(?:=|\s)/);
  assert.equal(
    Object.entries(apiPackage.scripts).filter(([, command]) => command.includes('--testTimeout'))
      .length,
    1,
  );
});

test('subscription-provider teardown uses bounded bulk cleanup without a hook timeout', () => {
  const source = read('apps/api/test/subscription-provider-policy.integration.spec.ts');
  const hook = source.match(/afterAll\(async \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(hook, 'subscription-provider policy integration test must declare afterAll cleanup');

  assert.doesNotMatch(hook[1], /for\s*\(/);
  assert.doesNotMatch(hook[1], /cleanupEntitledTestWorkspace/);
  assert.match(hook[1], /workspaceIds\s*=\s*\[\.\.\.new Set\(/);
  assert.match(hook[1], /contractIds\s*=\s*\[\.\.\.new Set\(/);
  assert.match(hook[1], /planKeys\s*=\s*workspaceIds\.map\(/);
  assert.match(hook[1], /workspaceId:\s*\{\s*in:\s*workspaceIds\s*\}/);
  assert.match(
    hook[1],
    /(?:contractId|dataAcquisitionContractId|id):\s*\{\s*in:\s*contractIds\s*\}/,
  );
  assert.match(
    hook[1],
    /prisma\.subscription\.deleteMany\(\{\s*where:\s*\{\s*workspaceId:\s*\{\s*in:\s*workspaceIds/,
  );
  assert.match(hook[1], /prisma\.plan\.deleteMany\(\{\s*where:\s*\{\s*key:\s*\{\s*in:\s*planKeys/);

  const apiPackage = read('apps/api/package.json');
  const apiVitestConfigs = readdirSync(resolve(root, 'apps/api'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /vitest.*config/i.test(entry.name))
    .map((entry) => read(`apps/api/${entry.name}`));
  for (const configuration of [apiPackage, source, ...apiVitestConfigs]) {
    assert.doesNotMatch(configuration, /hookTimeout/);
  }
});

test('type-only runtime pruning is target-specific and fail-closed', () => {
  const dockerfile = read('Dockerfile.staging');
  const deployer = dockerStage(dockerfile, 'deployer');
  const web = dockerStage(dockerfile, 'web');

  assert.match(deployer, /prune_runtime_package\(\)/);
  assert.match(deployer, /prune_runtime_package \/runtime\/api '@types\+node@\*' '@types\/node'/);
  for (const runtime of ['api', 'worker', 'tools', 'web']) {
    assert.ok(
      deployer.includes(
        `prune_optional_runtime_package /runtime/${runtime} 'typescript@*' 'typescript'`,
      ),
      `${runtime} must prune TypeScript`,
    );
  }
  for (const [virtualStorePackage, packagePath] of [
    ['@types+node@*', '@types/node'],
    ['@types+estree@*', '@types/estree'],
    ['@types+json-schema@*', '@types/json-schema'],
  ]) {
    assert.ok(
      deployer.includes(
        `prune_runtime_package /runtime/worker '${virtualStorePackage}' '${packagePath}'`,
      ),
      `worker must prune ${packagePath}`,
    );
  }
  assert.match(deployer, /cp -R \/workspace\/apps\/web\/\.next\/standalone \/runtime\/web/);
  assert.match(deployer, /test -e "\$1"/);
  assert.match(deployer, /prune_optional_runtime_package\(\)/);
  assert.match(deployer, /test ! -e "\$package_store" \|\| rm -rf "\$package_store"/);
  assert.match(deployer, /find "\$runtime\/node_modules" -type l -path/);
  assert.match(deployer, /test -z "\$\(find "\$runtime\/node_modules" -path/);
  assert.match(web, /COPY --from=deployer --chown=65532:65532 \/runtime\/web\/ \./);
  assert.doesNotMatch(web, /COPY --from=builder .*\/\.next\/standalone/);
});

test('generated Scarf compile-cache pruning is API-only, narrow, and fail-closed', () => {
  const dockerfile = read('Dockerfile.staging');
  const deployer = dockerStage(dockerfile, 'deployer');
  const rootfsChecker = read('scripts/verify-image-rootfs.py');

  assert.match(deployer, /prune_scarf_compile_cache\(\)/);
  assert.match(
    deployer,
    /"\$runtime\/node_modules\/\.pnpm"\/@scarf\+scarf@\*\/node_modules\/@scarf\/scarf/,
  );
  assert.match(deployer, /rm -rf "\$scarf_store\/node-compile-cache"/);
  assert.match(
    deployer,
    /find "\$runtime\/node_modules\/\.pnpm" -path '\*\/@scarf\/scarf\/node-compile-cache'/,
  );
  assert.match(deployer, /prune_scarf_compile_cache \/runtime\/api/);
  for (const target of ['worker', 'web', 'tools']) {
    assert.doesNotMatch(deployer, new RegExp(`prune_scarf_compile_cache /runtime/${target}`));
  }

  assert.match(rootfsChecker, /def scarf_compile_cache\(/);
  assert.match(rootfsChecker, /generated Scarf node-compile-cache/);
  assert.match(
    rootfsChecker,
    /rb"BEGIN \[A-Z \]\*PRIVATE KEY\|gh\[pousr\]_\[A-Za-z0-9\]\{20\}\|sk-ant-\[A-Za-z0-9_-\]\{20\}"/,
  );
  assert.doesNotMatch(rootfsChecker, /scarf[^\n]*(?:allow|exclude|whitelist)/i);
});

test('dotenv documentation pruning is service-runtime-only, narrow, and fail-closed', () => {
  const dockerfile = read('Dockerfile.staging');
  const deployer = dockerStage(dockerfile, 'deployer');
  const rootfsChecker = read('scripts/verify-image-rootfs.py');

  assert.match(deployer, /prune_dotenv_docs\(\)/);
  assert.match(deployer, /"\$runtime\/node_modules\/\.pnpm"\/dotenv@\*\/node_modules\/dotenv/);
  assert.match(deployer, /find "\$dotenv_store" -maxdepth 1 -type f -iname 'README\*' -delete/);
  assert.match(
    deployer,
    /find "\$runtime\/node_modules\/\.pnpm" -path '\*\/node_modules\/dotenv\/README\*'/,
  );
  for (const target of ['api', 'worker', 'tools']) {
    assert.match(deployer, new RegExp(`prune_dotenv_docs /runtime/${target}`));
  }
  for (const target of ['web']) {
    assert.doesNotMatch(deployer, new RegExp(`prune_dotenv_docs /runtime/${target}`));
  }

  assert.match(rootfsChecker, /secret-like content detected/);
  assert.doesNotMatch(rootfsChecker, /dotenv[^\n]*(?:allow|exclude|whitelist)/i);
});
