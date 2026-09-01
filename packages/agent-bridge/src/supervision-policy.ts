import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';

import { canonicalJson } from './codec';
import {
  linuxExecutableAuthorizationHash,
  TestOnlyLinuxExecutableAuthorizationVerifier,
  type LinuxExecutableAuthorizationVerifier,
} from './supervision-authorization';

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const PRIVATE_TEXT =
  /(?:chain[-_. ]?of[-_. ]?thought|private[-_. ]?reasoning|password|credential|api[-_. ]?key|access[-_. ]?token|auth(?:orization)?[-_. ]?token|session[-_. ]?token|secret|transcript|prompt)/iu;
const SECRET_LIKE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk|gh[opusr]|github_pat|glpat|xox[baprs]|AKIA)[_-]?[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/u;
const SHELL_SYNTAX = /[|;&><`$\r\n\u0000]/u;
const SENSITIVE_SWITCH =
  /^--?(?:api[-_]?key|auth(?:orization)?|bearer|cookie|credential|key|password|secret|session|token)(?:=|$)/iu;
const PATH_CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const WINDOWS_INVALID = /["*?<>|~]/u;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const DENIED_EXECUTABLE_BASENAME =
  /^(?:bash|bun|cmd|cscript|dash|deno|env|fish|java|ksh|mshta|node|perl|powershell|pwsh|python(?:3)?|regsvr32|ruby|rundll32|sh|wscript|zsh)(?:\.exe)?$/iu;
const MAX_PATH_BYTES = 512;
const MAX_ARGUMENTS = 32;
const MAX_ARGUMENT_BYTES = 512;
const MAX_ARGUMENT_TOTAL_BYTES = 4_096;
const MAX_EVIDENCE_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5_000;

export type SupervisorPlatform = 'WIN32' | 'LINUX';

export interface RuntimeLaunchManifest {
  readonly schemaVersion: 1;
  readonly manifestId: string;
  readonly manifestVersion: number;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly adapterKind: string;
  readonly platform: SupervisorPlatform;
  readonly testOnly: boolean;
  readonly executable: {
    readonly canonicalPath: string;
    readonly sha256: string;
    readonly identityReference: string;
  };
  readonly argv: readonly string[];
  readonly argumentPolicyReference: string;
  readonly worktreeRoot: string;
  readonly workingDirectory: string;
  readonly protocol: 'JSONL_STDIO';
  readonly network: 'DENY';
  readonly shell: false;
  readonly environmentVariableNames: readonly [];
  readonly secretTransport: 'NONE' | 'INHERITED_HANDLE';
  readonly limits: {
    readonly maximumRuntimeMs: number;
    readonly maximumMemoryBytes: number;
    readonly maximumCpuTimeMs: number;
    readonly maximumInputBytes: number;
    readonly maximumStdoutBytes: number;
    readonly maximumStderrBytes: number;
    readonly maximumChildProcesses: 0;
  };
  readonly platformPolicy:
    | {
        readonly kind: 'WIN32';
        readonly ownerReference: string;
        readonly reparsePoint: false;
      }
    | {
        readonly kind: 'LINUX';
        readonly ownerUid: number;
        readonly ownerGid: number;
        readonly mode: number;
        readonly symbolicLink: false;
      };
}

export interface TrustedSupervisorAdmissionEvidence {
  readonly schemaVersion: 2;
  readonly evidenceId: string;
  readonly workspaceId: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly manifestId: string;
  readonly manifestVersion: number;
  readonly authorizedManifestHash: string;
  readonly adapterKind: string;
  readonly platform: SupervisorPlatform;
  readonly testOnly: boolean;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly canonicalPath: string;
  readonly sha256: string;
  readonly identityReference: string;
  readonly authorizedWorktreeRoot: string;
  readonly argvHash: string;
  readonly argumentPolicyReference: string;
  readonly authorizationId: string;
  readonly authorizationVersion: number;
  readonly authorizationHash: string;
  readonly authorizationSignerKeyId: string;
  readonly authorizationValidFrom: string;
  readonly authorizationValidUntil: string;
  readonly authorizationSignature: string;
  readonly fileKind: 'REGULAR';
  readonly platformEvidence:
    | {
        readonly kind: 'WIN32';
        readonly ownerReference: string;
        readonly reparsePoint: false;
      }
    | {
        readonly kind: 'LINUX';
        readonly ownerUid: number;
        readonly ownerGid: number;
        readonly mode: number;
        readonly symbolicLink: false;
      };
}

export interface ValidatedSupervisorAdmission {
  readonly manifest: Readonly<RuntimeLaunchManifest>;
  readonly evidence: Readonly<TrustedSupervisorAdmissionEvidence>;
  readonly manifestHash: string;
  readonly evidenceHash: string;
  readonly bindingHash: string;
}

export interface ValidatedSupervisorManifest {
  readonly manifest: Readonly<RuntimeLaunchManifest>;
  readonly manifestHash: string;
  readonly argvHash: string;
}

export type SupervisorPolicyErrorCode =
  | 'INVALID_MANIFEST'
  | 'INVALID_EVIDENCE'
  | 'UNSAFE_PATH'
  | 'UNSAFE_ARGUMENT'
  | 'UNSAFE_LIMIT'
  | 'EVIDENCE_EXPIRED'
  | 'BINDING_MISMATCH'
  | 'TEST_ONLY_MISMATCH';

export class SupervisorPolicyError extends Error {
  constructor(readonly code: SupervisorPolicyErrorCode) {
    super(`Runtime supervision policy denied: ${code}`);
  }
}

const MANIFEST_KEYS = [
  'adapterKind',
  'argumentPolicyReference',
  'argv',
  'connectionId',
  'environmentVariableNames',
  'executable',
  'limits',
  'manifestId',
  'manifestVersion',
  'network',
  'platform',
  'platformPolicy',
  'protocol',
  'runtimeId',
  'schemaVersion',
  'secretTransport',
  'shell',
  'testOnly',
  'workingDirectory',
  'workspaceId',
  'worktreeRoot',
] as const;
const EVIDENCE_KEYS = [
  'adapterKind',
  'argumentPolicyReference',
  'authorizationHash',
  'authorizationId',
  'authorizationSignerKeyId',
  'authorizationSignature',
  'authorizationValidFrom',
  'authorizationValidUntil',
  'authorizationVersion',
  'argvHash',
  'authorizedWorktreeRoot',
  'authorizedManifestHash',
  'canonicalPath',
  'connectionId',
  'evidenceId',
  'expiresAt',
  'fileKind',
  'identityReference',
  'manifestId',
  'manifestVersion',
  'observedAt',
  'platform',
  'platformEvidence',
  'runtimeId',
  'schemaVersion',
  'sha256',
  'testOnly',
  'workspaceId',
] as const;

function object(
  value: unknown,
  keys: readonly string[],
  code: 'INVALID_MANIFEST' | 'INVALID_EVIDENCE',
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SupervisorPolicyError(code);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new SupervisorPolicyError(code);
  return record;
}

function reference(value: unknown, code: 'INVALID_MANIFEST' | 'INVALID_EVIDENCE'): string {
  if (
    typeof value !== 'string' ||
    !SAFE_REFERENCE.test(value) ||
    PRIVATE_TEXT.test(value) ||
    SECRET_LIKE.test(value)
  )
    throw new SupervisorPolicyError(code);
  return value;
}

function boolean(value: unknown, code: 'INVALID_MANIFEST' | 'INVALID_EVIDENCE'): boolean {
  if (typeof value !== 'boolean') throw new SupervisorPolicyError(code);
  return value;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  code: SupervisorPolicyErrorCode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    throw new SupervisorPolicyError(code);
  return value as number;
}

function digest(value: unknown, code: 'INVALID_MANIFEST' | 'INVALID_EVIDENCE'): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new SupervisorPolicyError(code);
  return value;
}

function canonicalPath(value: unknown, platform: SupervisorPlatform): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES)
    throw new SupervisorPolicyError('UNSAFE_PATH');
  if (PATH_CONTROL.test(value) || PRIVATE_TEXT.test(value) || SECRET_LIKE.test(value))
    throw new SupervisorPolicyError('UNSAFE_PATH');
  if (platform === 'WIN32') {
    if (
      !/^[A-Z]:\\/u.test(value) ||
      value.startsWith('\\\\') ||
      value.startsWith('\\\\?\\') ||
      value.startsWith('\\\\.\\') ||
      value.includes('/') ||
      value.slice(2).includes(':') ||
      WINDOWS_INVALID.test(value) ||
      win32.normalize(value) !== value
    )
      throw new SupervisorPolicyError('UNSAFE_PATH');
    const components = value.slice(3).split('\\');
    if (
      components.length === 0 ||
      components.some(
        (component) =>
          component.length === 0 ||
          component === '.' ||
          component === '..' ||
          component.endsWith('.') ||
          component.endsWith(' ') ||
          WINDOWS_RESERVED.test(component),
      )
    )
      throw new SupervisorPolicyError('UNSAFE_PATH');
    return value;
  }
  if (
    !posix.isAbsolute(value) ||
    value.startsWith('//') ||
    posix.normalize(value) !== value ||
    /^(?:\/dev|\/proc|\/sys)(?:\/|$)/u.test(value)
  )
    throw new SupervisorPolicyError('UNSAFE_PATH');
  const components = value.slice(1).split('/');
  if (
    components.length === 0 ||
    components.some(
      (component) => component.length === 0 || component === '.' || component === '..',
    )
  )
    throw new SupervisorPolicyError('UNSAFE_PATH');
  return value;
}

function contained(platform: SupervisorPlatform, root: string, candidate: string): boolean {
  const implementation = platform === 'WIN32' ? win32 : posix;
  const relative = implementation.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !implementation.isAbsolute(relative));
}

function argumentsList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_ARGUMENTS)
    throw new SupervisorPolicyError('UNSAFE_ARGUMENT');
  const keys = Object.keys(value);
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index)))
    throw new SupervisorPolicyError('UNSAFE_ARGUMENT');
  let total = 0;
  return value.map((argument) => {
    if (typeof argument !== 'string') throw new SupervisorPolicyError('UNSAFE_ARGUMENT');
    const bytes = Buffer.byteLength(argument, 'utf8');
    total += bytes;
    if (
      bytes === 0 ||
      bytes > MAX_ARGUMENT_BYTES ||
      total > MAX_ARGUMENT_TOTAL_BYTES ||
      SHELL_SYNTAX.test(argument) ||
      SENSITIVE_SWITCH.test(argument) ||
      PRIVATE_TEXT.test(argument) ||
      SECRET_LIKE.test(argument)
    )
      throw new SupervisorPolicyError('UNSAFE_ARGUMENT');
    return argument;
  });
}

function executableBasename(platform: SupervisorPlatform, executablePath: string): string {
  return (platform === 'WIN32' ? win32 : posix).basename(executablePath);
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new SupervisorPolicyError('INVALID_EVIDENCE');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    throw new SupervisorPolicyError('INVALID_EVIDENCE');
  return value;
}

function platformPolicy(
  value: unknown,
  platform: SupervisorPlatform,
  code: 'INVALID_MANIFEST' | 'INVALID_EVIDENCE',
): RuntimeLaunchManifest['platformPolicy'] {
  if (platform === 'WIN32') {
    const record = object(value, ['kind', 'ownerReference', 'reparsePoint'], code);
    if (record.kind !== 'WIN32' || record.reparsePoint !== false)
      throw new SupervisorPolicyError(code);
    return {
      kind: 'WIN32',
      ownerReference: reference(record.ownerReference, code),
      reparsePoint: false,
    };
  }
  const record = object(value, ['kind', 'mode', 'ownerGid', 'ownerUid', 'symbolicLink'], code);
  if (record.kind !== 'LINUX' || record.symbolicLink !== false)
    throw new SupervisorPolicyError(code);
  const mode = integer(record.mode, 0, 0o777, code);
  if ((mode & 0o222) !== 0 || (mode & 0o111) === 0) throw new SupervisorPolicyError(code);
  return {
    kind: 'LINUX',
    ownerUid: integer(record.ownerUid, 0, 2_147_483_647, code),
    ownerGid: integer(record.ownerGid, 0, 2_147_483_647, code),
    mode,
    symbolicLink: false,
  };
}

function parseManifest(value: unknown): RuntimeLaunchManifest {
  const record = object(value, MANIFEST_KEYS, 'INVALID_MANIFEST');
  if (record.schemaVersion !== 1) throw new SupervisorPolicyError('INVALID_MANIFEST');
  if (record.platform !== 'WIN32' && record.platform !== 'LINUX')
    throw new SupervisorPolicyError('INVALID_MANIFEST');
  const platform = record.platform;
  const executable = object(
    record.executable,
    ['canonicalPath', 'identityReference', 'sha256'],
    'INVALID_MANIFEST',
  );
  const limits = object(
    record.limits,
    [
      'maximumChildProcesses',
      'maximumCpuTimeMs',
      'maximumInputBytes',
      'maximumMemoryBytes',
      'maximumRuntimeMs',
      'maximumStderrBytes',
      'maximumStdoutBytes',
    ],
    'INVALID_MANIFEST',
  );
  const testOnly = boolean(record.testOnly, 'INVALID_MANIFEST');
  const adapterKind = reference(record.adapterKind, 'INVALID_MANIFEST');
  if ((adapterKind === 'DETERMINISTIC_FAKE') !== testOnly)
    throw new SupervisorPolicyError('TEST_ONLY_MISMATCH');
  if (record.protocol !== 'JSONL_STDIO' || record.network !== 'DENY' || record.shell !== false)
    throw new SupervisorPolicyError('INVALID_MANIFEST');
  if (!Array.isArray(record.environmentVariableNames) || record.environmentVariableNames.length > 0)
    throw new SupervisorPolicyError('INVALID_MANIFEST');
  if (record.secretTransport !== 'NONE' && record.secretTransport !== 'INHERITED_HANDLE')
    throw new SupervisorPolicyError('INVALID_MANIFEST');
  const executablePath = canonicalPath(executable.canonicalPath, platform);
  if (platform === 'WIN32' && !executablePath.toLowerCase().endsWith('.exe'))
    throw new SupervisorPolicyError('UNSAFE_PATH');
  if (DENIED_EXECUTABLE_BASENAME.test(executableBasename(platform, executablePath)))
    throw new SupervisorPolicyError('UNSAFE_PATH');
  const worktreeRoot = canonicalPath(record.worktreeRoot, platform);
  const workingDirectory = canonicalPath(record.workingDirectory, platform);
  if (!contained(platform, worktreeRoot, workingDirectory))
    throw new SupervisorPolicyError('UNSAFE_PATH');
  const maximumRuntimeMs = integer(limits.maximumRuntimeMs, 1_000, 30 * 60 * 1_000, 'UNSAFE_LIMIT');
  const maximumCpuTimeMs = integer(
    limits.maximumCpuTimeMs,
    1_000,
    maximumRuntimeMs,
    'UNSAFE_LIMIT',
  );
  if (limits.maximumChildProcesses !== 0) throw new SupervisorPolicyError('UNSAFE_LIMIT');
  return {
    schemaVersion: 1,
    manifestId: reference(record.manifestId, 'INVALID_MANIFEST'),
    manifestVersion: integer(record.manifestVersion, 1, 1_000_000, 'INVALID_MANIFEST'),
    workspaceId: reference(record.workspaceId, 'INVALID_MANIFEST'),
    runtimeId: reference(record.runtimeId, 'INVALID_MANIFEST'),
    connectionId: reference(record.connectionId, 'INVALID_MANIFEST'),
    adapterKind,
    platform,
    testOnly,
    executable: {
      canonicalPath: executablePath,
      sha256: digest(executable.sha256, 'INVALID_MANIFEST'),
      identityReference: reference(executable.identityReference, 'INVALID_MANIFEST'),
    },
    argv: argumentsList(record.argv),
    argumentPolicyReference: reference(record.argumentPolicyReference, 'INVALID_MANIFEST'),
    worktreeRoot,
    workingDirectory,
    protocol: 'JSONL_STDIO',
    network: 'DENY',
    shell: false,
    environmentVariableNames: [],
    secretTransport: record.secretTransport,
    limits: {
      maximumRuntimeMs,
      maximumMemoryBytes: integer(
        limits.maximumMemoryBytes,
        16 * 1_024 * 1_024,
        4 * 1_024 * 1_024 * 1_024,
        'UNSAFE_LIMIT',
      ),
      maximumCpuTimeMs,
      maximumInputBytes: integer(limits.maximumInputBytes, 1, 16 * 1_024 * 1_024, 'UNSAFE_LIMIT'),
      maximumStdoutBytes: integer(limits.maximumStdoutBytes, 1, 16 * 1_024 * 1_024, 'UNSAFE_LIMIT'),
      maximumStderrBytes: integer(limits.maximumStderrBytes, 1, 4 * 1_024 * 1_024, 'UNSAFE_LIMIT'),
      maximumChildProcesses: 0,
    },
    platformPolicy: platformPolicy(record.platformPolicy, platform, 'INVALID_MANIFEST'),
  };
}

function parseEvidence(
  value: unknown,
  authorizationVerifier: LinuxExecutableAuthorizationVerifier,
): TrustedSupervisorAdmissionEvidence {
  const record = object(value, EVIDENCE_KEYS, 'INVALID_EVIDENCE');
  if (record.schemaVersion !== 2) throw new SupervisorPolicyError('INVALID_EVIDENCE');
  if (record.platform !== 'WIN32' && record.platform !== 'LINUX')
    throw new SupervisorPolicyError('INVALID_EVIDENCE');
  if (record.fileKind !== 'REGULAR') throw new SupervisorPolicyError('INVALID_EVIDENCE');
  const evidence: TrustedSupervisorAdmissionEvidence = {
    schemaVersion: 2,
    evidenceId: reference(record.evidenceId, 'INVALID_EVIDENCE'),
    workspaceId: reference(record.workspaceId, 'INVALID_EVIDENCE'),
    runtimeId: reference(record.runtimeId, 'INVALID_EVIDENCE'),
    connectionId: reference(record.connectionId, 'INVALID_EVIDENCE'),
    manifestId: reference(record.manifestId, 'INVALID_EVIDENCE'),
    manifestVersion: integer(record.manifestVersion, 1, 1_000_000, 'INVALID_EVIDENCE'),
    authorizedManifestHash: digest(record.authorizedManifestHash, 'INVALID_EVIDENCE'),
    adapterKind: reference(record.adapterKind, 'INVALID_EVIDENCE'),
    platform: record.platform,
    testOnly: boolean(record.testOnly, 'INVALID_EVIDENCE'),
    observedAt: timestamp(record.observedAt),
    expiresAt: timestamp(record.expiresAt),
    canonicalPath: canonicalPath(record.canonicalPath, record.platform),
    sha256: digest(record.sha256, 'INVALID_EVIDENCE'),
    identityReference: reference(record.identityReference, 'INVALID_EVIDENCE'),
    authorizedWorktreeRoot: canonicalPath(record.authorizedWorktreeRoot, record.platform),
    argvHash: digest(record.argvHash, 'INVALID_EVIDENCE'),
    argumentPolicyReference: reference(record.argumentPolicyReference, 'INVALID_EVIDENCE'),
    authorizationId: reference(record.authorizationId, 'INVALID_EVIDENCE'),
    authorizationVersion: integer(record.authorizationVersion, 1, 1_000_000, 'INVALID_EVIDENCE'),
    authorizationHash: digest(record.authorizationHash, 'INVALID_EVIDENCE'),
    authorizationSignerKeyId: reference(record.authorizationSignerKeyId, 'INVALID_EVIDENCE'),
    authorizationValidFrom: timestamp(record.authorizationValidFrom),
    authorizationValidUntil: timestamp(record.authorizationValidUntil),
    authorizationSignature:
      typeof record.authorizationSignature === 'string'
        ? record.authorizationSignature
        : (() => {
            throw new SupervisorPolicyError('INVALID_EVIDENCE');
          })(),
    fileKind: 'REGULAR',
    platformEvidence: platformPolicy(record.platformEvidence, record.platform, 'INVALID_EVIDENCE'),
  };
  if (evidence.platform === 'LINUX' && evidence.platformEvidence.kind === 'LINUX') {
    try {
      const authorization = authorizationVerifier.verify({
        schemaVersion: 1,
        authorizationId: evidence.authorizationId,
        authorizationVersion: evidence.authorizationVersion,
        signerKeyId: evidence.authorizationSignerKeyId,
        validFrom: evidence.authorizationValidFrom,
        validUntil: evidence.authorizationValidUntil,
        adapterKind: evidence.adapterKind,
        testOnly: evidence.testOnly,
        canonicalPath: evidence.canonicalPath,
        sha256: evidence.sha256,
        identityReference: evidence.identityReference,
        ownerUid: evidence.platformEvidence.ownerUid,
        ownerGid: evidence.platformEvidence.ownerGid,
        mode: evidence.platformEvidence.mode,
        authorizedWorktreeRoot: evidence.authorizedWorktreeRoot,
        argumentPolicyReference: evidence.argumentPolicyReference,
        signature: evidence.authorizationSignature,
      });
      if (linuxExecutableAuthorizationHash(authorization) !== evidence.authorizationHash)
        throw new Error('authorization hash mismatch');
    } catch {
      throw new SupervisorPolicyError('INVALID_EVIDENCE');
    }
  } else if (evidence.adapterKind !== 'DETERMINISTIC_FAKE' || evidence.testOnly !== true) {
    throw new SupervisorPolicyError('INVALID_EVIDENCE');
  }
  return evidence;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function frozen<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) frozen(child);
  return Object.freeze(value);
}

function validateSupervisorAdmissionUsing(
  manifestInput: unknown,
  evidenceInput: unknown,
  authorizationVerifier: LinuxExecutableAuthorizationVerifier,
): ValidatedSupervisorAdmission {
  const validatedManifest = validateSupervisorManifest(manifestInput);
  const manifest = validatedManifest.manifest;
  const evidence = parseEvidence(evidenceInput, authorizationVerifier);
  const manifestHash = validatedManifest.manifestHash;
  const observedAt = new Date(evidence.observedAt).getTime();
  const expiresAt = new Date(evidence.expiresAt).getTime();
  const nowMs = Date.now();
  if (
    !Number.isFinite(nowMs) ||
    observedAt > nowMs + MAX_CLOCK_SKEW_MS ||
    expiresAt <= nowMs ||
    expiresAt <= observedAt ||
    expiresAt - observedAt > MAX_EVIDENCE_LIFETIME_MS
  )
    throw new SupervisorPolicyError('EVIDENCE_EXPIRED');
  if (manifest.testOnly !== evidence.testOnly)
    throw new SupervisorPolicyError('TEST_ONLY_MISMATCH');
  if (
    manifest.workspaceId !== evidence.workspaceId ||
    manifest.runtimeId !== evidence.runtimeId ||
    manifest.connectionId !== evidence.connectionId ||
    manifest.manifestId !== evidence.manifestId ||
    manifest.manifestVersion !== evidence.manifestVersion ||
    manifestHash !== evidence.authorizedManifestHash ||
    manifest.adapterKind !== evidence.adapterKind ||
    manifest.platform !== evidence.platform ||
    manifest.worktreeRoot !== evidence.authorizedWorktreeRoot ||
    validatedManifest.argvHash !== evidence.argvHash ||
    manifest.argumentPolicyReference !== evidence.argumentPolicyReference ||
    manifest.executable.canonicalPath !== evidence.canonicalPath ||
    manifest.executable.sha256 !== evidence.sha256 ||
    manifest.executable.identityReference !== evidence.identityReference ||
    canonicalJson(manifest.platformPolicy) !== canonicalJson(evidence.platformEvidence)
  )
    throw new SupervisorPolicyError('BINDING_MISMATCH');
  const evidenceHash = sha256(evidence);
  return frozen({
    manifest,
    evidence,
    manifestHash,
    evidenceHash,
    bindingHash: sha256({
      schemaVersion: 1,
      workspaceId: manifest.workspaceId,
      runtimeId: manifest.runtimeId,
      connectionId: manifest.connectionId,
      authorizationId: evidence.authorizationId,
      authorizationVersion: evidence.authorizationVersion,
      authorizationHash: evidence.authorizationHash,
      authorizationSignerKeyId: evidence.authorizationSignerKeyId,
      manifestHash,
      evidenceHash,
    }),
  });
}

/** Backward-compatible deterministic test validator. */
export function validateSupervisorAdmission(
  manifestInput: unknown,
  evidenceInput: unknown,
): ValidatedSupervisorAdmission {
  return validateSupervisorAdmissionUsing(
    manifestInput,
    evidenceInput,
    new TestOnlyLinuxExecutableAuthorizationVerifier(),
  );
}

/** Admission validation with an explicit trusted authorization verifier. */
export function validateSupervisorAdmissionWithAuthorizationVerifier(
  manifestInput: unknown,
  evidenceInput: unknown,
  authorizationVerifier: LinuxExecutableAuthorizationVerifier,
): ValidatedSupervisorAdmission {
  return validateSupervisorAdmissionUsing(manifestInput, evidenceInput, authorizationVerifier);
}

export function validateSupervisorManifest(manifestInput: unknown): ValidatedSupervisorManifest {
  const manifest = parseManifest(manifestInput);
  return frozen({
    manifest,
    manifestHash: sha256(manifest),
    argvHash: sha256(manifest.argv),
  });
}
