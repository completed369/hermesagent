import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createRetainedDescriptorLinuxNativeSupervisorPathProvisioner,
  type LinuxRetainedNativeSupervisorPathProvisionGrant,
  type LinuxRetainedNativeSupervisorPathProvisionRequest,
  linuxRetainedNativeSupervisorPathProvisionRequestHash,
} from './retained-native-supervisor-linux-path-provisioner';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const clientSource = resolve(__dirname, '..', 'native', 'linux-retained-native-client.c');

describeLinux('retained-descriptor Linux native path provisioner evidence', () => {
  let ownedRoot: string;
  let sourcePath: string;

  beforeAll(() => {
    expect(spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status).toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-native-path-provisioner-'));
    chmodSync(ownedRoot, 0o700);
    const sourceDirectory = join(ownedRoot, 'source');
    mkdirSync(sourceDirectory, { mode: 0o700 });
    sourcePath = join(sourceDirectory, 'source-client.node');
    const nodeInclude = resolve(dirname(process.execPath), '..', 'include', 'node');
    const compilation = spawnSync(
      'cc',
      [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-D_FORTIFY_SOURCE=2',
        '-DNODE_GYP_MODULE_NAME=linux_retained_native_client',
        '-fstack-protector-strong',
        '-fPIC',
        '-shared',
        '-I',
        nodeInclude,
        clientSource,
        '-o',
        sourcePath,
        '-Wl,-z,relro,-z,now',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
    chmodSync(sourcePath, 0o500);
  }, 45_000);

  afterAll(() => {
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  function identity(stat: { readonly dev: number; readonly ino: number }): string {
    return `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`;
  }

  function fixture(
    label: string,
    observedSource = sourcePath,
  ): {
    readonly request: LinuxRetainedNativeSupervisorPathProvisionRequest;
    readonly modulePath: string;
    readonly socketDirectory: string;
    readonly socketPath: string;
  } {
    const root = join(ownedRoot, label);
    const moduleDirectory = join(root, 'native');
    const socketDirectoryParent = join(root, 'run');
    mkdirSync(moduleDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(socketDirectoryParent, { mode: 0o700 });
    chmodSync(root, 0o700);
    chmodSync(moduleDirectory, 0o700);
    chmodSync(socketDirectoryParent, 0o700);
    const sourceStat = lstatSync(sourcePath);
    const owner = lstatSync(root);
    const modulePath = join(moduleDirectory, 'client.node');
    const socketDirectory = join(socketDirectoryParent, 'supervisor');
    const socketPath = join(socketDirectory, 'recovery.sock');
    return {
      request: {
        schemaVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_PATH_PROVISION',
        workspaceId: 'workspace-linux-evidence',
        supervisorInstanceId: 'native-supervisor-linux-evidence',
        platform: 'LINUX',
        architecture: 'X64',
        moduleKind: 'CLIENT',
        sourceModulePath: observedSource,
        sourceModuleSha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
        sourceModuleIdentityReference: identity(lstatSync(sourcePath)),
        sourceModuleOwnerUid: sourceStat.uid,
        sourceModuleOwnerGid: sourceStat.gid,
        sourceModuleMode: sourceStat.mode & 0o777,
        sourceModuleSizeBytes: sourceStat.size,
        moduleDirectory,
        canonicalModulePath: modulePath,
        socketDirectoryParent,
        socketDirectory,
        socketPath,
        ownerUid: owner.uid,
        ownerGid: owner.gid,
        runtimeConnection: 'NOT_CONFIGURED',
      },
      modulePath,
      socketDirectory,
      socketPath,
    };
  }

  function grant(
    request: LinuxRetainedNativeSupervisorPathProvisionRequest,
  ): LinuxRetainedNativeSupervisorPathProvisionGrant {
    const now = Date.now();
    return {
      ...request,
      provisioningId: `provision-${request.moduleKind.toLowerCase()}`,
      requestHash: linuxRetainedNativeSupervisorPathProvisionRequestHash(request),
      approvalId: 'level3-control-plane:linux-evidence',
      approvalEvidenceHash: 'a'.repeat(64),
      authorizedByReference: 'linux-evidence-authority',
      authorityLevel: 3,
      validFrom: new Date(now - 1_000).toISOString(),
      validUntil: new Date(now + 60_000).toISOString(),
    };
  }

  async function provision(request: LinuxRetainedNativeSupervisorPathProvisionRequest) {
    const provisionGrant = grant(request);
    return createRetainedDescriptorLinuxNativeSupervisorPathProvisioner({
      authorize: async () => provisionGrant,
    }).provision(request, new AbortController().signal);
  }

  it('copies retained source bytes into a new exact owner-only module and socket directory', async () => {
    const { request, modulePath, socketDirectory, socketPath } = fixture('success');

    const result = await provision(request);

    const installedModule = lstatSync(modulePath);
    const installedDirectory = lstatSync(socketDirectory);
    expect(result).toMatchObject({
      canonicalModulePath: modulePath,
      moduleIdentityReference: identity(installedModule),
      moduleMode: 0o500,
      socketDirectory,
      socketDirectoryIdentityReference: identity(installedDirectory),
      socketDirectoryMode: 0o700,
      socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(installedModule.mode & 0o777).toBe(0o500);
    expect(installedDirectory.mode & 0o777).toBe(0o700);
    expect(readFileSync(modulePath)).toEqual(readFileSync(sourcePath));
    expect(existsSync(socketPath)).toBe(false);
  });

  it('denies a symlinked source even when the grant describes its target', async () => {
    const linkedSource = join(ownedRoot, 'source', 'linked-client.node');
    symlinkSync(sourcePath, linkedSource);
    const { request, modulePath, socketDirectory } = fixture('linked-source', linkedSource);

    await expect(provision(request)).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(existsSync(modulePath)).toBe(false);
    expect(existsSync(socketDirectory)).toBe(false);
  });

  it('denies a non-owner-only retained parent before creating either target', async () => {
    const { request, modulePath, socketDirectory } = fixture('unsafe-parent');
    chmodSync(request.moduleDirectory, 0o750);

    await expect(provision(request)).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(existsSync(modulePath)).toBe(false);
    expect(existsSync(socketDirectory)).toBe(false);
  });

  it('refuses an existing module without replacing its bytes', async () => {
    const { request, modulePath, socketDirectory } = fixture('existing-module');
    writeFileSync(modulePath, 'existing');
    chmodSync(modulePath, 0o500);

    await expect(provision(request)).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(readFileSync(modulePath, 'utf8')).toBe('existing');
    expect(existsSync(socketDirectory)).toBe(false);
  });

  it('removes its new module when the socket directory target already exists', async () => {
    const { request, modulePath, socketDirectory } = fixture('existing-socket-directory');
    mkdirSync(socketDirectory, { mode: 0o700 });

    await expect(provision(request)).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    expect(existsSync(modulePath)).toBe(false);
    expect(lstatSync(socketDirectory).isDirectory()).toBe(true);
  });
});
