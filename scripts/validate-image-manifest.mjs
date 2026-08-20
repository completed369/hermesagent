import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const defaultSchemaPath = resolve(
  import.meta.dirname,
  '..',
  'deploy/private-staging/image-manifest.schema.json',
);
const repositoryRoot = resolve(import.meta.dirname, '..');
const expectedManifestPath = join(repositoryRoot, 'ventureos-images.json');
const MAX_MANIFEST_BYTES = 1024 * 1024;

const schema = JSON.parse(readFileSync(defaultSchemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

export function validateImageManifest(manifest) {
  if (!validate(manifest)) {
    const details = ajv.errorsText(validate.errors, { separator: '; ' });
    throw new Error(`Invalid VentureOS image manifest: ${details}`);
  }
  return manifest;
}

export function resolveImageManifestPath(inputPath) {
  if (!inputPath || resolve(repositoryRoot, inputPath) !== expectedManifestPath) {
    throw new Error('Image manifest path must be the repository-root ventureos-images.json');
  }
  const metadata = statSync(expectedManifestPath);
  if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) {
    throw new Error('Image manifest must be a regular file no larger than 1 MiB');
  }
  return expectedManifestPath;
}

function run() {
  const manifestPath = resolveImageManifestPath(process.argv[2]);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateImageManifest(manifest);
  console.log(`Validated immutable image manifest: ${manifestPath}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) run();
