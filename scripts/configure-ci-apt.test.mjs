import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { configureCiApt, withUbuntuMirrorFallback } from './configure-ci-apt.mjs';

test('mirror selection preserves Ubuntu suites, signature keys and third-party sources', () => {
  const signedBy = 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
  const source =
    'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu\nSuites: noble noble-updates\nComponents: main universe\n' +
    signedBy;
  const next = withUbuntuMirrorFallback(source);
  assert.equal(
    next,
    source.replace('https://archive.ubuntu.com/ubuntu', 'mirror+file:/etc/apt/apt-mirrors.txt'),
  );
  assert.equal(withUbuntuMirrorFallback(next), next);
  const other =
    'deb [signed-by=/vendor.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n';
  assert.equal(withUbuntuMirrorFallback(other), other);
  assert.equal(
    withUbuntuMirrorFallback('https://archive.ubuntu.com/ubuntu-not-a-repo'),
    'https://archive.ubuntu.com/ubuntu-not-a-repo',
  );
});

test('setup repairs mirror-file and direct-source runner layouts without changing trust', () => {
  const root = mkdtempSync(join(tmpdir(), 'ventureos-apt-'));
  try {
    mkdirSync(join(root, 'sources.list.d'));
    mkdirSync(join(root, 'apt.conf.d'));
    writeFileSync(join(root, 'apt-mirrors.txt'), 'http://azure.archive.ubuntu.com/ubuntu\n');
    writeFileSync(
      join(root, 'sources.list'),
      'deb [signed-by=/ubuntu.gpg] http://azure.archive.ubuntu.com/ubuntu/ noble main\n',
    );
    const modern =
      'URIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble-security\nSigned-By: /ubuntu.gpg\n';
    writeFileSync(join(root, 'sources.list.d/ubuntu.sources'), modern);
    const vendor = 'deb [signed-by=/vendor.gpg] https://vendor.example/apt stable main\n';
    writeFileSync(join(root, 'sources.list.d/vendor.list'), vendor);
    configureCiApt(root);
    configureCiApt(root);
    assert.equal(
      readFileSync(join(root, 'sources.list'), 'utf8'),
      'deb [signed-by=/ubuntu.gpg] mirror+file:/etc/apt/apt-mirrors.txt noble main\n',
    );
    assert.equal(readFileSync(join(root, 'sources.list.d/ubuntu.sources'), 'utf8'), modern);
    assert.equal(readFileSync(join(root, 'sources.list.d/vendor.list'), 'utf8'), vendor);
    const mirrors = readFileSync(join(root, 'apt-mirrors.txt'), 'utf8').trim().split('\n');
    assert.equal(mirrors.length, 3);
    assert.equal(new Set(mirrors.map((line) => new URL(line.split('\t')[0]).hostname)).size, 3);
    for (const line of mirrors) assert.match(line, /^https:\/\/[^\s]+\tpriority:[123]$/);
    const policy = readFileSync(join(root, 'apt.conf.d/99ventureos-ci-network'), 'utf8');
    assert.match(policy, /APT::Update::Error-Mode "any"/);
    assert.doesNotMatch(policy, /AllowUnauthenticated|AllowInsecure|Verify-Peer|Verify-Host/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('both CI jobs retain required browser installation and use the same mirror configuration', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.equal(workflow.match(/scripts\/configure-ci-apt\.mjs/g)?.length, 2);
  assert.equal(workflow.match(/playwright install --with-deps chromium/g)?.length, 2);
  assert.equal(workflow.match(/timeout-minutes: 8/g)?.length, 2);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});
