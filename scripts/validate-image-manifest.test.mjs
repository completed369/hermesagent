import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
