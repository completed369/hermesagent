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
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedLinuxRetainedNativeSupervisorNativeListenerBinding,
  type LinuxRetainedNativeSupervisorListenerNativeModule,
} from './retained-native-supervisor-linux-native-listener-binding';
import {
  BoundedLinuxRetainedNativeSupervisorListenerLifecycle,
  type LinuxRetainedNativeSupervisorListenerAuthorization,
  type LinuxRetainedNativeSupervisorOwnedListener,
} from './retained-native-supervisor-listener-lifecycle';
import type {
  RetainedNativeSupervisorRecoveryRequest,
  RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const nativeSource = resolve(__dirname, '..', 'native', 'linux-retained-native-listener.c');
const nativeRequire = createRequire(__filename);

const request = Object.freeze({
  schemaVersion: 1,
  requestId: 'production-native-listener-linux-evidence',
  requestHash: 'b'.repeat(64),
  challengeNonce: 'production-native-listener-challenge',
  runtimeConnection: 'NOT_CONFIGURED',
}) as unknown as Readonly<RetainedNativeSupervisorRecoveryRequest>;
const response = Object.freeze({
  schemaVersion: 1,
  responseId: 'production-native-listener-response',
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

describeLinux('production Linux retained-native listener module evidence', () => {
  let ownedRoot: string;
  let nativeModule: LinuxRetainedNativeSupervisorListenerNativeModule;
  let sequence = 0;
  const nextSocket = () => join(ownedRoot, `native-listener-${(sequence += 1)}.sock`);

  beforeAll(() => {
    expect(spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status).toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-production-native-listener-'));
    chmodSync(ownedRoot, 0o700);
    const addonPath = join(ownedRoot, 'linux-retained-native-listener.node');
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
        '-DNODE_GYP_MODULE_NAME=linux_retained_native_listener',
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
    nativeModule = nativeRequire(addonPath) as LinuxRetainedNativeSupervisorListenerNativeModule;
  }, 60_000);

  afterAll(() => {
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  function authorization(socketPath: string): LinuxRetainedNativeSupervisorListenerAuthorization {
    const parent = lstatSync(ownedRoot);
    return {
      schemaVersion: 1,
      platform: 'LINUX',
      socketPath,
      parentDevice: parent.dev,
      parentInode: parent.ino,
      parentOwnerUid: parent.uid,
      parentOwnerGid: parent.gid,
      parentMode: 0o700,
      socketOwnerUid: process.geteuid!(),
      socketOwnerGid: process.getegid!(),
      socketMode: 0o600,
      expectedWorkerPid: process.pid,
      expectedWorkerUid: process.geteuid!(),
      expectedWorkerGid: process.getegid!(),
      listenBacklog: 1,
      runtimeConnection: 'NOT_CONFIGURED',
    };
  }

  function peer(): RetainedNativeSupervisorRecoveryTransport {
    return { exchange: vi.fn(async () => response) };
  }

  async function waitForPath(socketPath: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (existsSync(socketPath)) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
    throw new Error('Native listener path was not created');
  }

  async function workerExchange(socketPath: string): Promise<Buffer> {
    await waitForPath(socketPath);
    return new Promise((resolveExchange, rejectExchange) => {
      const chunks: Buffer[] = [];
      const socket = createConnection(socketPath);
      socket.once('connect', () => socket.end(requestFrame));
      socket.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      socket.once('error', rejectExchange);
      socket.once('end', () => resolveExchange(Buffer.concat(chunks)));
    });
  }

  it('exports only the reviewed ABI as own data properties', () => {
    expect(Object.keys(nativeModule).sort()).toEqual([
      'abiVersion',
      'createOwnedListener',
      'platform',
    ]);
    expect(nativeModule).toMatchObject({ abiVersion: 1, platform: 'LINUX' });
    for (const key of Object.keys(nativeModule)) {
      expect(Object.getOwnPropertyDescriptor(nativeModule, key)).toHaveProperty('value');
    }
  });

  it('runs one authenticated exchange without blocking the Node event loop', async () => {
    const socketPath = nextSocket();
    const trustedPeer = peer();
    const lifecycle = new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
      new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(nativeModule),
      authorization(socketPath),
    );

    const run = lifecycle.runOne(trustedPeer, new AbortController().signal);
    const observedResponse = workerExchange(socketPath);

    await expect(run).resolves.toBeUndefined();
    await expect(observedResponse).resolves.toEqual(responseFrame);
    expect(trustedPeer.exchange).toHaveBeenCalledOnce();
    expect(existsSync(socketPath)).toBe(false);
  });

  it('wakes a pending native accept on abort and removes only its owned socket', async () => {
    const socketPath = nextSocket();
    const controller = new AbortController();
    const lifecycle = new BoundedLinuxRetainedNativeSupervisorListenerLifecycle(
      new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(nativeModule),
      authorization(socketPath),
    );

    const run = lifecycle.runOne(peer(), controller.signal);
    await waitForPath(socketPath);
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
    controller.abort();

    await expect(run).rejects.toMatchObject({ code: 'EXCHANGE_DENIED' });
    expect(existsSync(socketPath)).toBe(false);
  });

  it('preserves a substituted path during synchronous identity-owned cleanup', async () => {
    const socketPath = nextSocket();
    const binding = new BoundedLinuxRetainedNativeSupervisorNativeListenerBinding(nativeModule);
    const listener = (await binding.createOwnedListener(
      {
        schemaVersion: 1,
        platform: 'LINUX',
        socketPath,
        socketMode: 0o600,
        listenBacklog: 1,
        pathDisposition: 'FAIL_IF_PRESENT',
      },
      new AbortController().signal,
    )) as LinuxRetainedNativeSupervisorOwnedListener;
    await listener.creationEvidence(new AbortController().signal);
    unlinkSync(socketPath);
    writeFileSync(socketPath, 'substituted-marker', { mode: 0o600, flag: 'wx' });

    expect(listener.closeAndUnlinkOwned()).toMatchObject({
      schemaVersion: 1,
      listenerClosed: true,
      disposition: 'SUBSTITUTION_PRESERVED',
    });
    expect(existsSync(socketPath)).toBe(true);
    unlinkSync(socketPath);
  });
});
