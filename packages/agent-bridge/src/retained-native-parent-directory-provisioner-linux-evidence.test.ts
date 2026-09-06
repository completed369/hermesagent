import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant,
  type LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash,
} from './retained-native-supervisor-linux-parent-directory-provisioner';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;

describeLinux('retained-descriptor Linux parent-directory provisioner evidence', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(label: string): {
    readonly outer: string;
    readonly request: LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest;
  } {
    const outer = mkdtempSync(join(tmpdir(), `ventureos-parent-${label}-`));
    roots.push(outer);
    const runtimeRoot = join(outer, 'runtime');
    mkdirSync(runtimeRoot, { mode: 0o700 });
    chmodSync(runtimeRoot, 0o700);
    const stat = lstatSync(runtimeRoot);
    return {
      outer,
      request: {
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_PARENT_DIRECTORIES_PROVISION',
        workspaceId: 'workspace-linux-evidence',
        supervisorInstanceId: 'supervisor-linux-evidence',
        platform: 'LINUX',
        architecture: 'X64',
        runtimeRoot,
        runtimeRootIdentityReference: `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`,
        runtimeRootOwnerUid: stat.uid,
        runtimeRootOwnerGid: stat.gid,
        runtimeRootMode: 0o700,
        moduleDirectory: join(runtimeRoot, 'native'),
        socketDirectoryParent: join(runtimeRoot, 'run'),
        socketDirectory: join(runtimeRoot, 'run', 'supervisor'),
        ownerUid: stat.uid,
        ownerGid: stat.gid,
        runtimeConnection: 'NOT_CONFIGURED',
      },
    };
  }

  function grant(
    request: LinuxRetainedNativeSupervisorParentDirectoryProvisionRequest,
  ): LinuxRetainedNativeSupervisorParentDirectoryProvisionGrant {
    const now = Date.now();
    return {
      ...request,
      provisioningId: 'parent-provision-linux-evidence',
      requestHash: linuxRetainedNativeSupervisorParentDirectoryProvisionRequestHash(request),
      approvalId: 'level3-control-plane:linux-evidence',
      approvalEvidenceHash: 'a'.repeat(64),
      authorizedByReference: 'linux-evidence-authority',
      authorityLevel: 3,
      validFrom: new Date(now - 1_000).toISOString(),
      validUntil: new Date(now + 60_000).toISOString(),
    };
  }

  it('creates the exact owner-only native/run/supervisor hierarchy and returns retained identities', async () => {
    const { request } = fixture('success');
    const result = await createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner({
      authorize: async () => grant(request),
    }).provision(request, new AbortController().signal);

    const moduleStat = lstatSync(request.moduleDirectory);
    const socketStat = lstatSync(request.socketDirectoryParent);
    const endpointStat = lstatSync(request.socketDirectory);
    expect(result).toMatchObject({
      moduleDirectoryIdentityReference: `linux:dev-${moduleStat.dev.toString(16)}:ino-${moduleStat.ino.toString(16)}`,
      socketDirectoryParentIdentityReference: `linux:dev-${socketStat.dev.toString(16)}:ino-${socketStat.ino.toString(16)}`,
      socketDirectoryIdentityReference: `linux:dev-${endpointStat.dev.toString(16)}:ino-${endpointStat.ino.toString(16)}`,
      directoryMode: 0o700,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(moduleStat.mode & 0o777).toBe(0o700);
    expect(socketStat.mode & 0o777).toBe(0o700);
    expect(endpointStat.mode & 0o777).toBe(0o700);
  });

  it('denies a symlinked retained root without creating through it', async () => {
    const { outer, request } = fixture('symlink');
    const link = join(outer, 'linked-runtime');
    symlinkSync(request.runtimeRoot, link);
    const linked = {
      ...request,
      runtimeRoot: link,
      moduleDirectory: join(link, 'native'),
      socketDirectoryParent: join(link, 'run'),
      socketDirectory: join(link, 'run', 'supervisor'),
    };
    await expect(
      createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner({
        authorize: async () => grant(linked),
      }).provision(linked, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(existsSync(request.moduleDirectory)).toBe(false);
    expect(existsSync(request.socketDirectoryParent)).toBe(false);
    expect(existsSync(request.socketDirectory)).toBe(false);
  });

  it('denies a non-owner-only root before creating either child', async () => {
    const { request } = fixture('unsafe-mode');
    chmodSync(request.runtimeRoot, 0o750);
    await expect(
      createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner({
        authorize: async () => grant(request),
      }).provision(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(existsSync(request.moduleDirectory)).toBe(false);
    expect(existsSync(request.socketDirectoryParent)).toBe(false);
    expect(existsSync(request.socketDirectory)).toBe(false);
  });

  it('never replaces an existing child and cleans only its retained empty sibling', async () => {
    const { request } = fixture('existing-run');
    mkdirSync(request.socketDirectoryParent, { mode: 0o700 });
    await expect(
      createRetainedDescriptorLinuxNativeSupervisorParentDirectoryProvisioner({
        authorize: async () => grant(request),
      }).provision(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(existsSync(request.moduleDirectory)).toBe(false);
    expect(lstatSync(request.socketDirectoryParent).isDirectory()).toBe(true);
  });
});
