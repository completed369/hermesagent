import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const defaultSchemaPath = resolve(
  import.meta.dirname,
  '..',
  'deploy/private-staging/image-manifest.schema.json',
);

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

function run() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error('Usage: node scripts/validate-image-manifest.mjs <manifest.json>');
  }
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  validateImageManifest(manifest);
  console.log(`Validated immutable image manifest: ${manifestPath}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) run();
