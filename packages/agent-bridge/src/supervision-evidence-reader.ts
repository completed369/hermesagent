import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';

import {
  type LinuxExecutableAuthorization,
  linuxExecutableAuthorizationHash,
  validateLinuxExecutableAuthorization,
} from './supervision-authorization';
import {
  type RuntimeLaunchManifest,
  type TrustedSupervisorAdmissionEvidence,
  validateSupervisorAdmission,
  validateSupervisorManifest,
} from './supervision-policy';

const MAX_EXECUTABLE_BYTES = 256 * 1_024 * 1_024;
const EVIDENCE_LIFETIME_MS = 60_000;

export type SupervisorEvidenceReaderErrorCode =
  | 'UNSUPPORTED_PLATFORM'
  | 'INVALID_AUTHORIZATION'
  | 'AUTHORIZATION_NOT_FOUND'
  | 'UNSAFE_EXECUTABLE'
  | 'IDENTITY_MISMATCH'
  | 'DIGEST_MISMATCH';

export class SupervisorEvidenceReaderError extends Error {
  constructor(readonly code: SupervisorEvidenceReaderErrorCode) {
    super(`Runtime executable evidence denied: ${code}`);
  }
}

function linuxIdentity(device: bigint, inode: bigint): string {
  return `linux:dev-${device.toString(16)}:ino-${inode.toString(16)}`;
}

async function digestOpenedFile(handle: fs.FileHandle): Promise<string> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1_024);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

export function validatedLinuxInspectionFlags(input: {
  readonly O_RDONLY?: unknown;
  readonly O_NOFOLLOW?: unknown;
  readonly O_NONBLOCK?: unknown;
}): number {
  if (
    !Number.isInteger(input.O_RDONLY) ||
    (input.O_RDONLY as number) < 0 ||
    !Number.isInteger(input.O_NOFOLLOW) ||
    (input.O_NOFOLLOW as number) <= 0 ||
    !Number.isInteger(input.O_NONBLOCK) ||
    (input.O_NONBLOCK as number) <= 0
  )
    throw new SupervisorEvidenceReaderError('UNSUPPORTED_PLATFORM');
  return (input.O_RDONLY as number) | (input.O_NOFOLLOW as number) | (input.O_NONBLOCK as number);
}

export class LinuxExecutableEvidenceReader {
  private readonly authorizations: ReadonlyMap<string, Readonly<LinuxExecutableAuthorization>>;

  constructor(authorizations: readonly unknown[]) {
    let parsed: Readonly<LinuxExecutableAuthorization>[];
    try {
      parsed = authorizations.map(validateLinuxExecutableAuthorization);
    } catch {
      throw new SupervisorEvidenceReaderError('INVALID_AUTHORIZATION');
    }
    const byAdapter = new Map<string, Readonly<LinuxExecutableAuthorization>>();
    for (const authorization of parsed) {
      if (byAdapter.has(authorization.adapterKind))
        throw new SupervisorEvidenceReaderError('INVALID_AUTHORIZATION');
      byAdapter.set(authorization.adapterKind, authorization);
    }
    this.authorizations = byAdapter;
  }

