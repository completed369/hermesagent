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
  createRetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner,
  type LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant,
  type LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest,
  linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash,
} from './retained-native-supervisor-linux-runtime-root-provisioner';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;

describeLinux('retained-descriptor Linux runtime-root provisioner evidence', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(label: string): {
    readonly outer: string;
    readonly request: LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest;
  } {
    const outer = mkdtempSync(join(tmpdir(), `ventureos-runtime-root-${label}-`));
    roots.push(outer);
    const parent = join(outer, 'supervisor-one');
    mkdirSync(parent, { mode: 0o700 });
    chmodSync(parent, 0o700);
    const stat = lstatSync(parent);
    return {
      outer,
      request: {
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION',
        workspaceId: 'workspace-linux-evidence',
        supervisorInstanceId: 'supervisor-linux-evidence',
        provisioningAttemptId: 'attempt-0001',
        platform: 'LINUX',
        architecture: 'X64',
        runtimeRootParent: parent,
        runtimeRootParentIdentityReference: `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`,
        runtimeRootParentOwnerUid: stat.uid,
        runtimeRootParentOwnerGid: stat.gid,
        runtimeRootParentMode: 0o700,
        runtimeRoot: join(parent, 'attempt-0001'),
        ownerUid: stat.uid,
        ownerGid: stat.gid,
        runtimeConnection: 'NOT_CONFIGURED',
      },
    };
  }

  function grant(
    request: LinuxRetainedNativeSupervisorRuntimeRootProvisionRequest,
  ): LinuxRetainedNativeSupervisorRuntimeRootProvisionGrant {
    const now = Date.now();
    return {
      ...request,
      provisioningId: 'runtime-root-linux-evidence',
      requestHash: linuxRetainedNativeSupervisorRuntimeRootProvisionRequestHash(request),
      approvalId: 'level3-control-plane:linux-evidence',
      approvalEvidenceHash: 'a'.repeat(64),
      authorizedByReference: 'linux-evidence-authority',
      authorityLevel: 3,
      validFrom: new Date(now - 1_000).toISOString(),
      validUntil: new Date(now + 60_000).toISOString(),
    };
  }

  it('creates only the exact absent owner-only attempt root and returns its retained identity', async () => {
    const { request } = fixture('success');
    const result = await createRetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner({
      authorize: async () => grant(request),
    }).provision(request, new AbortController().signal);
    const stat = lstatSync(request.runtimeRoot);
    expect(result).toMatchObject({
      provisioningAttemptId: request.provisioningAttemptId,
      runtimeRootIdentityReference: `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`,
      directoryMode: 0o700,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it('denies a symlinked or non-owner-only parent without creating through it', async () => {
    const { outer, request } = fixture('unsafe-parent');
    const link = join(outer, 'linked-parent');
    symlinkSync(request.runtimeRootParent, link);
    const linked = {
      ...request,
      runtimeRootParent: link,
      runtimeRoot: join(link, request.provisioningAttemptId),
    };
    await expect(
      createRetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner({
        authorize: async () => grant(linked),
      }).provision(linked, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(existsSync(request.runtimeRoot)).toBe(false);

    chmodSync(request.runtimeRootParent, 0o750);
    await expect(
      createRetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner({
        authorize: async () => grant(request),
      }).provision(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(existsSync(request.runtimeRoot)).toBe(false);
  });

  it('never replaces an existing attempt root', async () => {
    const { request } = fixture('existing');
    mkdirSync(request.runtimeRoot, { mode: 0o700 });
    await expect(
      createRetainedDescriptorLinuxNativeSupervisorRuntimeRootProvisioner({
        authorize: async () => grant(request),
      }).provision(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(lstatSync(request.runtimeRoot).isDirectory()).toBe(true);
  });
});
