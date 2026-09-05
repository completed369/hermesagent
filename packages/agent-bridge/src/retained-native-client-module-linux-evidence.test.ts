import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalJson } from './codec';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport,
  type RetainedNativeSupervisorLocalIpcAuthorization,
} from './retained-native-supervisor-local-ipc';
import {
  BoundedLinuxRetainedNativeSupervisorNativeClientBinding,
  type LinuxRetainedNativeSupervisorClientNativeModule,
} from './retained-native-supervisor-linux-native-client-binding';
import { BoundedLinuxRetainedNativeSupervisorLocalIpcClient } from './retained-native-supervisor-linux-client';
import type { RetainedNativeSupervisorRecoveryRequest } from './retained-native-supervisor-recovery';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const nativeSource = resolve(__dirname, '..', 'native', 'linux-retained-native-client.c');
const nativeRequire = createRequire(__filename);

const request = Object.freeze({
  schemaVersion: 1,
  requestId: 'production-native-client-linux-evidence',
  requestHash: 'c'.repeat(64),
  challengeNonce: 'production-native-client-challenge',
  runtimeConnection: 'NOT_CONFIGURED',
}) as unknown as Readonly<RetainedNativeSupervisorRecoveryRequest>;
const response = Object.freeze({
  schemaVersion: 1,
  responseId: 'production-native-client-response',
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

describeLinux('production Linux retained-native client module evidence', () => {
  let ownedRoot: string;
  let nativeModule: LinuxRetainedNativeSupervisorClientNativeModule;
  let sequence = 0;
  const servers = new Set<Server>();
  const sockets = new Set<Socket>();
  const nextSocket = () => join(ownedRoot, `native-client-${(sequence += 1)}.sock`);

  beforeAll(() => {
    expect(spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status).toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-production-native-client-'));
    chmodSync(ownedRoot, 0o700);
    const addonPath = join(ownedRoot, 'linux-retained-native-client.node');
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
        nativeSource,
        '-o',
        addonPath,
        '-Wl,-z,relro,-z,now',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(compilation.status, compilation.stderr).toBe(0);
    nativeModule = nativeRequire(addonPath) as LinuxRetainedNativeSupervisorClientNativeModule;
  }, 60_000);

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      [...servers].map(
        (server) =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      ),
    );
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  async function listen(server: Server, socketPath: string): Promise<void> {
    servers.add(server);
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(socketPath, () => {
        server.off('error', rejectListen);
        chmodSync(socketPath, 0o600);
        resolveListen();
      });
    });
  }

  async function closeServer(server: Server): Promise<void> {
    if (!servers.delete(server)) return;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }

  function client(): BoundedLinuxRetainedNativeSupervisorLocalIpcClient {
    return new BoundedLinuxRetainedNativeSupervisorLocalIpcClient(
      new BoundedLinuxRetainedNativeSupervisorNativeClientBinding(nativeModule),
    );
  }

  function authorization(socketPath: string): RetainedNativeSupervisorLocalIpcAuthorization {
    const identity = lstatSync(socketPath);
    return {
      schemaVersion: 1,
      platform: 'LINUX',
      socketPath,
      socketDevice: identity.dev,
      socketInode: identity.ino,
      socketOwnerUid: identity.uid,
      socketOwnerGid: identity.gid,
      socketMode: 0o600,
      expectedPeerPid: process.pid,
      expectedPeerUid: process.geteuid!(),
      expectedPeerGid: process.getegid!(),
      runtimeConnection: 'NOT_CONFIGURED',
    };
  }

  it('exports only the reviewed ABI as own data properties', () => {
    expect(Object.keys(nativeModule).sort()).toEqual([
      'abiVersion',
      'connectUnixSocket',
      'lstatUnixSocket',
      'platform',
    ]);
    expect(nativeModule).toMatchObject({ abiVersion: 1, platform: 'LINUX' });
    for (const key of Object.keys(nativeModule)) {
      expect(Object.getOwnPropertyDescriptor(nativeModule, key)).toHaveProperty('value');
    }
  });

  it('runs one authenticated exchange without blocking the Node event loop', async () => {
    const socketPath = nextSocket();
    let observedRequest = Buffer.alloc(0);
    const server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      socket.once('end', () => {
        observedRequest = Buffer.concat(chunks);
        socket.end(responseFrame);
      });
    });
    await listen(server, socketPath);
    const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
      client(),
      authorization(socketPath),
    );
    let eventLoopTurn = false;
    const turn = new Promise<void>((resolveTurn) =>
      setImmediate(() => {
        eventLoopTurn = true;
        resolveTurn();
      }),
    );

    await expect(transport.exchange(request, new AbortController().signal)).resolves.toEqual(
      response,
    );
    await turn;
    expect(eventLoopTurn).toBe(true);
    expect(observedRequest).toEqual(requestFrame);
    await closeServer(server);
  });

  it('wakes a pending native read on abort and closes the allocated connection', async () => {
    const socketPath = nextSocket();
    let requestEnded!: () => void;
    const receivedRequest = new Promise<void>((resolveRequest) => {
      requestEnded = resolveRequest;
    });
    const server = createServer((socket) => {
      socket.resume();
      socket.once('end', requestEnded);
    });
    await listen(server, socketPath);
    const controller = new AbortController();
    const exchange = client().exchange(socketPath, requestFrame, controller.signal);
    await receivedRequest;
    const denied = expect(exchange).rejects.toMatchObject({ code: 'EXCHANGE_DENIED' });
    controller.abort();

    await denied;
    await closeServer(server);
  });

  it('denies a substituted socket identity after the connected response', async () => {
    const socketPath = nextSocket();
    let replacement: Server | undefined;
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      socket.resume();
      socket.once('end', async () => {
        unlinkSync(socketPath);
        replacement = createServer();
        await listen(replacement, socketPath);
        socket.end(responseFrame);
      });
    });
    await listen(server, socketPath);

    await expect(
      client().exchange(socketPath, requestFrame, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_ATTESTATION' });
    await closeServer(server);
    if (replacement) await closeServer(replacement);
  });
});