  async read(manifestInput: unknown): Promise<Readonly<TrustedSupervisorAdmissionEvidence>> {
    if (process.platform !== 'linux')
      throw new SupervisorEvidenceReaderError('UNSUPPORTED_PLATFORM');
    const validated = validateSupervisorManifest(manifestInput);
    const manifest = validated.manifest;
    if (manifest.platform !== 'LINUX')
      throw new SupervisorEvidenceReaderError('UNSUPPORTED_PLATFORM');
    const storedAuthorization = this.authorizations.get(manifest.adapterKind);
    if (!storedAuthorization) throw new SupervisorEvidenceReaderError('AUTHORIZATION_NOT_FOUND');
    let authorization: Readonly<LinuxExecutableAuthorization>;
    try {
      authorization = validateLinuxExecutableAuthorization(storedAuthorization);
    } catch {
      throw new SupervisorEvidenceReaderError('INVALID_AUTHORIZATION');
    }
    this.assertManifestAuthorization(manifest, authorization);

    const inspectionFlags = validatedLinuxInspectionFlags(constants);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(manifest.executable.canonicalPath, inspectionFlags);
      const [stat, resolvedPath] = await Promise.all([
        handle.stat({ bigint: true }),
        fs.realpath(manifest.executable.canonicalPath),
      ]);
      if (
        !stat.isFile() ||
        stat.size <= 0n ||
        stat.size > BigInt(MAX_EXECUTABLE_BYTES) ||
        resolvedPath !== manifest.executable.canonicalPath
      )
        throw new SupervisorEvidenceReaderError('UNSAFE_EXECUTABLE');
      const mode = Number(stat.mode & 0o7777n);
      const identityReference = linuxIdentity(stat.dev, stat.ino);
      if (mode > 0o777 || (mode & 0o222) !== 0 || (mode & 0o111) === 0)
        throw new SupervisorEvidenceReaderError('UNSAFE_EXECUTABLE');
      if (
        Number(stat.uid) !== authorization.ownerUid ||
        Number(stat.gid) !== authorization.ownerGid ||
        mode !== authorization.mode ||
        identityReference !== authorization.identityReference ||
        identityReference !== manifest.executable.identityReference
      )
        throw new SupervisorEvidenceReaderError('IDENTITY_MISMATCH');
      const sha256 = await digestOpenedFile(handle);
      if (sha256 !== authorization.sha256 || sha256 !== manifest.executable.sha256)
        throw new SupervisorEvidenceReaderError('DIGEST_MISMATCH');
      const [finalStat, currentPathStat, finalResolvedPath] = await Promise.all([
        handle.stat({ bigint: true }),
        fs.lstat(manifest.executable.canonicalPath, { bigint: true }),
        fs.realpath(manifest.executable.canonicalPath),
      ]);
      if (
        finalStat.dev !== stat.dev ||
        finalStat.ino !== stat.ino ||
        finalStat.uid !== stat.uid ||
        finalStat.gid !== stat.gid ||
        finalStat.mode !== stat.mode ||
        finalStat.size !== stat.size ||
        finalStat.mtimeNs !== stat.mtimeNs ||
        finalStat.ctimeNs !== stat.ctimeNs ||
        !currentPathStat.isFile() ||
        currentPathStat.isSymbolicLink() ||
        currentPathStat.dev !== finalStat.dev ||
        currentPathStat.ino !== finalStat.ino ||
        finalResolvedPath !== manifest.executable.canonicalPath
      )
        throw new SupervisorEvidenceReaderError('IDENTITY_MISMATCH');
      const observedAtMilliseconds = Date.now();
      const authorizationExpiryMilliseconds = Date.parse(authorization.validUntil);
      const expiresAtMilliseconds = Math.min(
        observedAtMilliseconds + EVIDENCE_LIFETIME_MS,
        authorizationExpiryMilliseconds,
      );
      if (expiresAtMilliseconds <= observedAtMilliseconds)
        throw new SupervisorEvidenceReaderError('INVALID_AUTHORIZATION');
      const observedAt = new Date(observedAtMilliseconds).toISOString();
      const expiresAt = new Date(expiresAtMilliseconds).toISOString();
      const evidence: TrustedSupervisorAdmissionEvidence = {
        schemaVersion: 2,
        evidenceId: `evidence-${randomUUID()}`,
        workspaceId: manifest.workspaceId,
        runtimeId: manifest.runtimeId,
        connectionId: manifest.connectionId,
        manifestId: manifest.manifestId,
        manifestVersion: manifest.manifestVersion,
        authorizedManifestHash: validated.manifestHash,
        adapterKind: manifest.adapterKind,
        platform: 'LINUX',
        testOnly: manifest.testOnly,
        observedAt,
        expiresAt,
        canonicalPath: manifest.executable.canonicalPath,
        sha256,
        identityReference,
        authorizedWorktreeRoot: manifest.worktreeRoot,
        argvHash: validated.argvHash,
        argumentPolicyReference: manifest.argumentPolicyReference,
        authorizationId: authorization.authorizationId,
        authorizationVersion: authorization.authorizationVersion,
        authorizationHash: linuxExecutableAuthorizationHash(authorization),
        authorizationSignerKeyId: authorization.signerKeyId,
        authorizationValidFrom: authorization.validFrom,
        authorizationValidUntil: authorization.validUntil,
        authorizationSignature: authorization.signature,
        fileKind: 'REGULAR',
        platformEvidence: {
          kind: 'LINUX',
          ownerUid: Number(finalStat.uid),
          ownerGid: Number(finalStat.gid),
          mode,
          symbolicLink: false,
        },
      };
      return validateSupervisorAdmission(manifest, evidence).evidence;
    } catch (error) {
      if (error instanceof SupervisorEvidenceReaderError) throw error;
      throw new SupervisorEvidenceReaderError('UNSAFE_EXECUTABLE');
    } finally {
      await handle?.close();
    }
  }

  private assertManifestAuthorization(
    manifest: Readonly<RuntimeLaunchManifest>,
    authorization: Readonly<LinuxExecutableAuthorization>,
  ): void {
    if (
      manifest.testOnly !== authorization.testOnly ||
      manifest.executable.canonicalPath !== authorization.canonicalPath ||
      manifest.executable.sha256 !== authorization.sha256 ||
      manifest.executable.identityReference !== authorization.identityReference ||
      manifest.worktreeRoot !== authorization.authorizedWorktreeRoot ||
      manifest.argumentPolicyReference !== authorization.argumentPolicyReference ||
      manifest.platformPolicy.kind !== 'LINUX' ||
      manifest.platformPolicy.ownerUid !== authorization.ownerUid ||
      manifest.platformPolicy.ownerGid !== authorization.ownerGid ||
      manifest.platformPolicy.mode !== authorization.mode
    )
      throw new SupervisorEvidenceReaderError('IDENTITY_MISMATCH');
  }
}
