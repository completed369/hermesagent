import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedLinuxRetainedNativeSupervisorListenerLifecycle,
  type LinuxRetainedNativeSupervisorListenerAuthorization,
  type LinuxRetainedNativeSupervisorListenerCreationRequest,
  type LinuxRetainedNativeSupervisorListenerLifecycleBinding,
  type LinuxRetainedNativeSupervisorOwnedListener,
} from './retained-native-supervisor-listener-lifecycle';
import type { LinuxRetainedNativeSupervisorAcceptedSession } from './retained-native-supervisor-linux-session';
import type {
  RetainedNativeSupervisorRecoveryRequest,
  RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const nativeSource = resolve(
  __dirname,
  '..',
  'test',
  'native',
  'retained-native-listener-lifecycle-addon.c',
);
const nativeRequire = createRequire(__filename);

interface NativeListenerLifecycleAddon {
  create(socketPath: string): unknown;
  lstat(socketPath: string): unknown;
  beginSession(requestFrame: Buffer): void;
  peerCredentials(): unknown;
  readRequest(maximumBytes: number): Buffer;
  writeResponse(responseFrame: Buffer): Buffer;
  closeSession(): void;
  cleanup(): unknown;
}

const request = Object.freeze({
  schemaVersion: 1,
  requestId: 'native-listener-lifecycle-linux-evidence',
  requestHash: 'a'.repeat(64),
  challengeNonce: 'native-listener-lifecycle-challenge',
  runtimeConnection: 'NOT_CONFIGURED',
}) as unknown as Readonly<RetainedNativeSupervisorRecoveryRequest>;
const response = Object.freeze({
  schemaVersion: 1,
  responseId: 'native-listener-lifecycle-response',
  requestId: request.requestId,
  requestHash: request.requestHash,
  runtimeConnection: 'NOT_CONFIGURED',
});

function frame(
  direction: 'WORKER_TO_SUPERVISOR' | 'SUPERVISOR_TO_WORKER',
  message: unknown,
): Buffer {
  return Buffer.from(
    `${canonicalJson({
      schemaVersion: 1,
      protocol: 'VENTUREOS_RETAINED_NATIVE_RECOVERY_IPC',
      direction,
      message,
    })}\n`,
  );
}

const requestFrame = frame('WORKER_TO_SUPERVISOR', request);
const responseFrame = frame('SUPERVISOR_TO_WORKER', response);

class NativeAcceptedSession implements LinuxRetainedNativeSupervisorAcceptedSession {
  constructor(
    private readonly addon: NativeListenerLifecycleAddon,
    private readonly observeResponse: (response: Buffer) => void,
  ) {}

  async peerCredentials(_signal: AbortSignal): Promise<unknown> {
    return this.addon.peerCredentials();
  }

  async readToEof(maximumBytes: number, _signal: AbortSignal): Promise<unknown> {
    return this.addon.readRequest(maximumBytes);
  }

  async writeAndShutdown(
    responseCandidate: Readonly<Uint8Array>,
    _signal: AbortSignal,
  ): Promise<void> {
    this.observeResponse(this.addon.writeResponse(Buffer.from(responseCandidate)));
  }

  async close(): Promise<void> {
    this.addon.closeSession();
  }
}

class NativeOwnedListener implements LinuxRetainedNativeSupervisorOwnedListener {
  readonly platform = 'LINUX' as const;
  observedResponse?: Buffer;

  constructor(
    private readonly addon: NativeListenerLifecycleAddon,
    private readonly socketPath: string,
    private readonly evidence: unknown,
  ) {}

  async creationEvidence(_signal: AbortSignal): Promise<unknown> {
    return this.evidence;
  }

  async lstatUnixSocket(socketPath: string, _signal: AbortSignal): Promise<unknown> {
    expect(socketPath).toBe(this.socketPath);
    return this.addon.lstat(socketPath);
  }

  async acceptAuthorizedUnixSocket(socketPath: string, _signal: AbortSignal): Promise<unknown> {
    expect(socketPath).toBe(this.socketPath);
    this.addon.beginSession(Buffer.from(requestFrame));
    return new NativeAcceptedSession(this.addon, (observed) => {
      this.observedResponse = observed;
    });
  }

  closeAndUnlinkOwned(): unknown {
    return this.addon.cleanup();
  }
}

class NativeLifecycleBinding implements LinuxRetainedNativeSupervisorListenerLifecycleBinding {
  readonly platform = 'LINUX' as const;
  listener?: NativeOwnedListener;

  constructor(
    private readonly addon: NativeListenerLifecycleAddon,
    private readonly substituteAfterCreate = false,
  ) {}

  async createOwnedListener(
    creation: Readonly<LinuxRetainedNativeSupervisorListenerCreationRequest>,
    _signal: AbortSignal,
  ): Promise<unknown> {
    expect(creation).toEqual({
      schemaVersion: 1,
      platform: 'LINUX',
      socketPath: creation.socketPath,
      socketMode: 0o600,
      listenBacklog: 1,
      pathDisposition: 'FAIL_IF_PRESENT',
    });
    const evidence = this.addon.create(creation.socketPath);
    this.listener = new NativeOwnedListener(this.addon, creation.socketPath, evidence);
    if (this.substituteAfterCreate) {
      unlinkSync(creation.socketPath);
      writeFileSync(creation.socketPath, 'substituted-marker', {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
    }
    return this.listener;
  }
}

describeLinux('retained-native listener lifecycle Linux kernel evidence', () => {
  let ownedRoot: string;
  let addon: NativeListenerLifecycleAddon;
  let sequence = 0;
  const nextSocket = () => join(ownedRoot, `listener-${(sequence += 1)}.sock`);

  beforeAll(() => {
    expect(spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status).toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-retained-native-listener-'));
    const addonPath = join(ownedRoot, 'retained-native-listener-lifecycle.node');
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
        '-DNODE_GYP_MODULE_NAME=retained_native_listener_lifecycle',
        '-fstack-protector-strong',
        '-fPIC',
        '-shared',
        '-I',
        nodeInclude,
        nativeSource,
        '-o',
        addonPath,
        '-Wl,-z,relro,-z,now',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
    addon = nativeRequire(addonPath) as NativeListenerLifecycleAddon;
  }, 60_000);

  afterAll(() => {
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  function authorization(
    socketPath: string,
    drift: Partial<LinuxRetainedNativeSupervisorListenerAuthorization> = {},
  ): LinuxRetainedNativeSupervisorListenerAuthorization {
    const parent = lstatSync(ownedRoot);
    return {
      schemaVersion: 1,
      platform: 'LINUX',
      socketPath,
      parentDevice: parent.dev,
      parentInode: parent.ino,
      parentOwnerUid: parent.uid,
      parentOwnerGid: parent.gid,
      parentMode: parent.mode & 0o777,
      socketOwnerUid: process.geteuid!(),
      socketOwnerGid: process.getegid!(),
      socketMode: 0o600,
      expectedWorkerPid: process.pid,
      expectedWorkerUid: process.geteuid!(),
      expectedWorkerGid: process.getegid!(),
      listenBacklog: 1,
      runtimeConnection: 'NOT_CONFIGURED',
      ...drift,
    };
  }

  function peer(): RetainedNativeSupervisorRecoveryTransport {
    return { exchange: vi.fn(async () => response) };
  }

  it('runs one authenticated exchange through the kernel-created owned listener', async () => {
    const socketPath = nextSocket();
    const binding = new NativeLifecycleBinding(addon);
    const trustedPeer = peer();
    const lifecycle = new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
      binding,
      authorization(socketPath),
    );

    await expect(
      lifecycle.runOne(trustedPeer, new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(trustedPeer.exchange).toHaveBeenCalledOnce();
    expect(binding.listener?.observedResponse).toEqual(responseFrame);
    expect(existsSync(socketPath)).toBe(false);
  });

  it('pins real SO_PEERCRED worker credentials before releasing the request', async () => {
    const socketPath = nextSocket();
    const trustedPeer = peer();
    const lifecycle = new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
      new NativeLifecycleBinding(addon),
      authorization(socketPath, { expectedWorkerPid: process.pid + 1 }),
    );

    await expect(lifecycle.runOne(trustedPeer, new AbortController().signal)).rejects.toMatchObject(
      {
        code: 'INVALID_ATTESTATION',
      },
    );
    expect(trustedPeer.exchange).not.toHaveBeenCalled();
    expect(existsSync(socketPath)).toBe(false);
  });

  it('refuses a pre-existing path without replacing or deleting it', async () => {
    const socketPath = nextSocket();
    writeFileSync(socketPath, 'owned-marker', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const lifecycle = new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
      new NativeLifecycleBinding(addon),
      authorization(socketPath),
    );

    await expect(lifecycle.runOne(peer(), new AbortController().signal)).rejects.toMatchObject({
      code: 'EXCHANGE_DENIED',
    });
    expect(existsSync(socketPath)).toBe(true);
  });

  it('preserves a substituted path during identity-owned cleanup', async () => {
    const socketPath = nextSocket();
    const trustedPeer = peer();
    const lifecycle = new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
      new NativeLifecycleBinding(addon, true),
      authorization(socketPath),
    );

    await expect(lifecycle.runOne(trustedPeer, new AbortController().signal)).rejects.toMatchObject(
      {
        code: 'EXCHANGE_DENIED',
      },
    );
    expect(trustedPeer.exchange).not.toHaveBeenCalled();
    expect(existsSync(socketPath)).toBe(true);
  });

  it('refuses creation when the authorized parent loses owner-only mode', async () => {
    const socketPath = nextSocket();
    const auth = authorization(socketPath);
    chmodSync(ownedRoot, 0o750);
    try {
      const lifecycle = new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
        new NativeLifecycleBinding(addon),
        auth,
      );
      await expect(lifecycle.runOne(peer(), new AbortController().signal)).rejects.toMatchObject({
        code: 'EXCHANGE_DENIED',
      });
      expect(existsSync(socketPath)).toBe(false);
    } finally {
      chmodSync(ownedRoot, 0o700);
    }
  });
});
