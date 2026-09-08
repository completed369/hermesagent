import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(repoRoot, 'commercial', 'beachheads', 'pet-sitting-operations-tracker');

test('pet-sitting asset is hash-bound and free of active workbook integrations', async () => {
  const manifest = JSON.parse(await readFile(path.join(bundleDir, 'ASSET_MANIFEST.json'), 'utf8'));
  const [asset] = manifest.files;
  const assetPath = path.join(repoRoot, asset.path);
  const bytes = await readFile(assetPath);

  assert.equal(bytes.length, asset.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(bytes.length > 20_000 && bytes.length < 2_000_000);

  const archiveIndex = bytes.toString('latin1');
  for (const forbiddenEntry of [
    'vbaProject.bin',
    'xl/externalLinks/',
    'xl/connections.xml',
    'xl/embeddings/',
  ]) {
    assert.equal(archiveIndex.includes(forbiddenEntry), false, forbiddenEntry);
  }

  assert.equal(manifest.status, 'PRE_PUBLICATION_UNVALIDATED');
  assert.equal(manifest.commercialTruth.published, false);
  assert.equal(manifest.commercialTruth.customerContacted, false);
  assert.equal(manifest.commercialTruth.paymentAccepted, false);
  assert.equal(manifest.commercialTruth.revenueVerified, false);
  assert.deepEqual(Object.values(manifest.runtimeTruth), [
    'NOT_CONFIGURED',
    'NOT_CONFIGURED',
    'NOT_CONFIGURED',
    'NOT_CONFIGURED',
  ]);
});

test('playbook preserves founder gates and commercial-truth labels', async () => {
  const playbook = await readFile(path.join(bundleDir, 'PLAYBOOK.md'), 'utf8');
  assert.match(playbook, /Status: \*\*PRE-PUBLICATION \/ UNVALIDATED\*\*/u);
  assert.match(playbook, /`PUBLICATION`: \*\*FOUNDER-GATED\*\*/u);
  assert.match(playbook, /`PAYMENT_OR_PROVIDER_ACTIVATION`: \*\*FOUNDER-GATED \/ LEVEL 4\*\*/u);
  assert.match(playbook, /`REVENUE`: \*\*UNVERIFIED \/ NONE RECORDED BY THIS PACKAGE\*\*/u);
  assert.match(playbook, /`CODEX`, `HERMES`, `PI`, `runtimeConnection`: \*\*NOT_CONFIGURED\*\*/u);
  assert.match(playbook, /https:\/\/www\.petsit\.com\/industry-stats-and-facts/u);
  assert.match(playbook, /https:\/\/americanpetproducts\.org\/2026-state-of-the-industry/u);
  assert.match(playbook, /https:\/\/support\.rover\.com\/hc\/en-us\/articles\/206351003/u);
});
