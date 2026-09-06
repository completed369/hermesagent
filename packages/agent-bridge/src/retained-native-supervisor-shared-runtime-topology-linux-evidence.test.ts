import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler,
  RetainedDescriptorLinuxNativeSupervisorTopologyObserver,
} from './retained-native-supervisor-shared-runtime-topology';
import type { LinuxRetainedNativeSupervisorProvisioningPlan } from './retained-native-supervisor-provisioning-controller';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;

function identity(stat: { dev: bigint; ino: bigint }) {
  return `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`;
}

describeLinux('retained-descriptor shared runtime topology evidence', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(): LinuxRetainedNativeSupervisorProvisioningPlan {
    const root = mkdtempSync(join(tmpdir(), 'ventureos-topology-'));
    roots.push(root);
    const parent = join(root, 'runtime-parent');
    const apiDirectory = join(root, 'api');
    const workerDirectory = join(root, 'worker');
    mkdirSync(parent, { mode: 0o700 });
    mkdirSync(apiDirectory);
    mkdirSync(workerDirectory);
    const listener = join(apiDirectory, 'linux-retained-native-listener.node');
    const client = join(workerDirectory, 'linux-retained-native-client.node');
    writeFileSync(listener, Buffer.from('listener-native-fixture'));
    writeFileSync(client, Buffer.from('client-native-fixture'));
    chmodSync(listener, 0o444);
    chmodSync(client, 0o444);
    const parentStat = lstatSync(parent, { bigint: true });
    const listenerStat = lstatSync(listener, { bigint: true });
    const clientStat = lstatSync(client, { bigint: true });
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    return {
      schemaVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_PROVISIONING',
      runtimeRootRequest: {
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_RUNTIME_ROOT_PROVISION',
        workspaceId: 'workspace-linux-evidence',
        supervisorInstanceId: 'supervisor-linux-evidence',
        provisioningAttemptId: 'attempt-0001',
        platform: 'LINUX',
        architecture: 'X64',
        runtimeRootParent: parent,
        runtimeRootParentIdentityReference: identity(parentStat),
        runtimeRootParentOwnerUid: Number(parentStat.uid),
        runtimeRootParentOwnerGid: Number(parentStat.gid),
        runtimeRootParentMode: 0o700,
        runtimeRoot: join(parent, 'attempt-0001'),
        ownerUid: Number(parentStat.uid),
        ownerGid: Number(parentStat.gid),
        runtimeConnection: 'NOT_CONFIGURED',
      },
      clientSource: {
        moduleKind: 'CLIENT',
        sourceModulePath: client,
        sourceModuleSha256: digest('client-native-fixture'),
        sourceModuleIdentityReference: identity(clientStat),
        sourceModuleOwnerUid: Number(clientStat.uid),
        sourceModuleOwnerGid: Number(clientStat.gid),
        sourceModuleMode: 0o444,
        sourceModuleSizeBytes: Number(clientStat.size),
      },
      listenerSource: {
        moduleKind: 'LISTENER',
        sourceModulePath: listener,
        sourceModuleSha256: digest('listener-native-fixture'),
        sourceModuleIdentityReference: identity(listenerStat),
        sourceModuleOwnerUid: Number(listenerStat.uid),
        sourceModuleOwnerGid: Number(listenerStat.gid),
        sourceModuleMode: 0o444,
        sourceModuleSizeBytes: Number(listenerStat.size),
      },
      socketPath: join(parent, 'attempt-0001', 'run', 'supervisor', 'service.sock'),
      runtimeConnection: 'NOT_CONFIGURED',
    };
  }

  it('reconciles exact retained identities without mutating the shared parent', async () => {
    const plan = fixture();
    const before = lstatSync(plan.runtimeRootRequest.runtimeRootParent, { bigint: true });
    const reconciler = new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
      new RetainedDescriptorLinuxNativeSupervisorTopologyObserver('API_LISTENER'),
      new RetainedDescriptorLinuxNativeSupervisorTopologyObserver('WORKER_CLIENT'),
    );
    await expect(reconciler.attest(plan, new AbortController().signal)).resolves.toMatchObject({
      runtimeRootParentIdentityReference: identity(before),
      topologyState: 'SHARED_RUNTIME_VISIBLE_NOT_PROVISIONED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    const after = lstatSync(plan.runtimeRootRequest.runtimeRootParent, { bigint: true });
    expect(identity(after)).toBe(identity(before));
    expect(after.nlink).toBe(before.nlink);
  });

  it('denies a symlinked parent before emitting topology evidence', async () => {
    const plan = fixture();
    const link = join(roots[0]!, 'runtime-parent-link');
    symlinkSync(plan.runtimeRootRequest.runtimeRootParent, link, 'dir');
    const linked = {
      ...plan,
      runtimeRootRequest: {
        ...plan.runtimeRootRequest,
        runtimeRootParent: link,
        runtimeRoot: join(link, 'attempt-0001'),
      },
      socketPath: join(link, 'attempt-0001', 'run', 'supervisor', 'service.sock'),
    };
    const reconciler = new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
      new RetainedDescriptorLinuxNativeSupervisorTopologyObserver('API_LISTENER'),
      new RetainedDescriptorLinuxNativeSupervisorTopologyObserver('WORKER_CLIENT'),
    );
    await expect(reconciler.attest(linked, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
  });

  it('denies a substituted source-module symlink', async () => {
    const plan = fixture();
    const source = plan.clientSource.sourceModulePath;
    const moved = `${source}.real.node`;
    renameSync(source, moved);
    symlinkSync(moved, source, 'file');
    const reconciler = new BoundedLinuxRetainedNativeSupervisorSharedRuntimeTopologyReconciler(
      new RetainedDescriptorLinuxNativeSupervisorTopologyObserver('API_LISTENER'),
      new RetainedDescriptorLinuxNativeSupervisorTopologyObserver('WORKER_CLIENT'),
    );
    await expect(reconciler.attest(plan, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
  });
});
