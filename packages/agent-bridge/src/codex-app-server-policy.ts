import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { canonicalJson } from './codec';
import {
  type RuntimeLaunchManifest,
  type ValidatedSupervisorManifest,
  validateSupervisorManifest,
} from './supervision-policy';

export const CODEX_APP_SERVER_ADAPTER_KIND = 'CODEX_APP_SERVER_STDIO_V1';
export const CODEX_APP_SERVER_ARGUMENT_POLICY = 'ventureos.codex-app-server.stdio.v1';
export const CODEX_APP_SERVER_ARGV = Object.freeze(['app-server', '--listen', 'stdio://'] as const);

const ADAPTER_POLICY = Object.freeze({
  schemaVersion: 1 as const,
  adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
  platform: 'LINUX' as const,
  executableBasename: 'codex',
  argv: CODEX_APP_SERVER_ARGV,
  argumentPolicyReference: CODEX_APP_SERVER_ARGUMENT_POLICY,
  protocol: 'JSONL_STDIO' as const,
  network: 'DENY' as const,
  shell: false as const,
  environmentVariableNames: Object.freeze([] as const),
  secretTransport: 'NONE' as const,
  experimentalApi: false as const,
  launchAuthorization: 'NOT_CONFIGURED' as const,
  providerAccess: 'NOT_CONFIGURED' as const,
});

export type CodexAppServerPolicyErrorCode =
  | 'INVALID_MANIFEST'
  | 'ADAPTER_MISMATCH'
  | 'UNSUPPORTED_PLATFORM'
  | 'EXECUTABLE_MISMATCH'
  | 'ARGUMENT_POLICY_MISMATCH'
  | 'ARGUMENT_MISMATCH'
  | 'SECRET_TRANSPORT_DENIED';

export class CodexAppServerPolicyError extends Error {
  constructor(readonly code: CodexAppServerPolicyErrorCode) {
    super(`Codex app-server adapter policy denied: ${code}`);
  }
}

export interface ValidatedCodexAppServerManifest {
  readonly schemaVersion: 1;
  readonly manifest: Readonly<RuntimeLaunchManifest>;
  readonly manifestHash: string;
  readonly argvHash: string;
  readonly adapterPolicyHash: string;
  readonly launchAuthorization: 'NOT_CONFIGURED';
  readonly providerAccess: 'NOT_CONFIGURED';
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function exactArguments(argv: readonly string[]): boolean {
  return (
    argv.length === CODEX_APP_SERVER_ARGV.length &&
    argv.every((argument, index) => argument === CODEX_APP_SERVER_ARGV[index])
  );
}

function freeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value as Readonly<T>;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

/**
 * Narrows an inert supervisor manifest to the first reviewed Codex command
 * shape. This function grants no executable, provider, process, transport, or
 * runtime authority; the production authorization source and launcher remain
 * deny-only.
 */
export function validateCodexAppServerManifest(
  input: unknown,
): Readonly<ValidatedCodexAppServerManifest> {
  let validated: Readonly<ValidatedSupervisorManifest>;
  try {
    validated = validateSupervisorManifest(input);
  } catch {
    throw new CodexAppServerPolicyError('INVALID_MANIFEST');
  }
  const manifest = validated.manifest;
  if (manifest.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND || manifest.testOnly)
    throw new CodexAppServerPolicyError('ADAPTER_MISMATCH');
  if (manifest.platform !== 'LINUX') throw new CodexAppServerPolicyError('UNSUPPORTED_PLATFORM');
  if (posix.basename(manifest.executable.canonicalPath) !== 'codex')
    throw new CodexAppServerPolicyError('EXECUTABLE_MISMATCH');
  if (manifest.argumentPolicyReference !== CODEX_APP_SERVER_ARGUMENT_POLICY)
    throw new CodexAppServerPolicyError('ARGUMENT_POLICY_MISMATCH');
  if (!exactArguments(manifest.argv)) throw new CodexAppServerPolicyError('ARGUMENT_MISMATCH');
  if (
    manifest.protocol !== 'JSONL_STDIO' ||
    manifest.network !== 'DENY' ||
    manifest.shell !== false ||
    manifest.environmentVariableNames.length !== 0 ||
    manifest.limits.maximumChildProcesses !== 0
  )
    throw new CodexAppServerPolicyError('INVALID_MANIFEST');
  if (manifest.secretTransport !== 'NONE')
    throw new CodexAppServerPolicyError('SECRET_TRANSPORT_DENIED');

  return freeze({
    schemaVersion: 1,
    manifest,
    manifestHash: validated.manifestHash,
    argvHash: validated.argvHash,
    adapterPolicyHash: sha256(ADAPTER_POLICY),
    launchAuthorization: 'NOT_CONFIGURED',
    providerAccess: 'NOT_CONFIGURED',
  });
}
