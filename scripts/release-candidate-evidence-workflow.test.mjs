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

const onBlock = workflow.slice(workflow.indexOf("'on':\n"), workflow.indexOf('\npermissions:'));
const triggerKeys = [...onBlock.matchAll(/^  ([a-z_]+):/gm)].map((match) => match[1]);

const hasSafeExecutionContract = (candidate) => {
  const permissions = [...candidate.matchAll(/^permissions:\n((?:^  .*\n?)*)/gm)];
  return (
    /^  workflow_dispatch:/m.test(candidate) &&
    !/^  (push|pull_request|pull_request_target|schedule|workflow_run|workflow_call|repository_dispatch|merge_group|deployment|deployment_status|release|registry_package):/m.test(
      candidate,
    ) &&
    permissions.length === 1 &&
    permissions[0][1].trim() === 'contents: read' &&
    !/^permissions:\s*(?:write-all|read-all)/m.test(candidate) &&
    !/^    permissions:/m.test(candidate) &&
    !/^\s+packages:/m.test(candidate) &&
    !/^\s+deployments:/m.test(candidate) &&
    !/^\s+id-token:/m.test(candidate) &&
    !/^\s+attestations:/m.test(candidate) &&
    !/^\s+environment:/m.test(candidate) &&
    !/^\s+attests:/m.test(candidate) &&
    /provenance: false/.test(candidate) &&
    /sbom: false/.test(candidate) &&
    !/provenance: true|sbom: true/.test(candidate) &&
    !/docker\/login-action|\bdocker\s+login\b|\bdocker\s+push\b|docker\s+buildx[^\n]*--push|actions\/attest|\bcosign\b/.test(
      candidate,
    ) &&
    !/ghcr\.io|secrets\./.test(candidate) &&
    /push: false/.test(candidate) &&
    !/push: true/.test(candidate)
  );
};

test('release-candidate evidence is manual, canonical-main-only, and fail closed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.deepEqual(triggerKeys, ['workflow_dispatch']);
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
  assert.doesNotMatch(workflow, /^\s+attests:/m);
  assert.doesNotMatch(workflow, /^    permissions:/m);
  assert.doesNotMatch(workflow, /^permissions:\s*(?:write-all|read-all)/m);
  assert.doesNotMatch(workflow, /docker\/login-action/);
  assert.doesNotMatch(workflow, /\bdocker\s+login\b/);
  assert.doesNotMatch(workflow, /\bdocker\s+push\b/);
  assert.doesNotMatch(workflow, /\bcosign\b|\bsign(?:ing)?\b.*--yes|actions\/attest/);
  assert.doesNotMatch(workflow, /ghcr\.io|GITHUB_TOKEN|secrets\./);
  assert.doesNotMatch(
    workflow,
    /docker\s+buildx[^\n]*--push|kubectl|wrangler|cloudflare|ssh-action|scp-action|actions\/deploy|gh\s+release|gh\s+api[^\n]*(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)/i,
  );
  assert.equal(hasSafeExecutionContract(workflow), true);
});

test('adversarial contract rejects automatic triggers and publication capabilities', () => {
  const mutations = [
    workflow.replace('  workflow_dispatch:', '  push:\n    branches: [main]\n  workflow_dispatch:'),
    workflow.replace('  workflow_dispatch:', '  workflow_call:\n  workflow_dispatch:'),
    workflow.replace('  workflow_dispatch:', '  repository_dispatch:\n  workflow_dispatch:'),
    workflow.replace('  contents: read', '  contents: read\n  packages: write'),
    workflow.replace('permissions:\n  contents: read', 'permissions: write-all'),
    workflow.replace(
      '    runs-on: ubuntu-24.04',
      '    permissions:\n      contents: write\n    runs-on: ubuntu-24.04',
    ),
    workflow.replace('  contents: read', '  contents: read\n  id-token: write'),
    workflow.replace('  contents: read', '  contents: read\n  deployments: write'),
    workflow.replace(
      '    runs-on: ubuntu-24.04',
      '    environment: production\n    runs-on: ubuntu-24.04',
    ),
    workflow.replace('          push: false', '          push: true'),
    workflow.replace('          provenance: false', '          provenance: true'),
    workflow.replace('          sbom: false', '          sbom: true'),
    workflow.replace(
      '          sbom: false',
      '          sbom: false\n          attests: type=provenance',
    ),
    `${workflow}\n# docker push ghcr.io/example/image:unsafe\n`,
    `${workflow}\n# uses: actions/attest@${'a'.repeat(40)}\n`,
    `${workflow}\n# uses: docker/login-action@${'a'.repeat(40)}\n`,
    `${workflow}\n# docker login example.invalid\n`,
    `${workflow}\n# docker buildx build --push .\n`,
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
  assert.match(workflow, /provenance: false/);
  assert.match(workflow, /sbom: false/);
  assert.doesNotMatch(workflow, /^\s+attests:/m);
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
  assert.match(workflow, /\.vulnerabilities \| type == "array" and length > 0/);
  assert.match(workflow, /\^CVE-\[0-9\]\{4\}-\[0-9\]\{4,\}\$/);
  assert.match(workflow, /comm -12/);
  assert.match(workflow, /--scanners vuln,secret/);
  assert.match(workflow, /--image-config-scanners secret/);
  assert.match(workflow, /--severity HIGH,CRITICAL/);
  assert.match(workflow, /--exit-on-eol 1/);
  assert.match(workflow, /format: spdx-json/);
  assert.match(workflow, /\.SchemaVersion \| type == "integer"/);
  assert.match(workflow, /\.ArtifactName == \$archive/);
  assert.match(workflow, /\.ArtifactType == "container_image"/);
  assert.match(workflow, /\.Results \| type == "array" and length > 0/);
  assert.match(workflow, /\.SPDXID == "SPDXRef-DOCUMENT"/);
  assert.match(workflow, /\.packages \| type == "array" and length > 0/);
  assert.match(workflow, /manifest\.json/);
  assert.match(workflow, /RepoTags/);
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
  assert.match(
    workflow,
    /Preserve exact scanned archive and evidence artifacts\n        if: success\(\)/,
  );
  assert.match(workflow, /Preserve sanitized image outcome\n        if: always\(\)/);
  assert.doesNotMatch(
    workflow,
    /Preserve sanitized source outcome[\s\S]*?path:[\s\S]*?ventureos-source\.trivy\.json/,
  );
});

test('workflow revalidates canonical main only after every image succeeds', () => {
  assert.match(workflow, /revalidate-source:/);
  assert.match(workflow, /needs: build-scan/);
  assert.match(workflow, /Prove scanned source is still canonical main/);
  assert.equal((workflow.match(/\.commit\.sha' \/tmp\/main-branch\.json/g) ?? []).length, 2);
});
