import { describe, expect, it, vi } from 'vitest';

import {
  BoundedLinuxRetainedNativeSupervisorModuleLoader,
  DenyLinuxRetainedNativeSupervisorModuleAuthorizationSource,
  type LinuxRetainedNativeSupervisorModuleAuthorization,
  type LinuxRetainedNativeSupervisorModuleAuthorizationSource,
  type LinuxRetainedNativeSupervisorModuleHost,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
  linuxRetainedNativeSupervisorModuleLoadRequestHash,
} from './retained-native-supervisor-linux-module-loader';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function request(
  moduleKind: 'CLIENT' | 'LISTENER' = 'CLIENT',
): LinuxRetainedNativeSupervisorModuleLoadRequest {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind,
    canonicalModulePath: `/opt/ventureos/native/${moduleKind.toLowerCase()}.node`,
    socketPath: '/run/ventureos/supervisor/recovery.sock',
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function authorization(
  input: LinuxRetainedNativeSupervisorModuleLoadRequest = request(),
  override: Partial<LinuxRetainedNativeSupervisorModuleAuthorization> = {},
): LinuxRetainedNativeSupervisorModuleAuthorization {
  return {
    ...input,
    authorizationId: 'native-module-load-1',
    authorizationVersion: 1,
    requestHash: linuxRetainedNativeSupervisorModuleLoadRequestHash(input),
    validFrom: new Date(NOW - 1_000).toISOString(),
    validUntil: new Date(NOW + 60_000).toISOString(),
    moduleSha256: 'a'.repeat(64),
    moduleIdentityReference: 'linux:dev-1:ino-2',
    moduleOwnerUid: 1000,
    moduleOwnerGid: 1000,
    moduleMode: 0o500,
    moduleSizeBytes: 64_000,
    socketDirectory: '/run/ventureos/supervisor',
    socketDirectoryIdentityReference: 'linux:dev-3:ino-4',
    socketDirectoryOwnerUid: 1000,
    socketDirectoryOwnerGid: 1000,
    socketDirectoryMode: 0o700,
    ...override,
  };
}

function clientModule() {
  return {
    abiVersion: 1 as const,
    platform: 'LINUX' as const,
    lstatUnixSocket: vi.fn(async () => ({})),
    connectUnixSocket: vi.fn(async () => ({})),
  };
}

function listenerModule() {
  return {
    abiVersion: 1 as const,
    platform: 'LINUX' as const,
    createOwnedListener: vi.fn(async () => ({})),
  };
}

function source(value: unknown): LinuxRetainedNativeSupervisorModuleAuthorizationSource & {
  read: ReturnType<typeof vi.fn>;
} {
  return { read: vi.fn(async () => value) };
}

function host(nativeModule: unknown): LinuxRetainedNativeSupervisorModuleHost & {
  verifySocketDirectory: ReturnType<typeof vi.fn>;
  loadAuthorizedModule: ReturnType<typeof vi.fn>;
} {
  return {
    platform: 'LINUX',
    architecture: 'X64',
    verifySocketDirectory: vi.fn(),
    loadAuthorizedModule: vi.fn(() => nativeModule),
  };
}

describe('bounded Linux retained-native supervisor module loader', () => {
  it('defaults to deny authorization and consumes its single attempt', async () => {
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader();

    await expect(loader.load(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    await expect(loader.load(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    await expect(
      new DenyLinuxRetainedNativeSupervisorModuleAuthorizationSource().read(request()),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it.each([
    ['CLIENT' as const, clientModule],
    ['LISTENER' as const, listenerModule],
  ])('loads one exact %s ABI only after path authorization', async (moduleKind, moduleFactory) => {
    const loadRequest = request(moduleKind);
    const grant = authorization(loadRequest);
    const authorizationSource = source(grant);
    const nativeHost = host(moduleFactory());
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader(
      authorizationSource,
      nativeHost,
      () => NOW,
    );

    const loaded = await loader.load(loadRequest, new AbortController().signal);

    expect(loaded).toMatchObject({
      schemaVersion: 1,
      moduleKind,
      socketPath: loadRequest.socketPath,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.nativeModule)).toBe(true);
    expect(authorizationSource.read).toHaveBeenCalledOnce();
    expect(Object.isFrozen(authorizationSource.read.mock.calls[0]![0])).toBe(true);
    expect(nativeHost.verifySocketDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ socketDirectoryMode: 0o700 }),
    );
    expect(nativeHost.loadAuthorizedModule).toHaveBeenCalledAfter(nativeHost.verifySocketDirectory);
  });

  it.each([
    { unexpected: true },
    { runtimeConnection: 'CONNECTED' },
    { platform: 'WINDOWS' },
    { architecture: 'ARM64' },
    { canonicalModulePath: '/opt/ventureos/../client.node' },
    { canonicalModulePath: '/opt/ventureos/client.js' },
    { socketPath: '/run/ventureos/../recovery.sock' },
    { socketPath: 'relative.sock' },
  ])('rejects a malformed request before consulting authority: %o', async (override) => {
    const authorizationSource = source(authorization());
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader(
      authorizationSource,
      host(clientModule()),
      () => NOW,
    );

    await expect(
      loader.load({ ...request(), ...override }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(authorizationSource.read).not.toHaveBeenCalled();
  });

  it('normalizes authority failures without invoking the host', async () => {
    const nativeHost = host(clientModule());
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader(
      {
        read: vi.fn(async () => {
          throw new Error('private authority failure');
        }),
      },
      nativeHost,
      () => NOW,
    );

    await expect(loader.load(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    expect(nativeHost.verifySocketDirectory).not.toHaveBeenCalled();
    expect(nativeHost.loadAuthorizedModule).not.toHaveBeenCalled();
  });

  it.each([
    { requestHash: 'b'.repeat(64) },
    { moduleKind: 'LISTENER' },
    { moduleMode: 0o755 },
    { moduleMode: 0o333 },
    { moduleSizeBytes: 0 },
    { moduleSizeBytes: 8 * 1_024 * 1_024 + 1 },
    { socketDirectory: '/run/ventureos' },
    { socketDirectoryMode: 0o755 },
    { validFrom: new Date(NOW + 1).toISOString() },
    { validUntil: new Date(NOW).toISOString() },
    {
      validFrom: new Date(NOW - 1_000).toISOString(),
      validUntil: new Date(NOW + 5 * 60_000).toISOString(),
    },
  ])('rejects an unbound, unsafe, or stale authorization: %o', async (override) => {
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader(
      source(authorization(request(), override as never)),
      host(clientModule()),
      () => NOW,
    );

    await expect(loader.load(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
  });

  it('rejects cancellation before authority and after directory verification', async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const firstSource = source(authorization());
    await expect(
      new BoundedLinuxRetainedNativeSupervisorModuleLoader(
        firstSource,
        host(clientModule()),
        () => NOW,
      ).load(request(), alreadyAborted.signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(firstSource.read).not.toHaveBeenCalled();

    const controller = new AbortController();
    const nativeHost = host(clientModule());
    nativeHost.verifySocketDirectory.mockImplementation(() => controller.abort());
    await expect(
      new BoundedLinuxRetainedNativeSupervisorModuleLoader(
        source(authorization()),
        nativeHost,
        () => NOW,
      ).load(request(), controller.signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(nativeHost.loadAuthorizedModule).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { ...clientModule(), extra: true },
    { ...clientModule(), abiVersion: 2 },
    { ...clientModule(), platform: 'WINDOWS' },
    { ...clientModule(), connectUnixSocket: null },
  ])('rejects malformed loaded client module shape: %o', async (nativeModule) => {
    const loader = new BoundedLinuxRetainedNativeSupervisorModuleLoader(
      source(authorization()),
      host(nativeModule),
      () => NOW,
    );
    await expect(loader.load(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
  });

  it('redacts host failures and denies clock rollback after authorization', async () => {
    const failingHost = host(clientModule());
    failingHost.verifySocketDirectory.mockImplementation(() => {
      throw new Error('private host detail');
    });
    await expect(
      new BoundedLinuxRetainedNativeSupervisorModuleLoader(
        source(authorization()),
        failingHost,
        () => NOW,
      ).load(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });

    const clock = vi
      .fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW - 1);
    const rollbackHost = host(clientModule());
    await expect(
      new BoundedLinuxRetainedNativeSupervisorModuleLoader(
        source(authorization()),
        rollbackHost,
        clock,
      ).load(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION' });
    expect(rollbackHost.loadAuthorizedModule).not.toHaveBeenCalled();
  });
});
