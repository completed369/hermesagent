import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateImageManifest } from './validate-image-manifest.mjs';

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
