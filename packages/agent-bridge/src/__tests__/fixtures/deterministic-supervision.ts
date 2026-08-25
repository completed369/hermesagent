import { createHash } from 'node:crypto';

import { canonicalJson } from '../../codec';
import type {
  RuntimeLaunchManifest,
  TrustedSupervisorAdmissionEvidence,
} from '../../supervision-policy';

const digest = '7'.repeat(64);
const hash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export function deterministicLinuxAdmission(): {
  manifest: RuntimeLaunchManifest;
  evidence: TrustedSupervisorAdmissionEvidence;
  now: Date;
} {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const manifest: RuntimeLaunchManifest = {
    schemaVersion: 1,
    manifestId: 'fixture-linux-v1',
    manifestVersion: 1,
    workspaceId: 'workspace-fixture',
    runtimeId: 'runtime-fixture',
    connectionId: 'connection-fixture',
    adapterKind: 'DETERMINISTIC_FAKE',
    platform: 'LINUX',
    testOnly: true,
    executable: {
      canonicalPath: '/opt/ventureos/fixtures/runtime-fixture',
      sha256: digest,
      identityReference: 'device-7:inode-11',
    },
    argv: ['--mode', 'jsonl-fixture'],
    argumentPolicyReference: 'fixture-arguments-v1',
    worktreeRoot: '/workspaces/ventureos-fixture',
    workingDirectory: '/workspaces/ventureos-fixture/task-one',
    protocol: 'JSONL_STDIO',
    network: 'DENY',
    shell: false,
    environmentVariableNames: [],
    secretTransport: 'NONE',
    limits: {
      maximumRuntimeMs: 60_000,
      maximumMemoryBytes: 128 * 1_024 * 1_024,
      maximumCpuTimeMs: 30_000,
      maximumInputBytes: 1_024 * 1_024,
      maximumStdoutBytes: 1_024 * 1_024,
      maximumStderrBytes: 256 * 1_024,
      maximumChildProcesses: 0,
    },
    platformPolicy: {
      kind: 'LINUX',
      ownerUid: 10_001,
      ownerGid: 10_001,
      mode: 0o500,
      symbolicLink: false,
    },
  };
  return {
    now,
    manifest,
    evidence: {
      schemaVersion: 1,
      evidenceId: 'fixture-linux-evidence-v1',
      workspaceId: manifest.workspaceId,
      runtimeId: manifest.runtimeId,
      connectionId: manifest.connectionId,
      manifestId: manifest.manifestId,
      manifestVersion: manifest.manifestVersion,
      authorizedManifestHash: hash(manifest),
      adapterKind: manifest.adapterKind,
      platform: manifest.platform,
      testOnly: true,
      observedAt: '2026-08-25T23:59:55.000Z',
      expiresAt: '2026-08-26T00:01:00.000Z',
      canonicalPath: manifest.executable.canonicalPath,
      sha256: manifest.executable.sha256,
      identityReference: manifest.executable.identityReference,
      authorizedWorktreeRoot: manifest.worktreeRoot,
      argvHash: hash(manifest.argv),
      argumentPolicyReference: manifest.argumentPolicyReference,
      fileKind: 'REGULAR',
      platformEvidence: manifest.platformPolicy,
    },
  };
}

export function deterministicWindowsAdmission(): {
  manifest: RuntimeLaunchManifest;
  evidence: TrustedSupervisorAdmissionEvidence;
  now: Date;
} {
  const linux = deterministicLinuxAdmission();
  const manifest: RuntimeLaunchManifest = {
    ...linux.manifest,
    manifestId: 'fixture-windows-v1',
    platform: 'WIN32',
    executable: {
      canonicalPath: 'C:\\VentureOS\\Fixtures\\runtime-fixture.exe',
      sha256: digest,
      identityReference: 'volume-7:file-11',
    },
    worktreeRoot: 'C:\\VentureOS\\Worktrees\\fixture',
    workingDirectory: 'C:\\VentureOS\\Worktrees\\fixture\\task-one',
    platformPolicy: {
      kind: 'WIN32',
      ownerReference: 'service-principal-fixture',
      reparsePoint: false,
    },
  };
  return {
    now: linux.now,
    manifest,
    evidence: {
      ...linux.evidence,
      evidenceId: 'fixture-windows-evidence-v1',
      manifestId: manifest.manifestId,
      authorizedManifestHash: hash(manifest),
      platform: 'WIN32',
      canonicalPath: manifest.executable.canonicalPath,
      sha256: manifest.executable.sha256,
      identityReference: manifest.executable.identityReference,
      authorizedWorktreeRoot: manifest.worktreeRoot,
      platformEvidence: manifest.platformPolicy,
    },
  };
}
