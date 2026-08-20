import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { resolveImageManifestPath, validateImageManifest } from './validate-image-manifest.mjs';

const validManifest = {
  schemaVersion: 1,
  sourceCommit: 'a'.repeat(40),
  platform: 'linux/amd64',
  images: Object.fromEntries(
    ['api', 'web', 'worker', 'tools', 'ingress'].map((name) => [
      name,
      `ghcr.io/completed369/ventureos-${name}@sha256:${'b'.repeat(64)}`,
    ]),
  ),
};

test('image manifest validator accepts the exact immutable five-image contract', () => {
  assert.deepEqual(validateImageManifest(validManifest), validManifest);
});

test('image manifest validator rejects mutable, incomplete, and extra content', () => {
  assert.throws(
    () => validateImageManifest({ ...validManifest, unexpected: true }),
    /must NOT have additional properties/,
  );
  assert.throws(
    () =>
      validateImageManifest({
        ...validManifest,
        images: { ...validManifest.images, api: 'ghcr.io/completed369/ventureos-api:latest' },
      }),
    /must match pattern/,
  );
});

test('image manifest CLI accepts only the bounded repository-root artifact', () => {
  const expectedPath = resolve(import.meta.dirname, '..', 'ventureos-images.json');
  const previous = existsSync(expectedPath) ? readFileSync(expectedPath) : undefined;
  try {
    writeFileSync(expectedPath, '{}\n');
    assert.equal(resolveImageManifestPath('ventureos-images.json'), expectedPath);
    assert.throws(
      () => resolveImageManifestPath('../ventureos-images.json'),
      /repository-root ventureos-images\.json/,
    );
    assert.throws(
      () => resolveImageManifestPath('deploy/private-staging/image-manifest.schema.json'),
      /repository-root ventureos-images\.json/,
    );
  } finally {
    if (previous === undefined) rmSync(expectedPath, { force: true });
    else writeFileSync(expectedPath, previous);
  }
});

test('image manifest CLI rejects an out-of-tree symbolic link', (context) => {
  const expectedPath = resolve(import.meta.dirname, '..', 'ventureos-images.json');
  const previous = existsSync(expectedPath) ? readFileSync(expectedPath) : undefined;
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ventureos-manifest-link-'));
  const externalManifest = join(temporaryRoot, 'external-images.json');

  try {
    rmSync(expectedPath, { force: true });
    writeFileSync(externalManifest, '{}\n');
    try {
      symlinkSync(externalManifest, expectedPath, 'file');
    } catch (error) {
      if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
        context.skip(`symbolic links are unavailable on this platform: ${error.code}`);
        return;
      }
      throw error;
    }

    assert.throws(
      () => resolveImageManifestPath('ventureos-images.json'),
      /regular file no larger than 1 MiB/,
    );
  } finally {
    rmSync(expectedPath, { force: true });
    if (previous !== undefined) writeFileSync(expectedPath, previous);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
