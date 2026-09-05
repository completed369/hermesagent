import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createRetainedDescriptorLinuxNativeSupervisorModuleLoader,
  type LinuxRetainedNativeSupervisorModuleAuthorization,
  type LinuxRetainedNativeSupervisorModuleKind,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
  linuxRetainedNativeSupervisorModuleLoadRequestHash,
} from './retained-native-supervisor-linux-module-loader';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const clientSource = resolve(__dirname, '..', 'native', 'linux-retained-native-client.c');
const listenerSource = resolve(__dirname, '..', 'native', 'linux-retained-native-listener.c');

describeLinux('retained-descriptor Linux native module loader evidence', () => {
  let ownedRoot: string;
  let clientPath: string;
  let listenerPath: string;

  function compile(source: string, output: string, name: string): void {
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
        `-DNODE_GYP_MODULE_NAME=${name}`,
        '-fstack-protector-strong',
        '-fPIC',
        '-shared',
        '-I',
        nodeInclude,
        source,
        '-o',
        output,
        '-Wl,-z,relro,-z,now',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
    chmodSync(output, 0o555);
  }

  beforeAll(() => {
    expect(spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status).toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-native-module-loader-'));
    chmodSync(ownedRoot, 0o700);
    clientPath = join(ownedRoot, 'client.node');
    listenerPath = join(ownedRoot, 'listener.node');
    compile(clientSource, clientPath, 'linux_retained_native_client');
    compile(listenerSource, listenerPath, 'linux_retained_native_listener');
  }, 90_000);

  afterAll(() => {
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  function request(
    moduleKind: LinuxRetainedNativeSupervisorModuleKind,
    canonicalModulePath: string,
    socketDirectory = ownedRoot,
  ): LinuxRetainedNativeSupervisorModuleLoadRequest {
    return {
      schemaVersion: 1,
      platform: 'LINUX',
      architecture: 'X64',
      moduleKind,
      canonicalModulePath,
      socketPath: join(socketDirectory, `${moduleKind.toLowerCase()}.sock`),
      runtimeConnection: 'NOT_CONFIGURED',
    };
  }

  function identity(stat: { readonly dev: number; readonly ino: number }): string {
    return `linux:dev-${stat.dev.toString(16)}:ino-${stat.ino.toString(16)}`;
  }

  function authorization(
    loadRequest: LinuxRetainedNativeSupervisorModuleLoadRequest,
    observedModulePath = loadRequest.canonicalModulePath,
    observedDirectory = dirname(loadRequest.socketPath),
  ): LinuxRetainedNativeSupervisorModuleAuthorization {
    const moduleStat = lstatSync(observedModulePath);
    const directoryStat = lstatSync(observedDirectory);
    const now = Date.now();
    return {
      ...loadRequest,
      authorizationId: `linux-native-module-${loadRequest.moduleKind.toLowerCase()}`,
      authorizationVersion: 1,
      requestHash: linuxRetainedNativeSupervisorModuleLoadRequestHash(loadRequest),
      validFrom: new Date(now - 1_000).toISOString(),
      validUntil: new Date(now + 60_000).toISOString(),
      moduleSha256: createHash('sha256').update(readFileSync(observedModulePath)).digest('hex'),
      moduleIdentityReference: identity(moduleStat),
      moduleOwnerUid: moduleStat.uid,
      moduleOwnerGid: moduleStat.gid,
      moduleMode: moduleStat.mode & 0o777,
      moduleSizeBytes: moduleStat.size,
      socketDirectory: dirname(loadRequest.socketPath),
      socketDirectoryIdentityReference: identity(directoryStat),
      socketDirectoryOwnerUid: directoryStat.uid,
      socketDirectoryOwnerGid: directoryStat.gid,
      socketDirectoryMode: 0o700,
    };
  }

  async function load(
    loadRequest: LinuxRetainedNativeSupervisorModuleLoadRequest,
    grant: LinuxRetainedNativeSupervisorModuleAuthorization = authorization(loadRequest),
  ) {
    const loader = createRetainedDescriptorLinuxNativeSupervisorModuleLoader({
      read: async () => grant,
    });
    return loader.load(loadRequest, new AbortController().signal);
  }

  it.each([
    [
      'CLIENT' as const,
      () => clientPath,
      ['abiVersion', 'connectUnixSocket', 'lstatUnixSocket', 'platform'],
    ],
    ['LISTENER' as const, () => listenerPath, ['abiVersion', 'createOwnedListener', 'platform']],
  ])(
    'loads the authorized retained %s descriptor and only its reviewed ABI',
    async (moduleKind, path, expectedKeys) => {
      const loaded = await load(request(moduleKind, path()));

      expect(Object.keys(loaded.nativeModule).sort()).toEqual(expectedKeys);
      expect(loaded).toMatchObject({
        schemaVersion: 1,
        moduleKind,
        runtimeConnection: 'NOT_CONFIGURED',
      });
    },
  );

  it('reuses only the exact retained module identity across authorized socket paths', async () => {
    const firstRequest = request('CLIENT', clientPath);
    const first = await load(firstRequest);
    const secondRequest = {
      ...firstRequest,
      socketPath: join(ownedRoot, 'client-second.sock'),
    };
    const second = await load(secondRequest, authorization(secondRequest));

    expect(second.nativeModule).toBe(first.nativeModule);
  });

  it('denies a replacement identity for an already loaded module kind', async () => {
    await load(request('CLIENT', clientPath));
    const replacementPath = join(ownedRoot, 'replacement-client.node');
    copyFileSync(clientPath, replacementPath);
    chmodSync(replacementPath, 0o555);
    const replacementRequest = request('CLIENT', replacementPath);

    await expect(load(replacementRequest)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
  });

  it('denies a symlinked module even when authority describes its target', async () => {
    const linkedPath = join(ownedRoot, 'linked-client.node');
    symlinkSync(clientPath, linkedPath);
    const loadRequest = request('CLIENT', linkedPath);
    const grant = authorization(loadRequest, clientPath);

    await expect(load(loadRequest, grant)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
  });

  it('denies a symlinked socket directory before loading authorized code', async () => {
    const linkedDirectory = join(tmpdir(), `ventureos-loader-link-${process.pid}`);
    rmSync(linkedDirectory, { recursive: true, force: true });
    symlinkSync(ownedRoot, linkedDirectory, 'dir');
    const loadRequest = request('CLIENT', clientPath, linkedDirectory);
    const grant = authorization(loadRequest, clientPath, ownedRoot);

    await expect(load(loadRequest, grant)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    rmSync(linkedDirectory, { recursive: true, force: true });
  });
});
