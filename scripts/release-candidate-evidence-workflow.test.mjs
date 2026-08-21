import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/release-candidate-evidence.yml'),
  'utf8',
);

const actionLines = workflow.split('\n').filter((line) => /^\s*-?\s*uses:/.test(line));

const hasSafeExecutionContract = (candidate) => {
  const permissions = [...candidate.matchAll(/^permissions:\n((?:^  .*\n?)*)/gm)];
  return (
    /^  workflow_dispatch:/m.test(candidate) &&
    !/^  (push|pull_request|schedule|workflow_run):/m.test(candidate) &&
    permissions.length === 1 &&
    permissions[0][1].trim() === 'contents: read' &&
    !/^\s+packages:/m.test(candidate) &&
    !/^\s+deployments:/m.test(candidate) &&
    !/^\s+id-token:/m.test(candidate) &&
    !/^\s+attestations:/m.test(candidate) &&
    !/^\s+environment:/m.test(candidate) &&
    !/docker\/login-action|\bdocker\s+push\b|actions\/attest|\bcosign\b/.test(candidate) &&
    !/ghcr\.io|secrets\./.test(candidate) &&
    /push: false/.test(candidate) &&
    !/push: true/.test(candidate)
  );
};

test('release-candidate evidence is manual, canonical-main-only, and fail closed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule|workflow_run):/m);
  assert.match(workflow, /source_sha:/);
  assert.match(workflow, /required: true/);
  assert.match(workflow, /test "\$DISPATCH_REF" = refs\/heads\/main/);
  assert.match(workflow, /test "\$INPUT_SOURCE_SHA" = "\$DISPATCH_SHA"/);
  assert.match(workflow, /\.default_branch.*= main/);
  assert.match(workflow, /\.commit\.sha.*"\$INPUT_SOURCE_SHA"/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$INPUT_SOURCE_SHA"/);
  assert.doesNotMatch(workflow, /refs\/pull\//);
});

test('workflow grants contents read only and has no privileged publication surface', () => {
  const permissionBlocks = [...workflow.matchAll(/^permissions:\n((?:^  .*\n?)*)/gm)];
  assert.equal(permissionBlocks.length, 1);
  assert.equal(permissionBlocks[0][1].trim(), 'contents: read');

  assert.doesNotMatch(workflow, /^\s+packages:/m);
  assert.doesNotMatch(workflow, /^\s+deployments:/m);
  assert.doesNotMatch(workflow, /^\s+id-token:/m);
  assert.doesNotMatch(workflow, /^\s+attestations:/m);
  assert.doesNotMatch(workflow, /^\s+environment:/m);
  assert.doesNotMatch(workflow, /docker\/login-action/);
  assert.doesNotMatch(workflow, /\bdocker\s+push\b/);
  assert.doesNotMatch(workflow, /\bcosign\b|\bsign(?:ing)?\b.*--yes|actions\/attest/);
  assert.doesNotMatch(workflow, /ghcr\.io|GITHUB_TOKEN|secrets\./);
  assert.doesNotMatch(workflow, /kubectl|wrangler|cloudflare|ssh-action|scp-action/i);
  assert.equal(hasSafeExecutionContract(workflow), true);
});

test('adversarial contract rejects automatic triggers and publication capabilities', () => {
  const mutations = [
    workflow.replace('  workflow_dispatch:', '  push:\n    branches: [main]\n  workflow_dispatch:'),
    workflow.replace('  contents: read', '  contents: read\n  packages: write'),
    workflow.replace('  contents: read', '  contents: read\n  id-token: write'),
    workflow.replace('  contents: read', '  contents: read\n  deployments: write'),
    workflow.replace(
      '    runs-on: ubuntu-24.04',
      '    environment: production\n    runs-on: ubuntu-24.04',
    ),
    workflow.replace('          push: false', '          push: true'),
    `${workflow}\n# docker push ghcr.io/example/image:unsafe\n`,
    `${workflow}\n# uses: actions/attest@${'a'.repeat(40)}\n`,
    `${workflow}\n# uses: docker/login-action@${'a'.repeat(40)}\n`,
  ];
  for (const candidate of mutations) {
    assert.equal(hasSafeExecutionContract(candidate), false);
  }
});

test('every third-party action is immutable and checkout never retains credentials', () => {
  assert.ok(actionLines.length > 0);
  for (const line of actionLines) {
    assert.match(line, /@[0-9a-f]{40}(?:\s+#.*)?$/, `action must be pinned: ${line}`);
  }
  const checkoutCount = actionLines.filter((line) => line.includes('actions/checkout@')).length;
  const credentialCount = (workflow.match(/persist-credentials: false/g) ?? []).length;
  assert.equal(checkoutCount, 2);
  assert.equal(credentialCount, checkoutCount);
});

test('all five linux/amd64 targets are built locally without publication', () => {
  for (const image of ['api', 'web', 'worker', 'tools', 'ingress']) {
    assert.match(workflow, new RegExp(`image: ${image}\\b`));
    assert.match(workflow, new RegExp(`target: ${image}\\b`));
  }
  assert.match(workflow, /platforms: linux\/amd64/);
  assert.match(workflow, /push: false/);
  assert.match(workflow, /outputs: type=docker,dest=\/tmp\/ventureos-/);
  assert.doesNotMatch(workflow, /push: true/);
  assert.doesNotMatch(workflow, /outputs:\s*type=registry/);
});

test('source and image evidence enforce the complete release-candidate security policy', () => {
  assert.match(workflow, /scanners: secret,misconfig/);
  assert.match(workflow, /trivy fs/);
  assert.match(workflow, /ventureos-source\.trivy\.json/);
  assert.match(workflow, /severity: UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL/);
  assert.match(workflow, /VulnerabilityDB\.UpdatedAt/);
  assert.match(workflow, /test "\$age_seconds" -le 86400/);
  assert.match(workflow, /known_exploited_vulnerabilities\.json/);
  assert.match(workflow, /comm -12/);
  assert.match(workflow, /--scanners vuln,secret/);
  assert.match(workflow, /--image-config-scanners secret/);
  assert.match(workflow, /--severity HIGH,CRITICAL/);
  assert.match(workflow, /--exit-on-eol 1/);
  assert.match(workflow, /format: spdx-json/);
});

test('exact archives, source identity, checksums, scan evidence, KEV data, and SBOMs are retained', () => {
  assert.match(workflow, /ventureos-\$\{\{ matrix\.image \}\}\.tar/);
  assert.match(workflow, /ventureos-\$\{\{ matrix\.image \}\}\.trivy\.json/);
  assert.match(workflow, /trivy-version\.json/);
  assert.match(workflow, /kev-matches\.txt/);
  assert.match(workflow, /known_exploited_vulnerabilities\.json/);
  assert.match(workflow, /ventureos-\$\{\{ matrix\.image \}\}\.spdx\.json/);
  assert.match(workflow, /source-sha\.txt/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /retention-days: 90/);
});
