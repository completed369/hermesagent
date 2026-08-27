import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_MANIFEST_BYTES = 32 * 1_024 * 1_024;
const MAX_ENTRIES = 500_000;
const MAX_FIELD_LENGTH = 4_096;
const PACKAGE_ROOT = 'node_modules/@ventureos/agent-bridge';
const TEST_SIGNING_FINGERPRINT = 'MC4CAQAwBQYDK2VwBCIEIDXgLTsIlYz/jfY7Or5Ylt4TinBgk8MUM5C+13sON7Uo';

function safeRelativePath(value) {
  if (
    value.length === 0 ||
    value.length > MAX_FIELD_LENGTH ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[\r\n]/u.test(value) ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
    return false;
  return posix.normalize(value) === value;
}

function resolvedPackageRootLink(path, target) {
  if (
    target.length === 0 ||
    target.length > MAX_FIELD_LENGTH ||
    target.startsWith('/') ||
    target.includes('\\') ||
    /[\r\n]/u.test(target)
  )
    return null;
  const resolved = posix.normalize(posix.join(posix.dirname(path), target));
  const packageBase = path.slice(0, -PACKAGE_ROOT.length);
  const virtualStoreRoot = packageBase.endsWith('node_modules/.pnpm/')
    ? packageBase
    : `${packageBase}node_modules/.pnpm/`;
  const expectedPrefix = `${virtualStoreRoot}@ventureos+agent-bridge@`;
  const expectedSuffix = `/${PACKAGE_ROOT}`;
  if (!resolved.startsWith(expectedPrefix) || !resolved.endsWith(expectedSuffix)) return null;
  const packageSlugSuffix = resolved.slice(expectedPrefix.length, -expectedSuffix.length);
  return packageSlugSuffix.length > 0 && !packageSlugSuffix.includes('/') ? resolved : null;
}

export function classifyAgentBridgeRuntimeEntry({ type, path, linkTarget = '' }) {
  if (!/^[bcdflps]$/u.test(type) || !safeRelativePath(path)) return 'MALFORMED_ENTRY';
  if (
    /(?:^|\/)(?:native-supervisor-helper|native-supervisor-addon|native-runtime-fixture|authenticated-lifecycle-addon|authenticated-supervised-lifecycle)(?:\.[^/]*)?$/u.test(
      path,
    ) ||
    path === 'packages/agent-bridge/test/native' ||
    path.startsWith('packages/agent-bridge/test/native/') ||
    path.includes('/packages/agent-bridge/test/native/')
  )
    return 'NATIVE_TEST_FIXTURE';
  const marker = `/${PACKAGE_ROOT}`;
  const initialMarkerIndex = path.indexOf(marker);
  let packageRootIndex =
    path === PACKAGE_ROOT || path.startsWith(`${PACKAGE_ROOT}/`)
      ? 0
      : initialMarkerIndex < 0
        ? -1
        : initialMarkerIndex + 1;
  while (
    packageRootIndex >= 0 &&
    path.length > packageRootIndex + PACKAGE_ROOT.length &&
    path[packageRootIndex + PACKAGE_ROOT.length] !== '/'
  ) {
    const nextMarkerIndex = path.indexOf(marker, packageRootIndex + 1);
    packageRootIndex = nextMarkerIndex < 0 ? -1 : nextMarkerIndex + 1;
  }
  if (packageRootIndex < 0) return null;
  const packageRootEnd = packageRootIndex + PACKAGE_ROOT.length;
  const suffix = path.length === packageRootEnd ? '' : path.slice(packageRootEnd + 1);
  if (suffix === '') {
    if (type === 'd') return null;
    if (type === 'l' && resolvedPackageRootLink(path, linkTarget) !== null) return null;
    return 'UNSAFE_PACKAGE_ROOT';
  }
  if (type === 'd') return suffix === 'dist' || suffix.startsWith('dist/') ? null : 'PACKAGE_DRIFT';
  if (type !== 'f') return 'UNSAFE_PACKAGE_ENTRY';
  if (suffix === 'package.json') return null;
  if (
    suffix.startsWith('dist/') &&
    !/(?:^|\/)__tests__(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u.test(suffix)
  )
    return null;
  return 'PACKAGE_DRIFT';
}

export function verifyAgentBridgeRuntimeManifest(input) {
  if (!Buffer.isBuffer(input) || input.length === 0 || input.length > MAX_MANIFEST_BYTES)
    return 'MALFORMED_MANIFEST';
  if (input.includes(Buffer.from(TEST_SIGNING_FINGERPRINT, 'utf8'))) return 'TEST_SIGNING_MATERIAL';
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    return 'MALFORMED_MANIFEST';
  }
  const fields = decoded.split('\0');
  if (fields.at(-1) !== '') return 'MALFORMED_MANIFEST';
  fields.pop();
  if (fields.length % 3 !== 0 || fields.length / 3 > MAX_ENTRIES) return 'MALFORMED_MANIFEST';
  const entries = [];
  const entryTypes = new Map();
  for (let index = 0; index < fields.length; index += 3) {
    const entry = { type: fields[index], path: fields[index + 1], linkTarget: fields[index + 2] };
    if (entryTypes.has(entry.path)) return 'MALFORMED_MANIFEST';
    entryTypes.set(entry.path, entry.type);
    entries.push(entry);
  }
  for (const entry of entries) {
    const result = classifyAgentBridgeRuntimeEntry(entry);
    if (result !== null) return result;
    if (
      entry.type === 'l' &&
      (entry.path === PACKAGE_ROOT || entry.path.endsWith(`/${PACKAGE_ROOT}`))
    ) {
      const resolved = resolvedPackageRootLink(entry.path, entry.linkTarget);
      if (resolved === null || entryTypes.get(resolved) !== 'd') return 'UNSAFE_PACKAGE_ROOT';
    }
  }
  return null;
}

async function main() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_MANIFEST_BYTES) throw new Error('Runtime image manifest denied');
    chunks.push(chunk);
  }
  const result = verifyAgentBridgeRuntimeManifest(Buffer.concat(chunks));
  if (result !== null)
    throw new Error(`Agent Bridge final-image package boundary denied: ${result}`);
  console.log('Agent Bridge final-image package boundary: PASS');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
