import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  type RetainedNativeSupervisorRecoveryRequest,
  type RetainedNativeSupervisorRecoveryTransport,
} from './retained-native-supervisor-recovery';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler,
  AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport,
  MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES,
  type RetainedNativeSupervisorLocalIpcAuthorization,
  type RetainedNativeSupervisorLocalIpcClient,
  type RetainedNativeSupervisorLocalIpcEndpointIdentity,
} from './retained-native-supervisor-local-ipc';

const describeLinux =
  process.platform === 'linux' && process.arch === 'x64' ? describe : describe.skip;
const nativeSource = resolve(
  __dirname,
  '..',
  'test',
  'native',
  'retained-native-local-ipc-addon.c',
);
const nativeRequire = createRequire(__filename);

interface NativeExchangeEvidence {
  readonly endpointBefore: RetainedNativeSupervisorLocalIpcEndpointIdentity;
  readonly endpointAfter: RetainedNativeSupervisorLocalIpcEndpointIdentity;
  readonly supervisorCredentials: {
    readonly schemaVersion: 1;
    readonly platform: 'LINUX';
    readonly authority: 'LINUX_SO_PEERCRED';
    readonly peerPid: number;
    readonly peerUid: number;
    readonly peerGid: number;
  };
  readonly workerCredentials: NativeExchangeEvidence['supervisorCredentials'];
  readonly receivedRequest: Buffer;
  readonly responseFrame: Buffer;
}

interface NativeLocalIpcAddon {
  prepare(socketPath: string): {
    readonly endpointIdentity: RetainedNativeSupervisorLocalIpcEndpointIdentity;
  };
  exchange(requestFrame: Buffer, responseFrame: Buffer): NativeExchangeEvidence;
}

const request = Object.freeze({
  schemaVersion: 1,
  requestId: 'native-recovery-request-linux-ipc-evidence',
  requestHash: 'a'.repeat(64),
  challengeNonce: 'native-linux-ipc-evidence',
  runtimeConnection: 'NOT_CONFIGURED',
}) as unknown as Readonly<RetainedNativeSupervisorRecoveryRequest>;

const response = Object.freeze({
  schemaVersion: 1,
  responseId: 'native-recovery-response-linux-ipc-evidence',
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

function authorization(
  endpoint: Readonly<RetainedNativeSupervisorLocalIpcEndpointIdentity>,
  drift: Partial<RetainedNativeSupervisorLocalIpcAuthorization> = {},
): RetainedNativeSupervisorLocalIpcAuthorization {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    socketPath: endpoint.socketPath,
    socketDevice: endpoint.socketDevice,
    socketInode: endpoint.socketInode,
    socketOwnerUid: endpoint.socketOwnerUid,
    socketOwnerGid: endpoint.socketOwnerGid,
    socketMode: endpoint.socketMode,
    expectedPeerPid: process.pid,
    expectedPeerUid: process.geteuid!(),
    expectedPeerGid: process.getegid!(),
    runtimeConnection: 'NOT_CONFIGURED',
    ...drift,
  };
}

class NativeEvidenceClient implements RetainedNativeSupervisorLocalIpcClient {
  evidence?: NativeExchangeEvidence;

  constructor(
    private readonly addon: NativeLocalIpcAddon,
    private readonly socketPath: string,
    private readonly responseFrame = frame('SUPERVISOR_TO_WORKER', response),
  ) {}

  async exchange(
    socketPath: string,
    requestFrame: Readonly<Uint8Array>,
    signal: AbortSignal,
  ): Promise<unknown> {
    expect(socketPath).toBe(this.socketPath);
    expect(signal.aborted).toBe(false);
    this.evidence = this.addon.exchange(Buffer.from(requestFrame), this.responseFrame);
    return {
      endpointBefore: this.evidence.endpointBefore,
      peerCredentials: this.evidence.supervisorCredentials,
      endpointAfter: this.evidence.endpointAfter,
      responseFrame: this.evidence.responseFrame,
    };
  }
}

describeLinux('retained-native local IPC Linux kernel evidence', () => {
  let ownedRoot: string;
  let addon: NativeLocalIpcAddon;
  let sequence = 0;
  const nextSocket = () => join(ownedRoot, `ipc-${(sequence += 1)}.sock`);

  beforeAll(() => {
    expect(spawnSync('cc', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status).toBe(0);
    ownedRoot = mkdtempSync(join(tmpdir(), 'ventureos-retained-native-ipc-'));
    const addonPath = join(ownedRoot, 'retained-native-local-ipc.node');
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
        '-DNODE_GYP_MODULE_NAME=retained_native_local_ipc',
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
    addon = nativeRequire(addonPath) as NativeLocalIpcAddon;
  }, 40_000);

  afterAll(() => {
    if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true });
  });

  it('feeds exact lstat and SO_PEERCRED evidence through the worker transport', async () => {
    const socketPath = nextSocket();
    const prepared = addon.prepare(socketPath);
    const client = new NativeEvidenceClient(addon, socketPath);
    const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
      client,
      authorization(prepared.endpointIdentity),
    );

    await expect(transport.exchange(request, new AbortController().signal)).resolves.toEqual(
      response,
    );
    expect(client.evidence).toMatchObject({
      endpointBefore: prepared.endpointIdentity,
      endpointAfter: prepared.endpointIdentity,
      supervisorCredentials: {
        authority: 'LINUX_SO_PEERCRED',
        peerPid: process.pid,
        peerUid: process.geteuid!(),
        peerGid: process.getegid!(),
      },
      workerCredentials: {
        authority: 'LINUX_SO_PEERCRED',
        peerPid: process.pid,
        peerUid: process.geteuid!(),
        peerGid: process.getegid!(),
      },
    });
    expect(existsSync(socketPath)).toBe(false);
    expect(() =>
      addon.exchange(
        frame('WORKER_TO_SUPERVISOR', request),
        frame('SUPERVISOR_TO_WORKER', response),
      ),
    ).toThrow(/RETAINED_NATIVE_LOCAL_IPC_DENIED/u);
  });

  it('feeds kernel-authenticated worker credentials into the supervisor handler', async () => {
    const socketPath = nextSocket();
    const prepared = addon.prepare(socketPath);
    const requestFrame = frame('WORKER_TO_SUPERVISOR', request);
    const native = addon.exchange(requestFrame, frame('SUPERVISOR_TO_WORKER', response));
    const peer: RetainedNativeSupervisorRecoveryTransport = {
      exchange: vi.fn(async () => response),
    };
    const handler = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryHandler(
      peer,
      authorization(prepared.endpointIdentity),
    );

    await expect(
      handler.handle(
        {
          endpointIdentity: native.endpointBefore,
          peerCredentials: native.workerCredentials,
          requestFrame: native.receivedRequest,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual(frame('SUPERVISOR_TO_WORKER', response));
    expect(peer.exchange).toHaveBeenCalledOnce();
  });

  it('denies a wrong pinned peer PID after a real kernel exchange', async () => {
    const socketPath = nextSocket();
    const prepared = addon.prepare(socketPath);
    const transport = new AuthenticatedLinuxLocalRetainedNativeSupervisorRecoveryTransport(
      new NativeEvidenceClient(addon, socketPath),
      authorization(prepared.endpointIdentity, { expectedPeerPid: process.pid + 1 }),
    );
    await expect(transport.exchange(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_ATTESTATION',
    });
    expect(existsSync(socketPath)).toBe(false);
  });

  it('refuses an existing path without replacing or deleting it', () => {
    const socketPath = nextSocket();
    writeFileSync(socketPath, 'owned-marker', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    expect(() => addon.prepare(socketPath)).toThrow(/RETAINED_NATIVE_LOCAL_IPC_DENIED/u);
    expect(existsSync(socketPath)).toBe(true);
  });

  it('detects path substitution and does not delete the substituted file', () => {
    const socketPath = nextSocket();
    addon.prepare(socketPath);
    unlinkSync(socketPath);
    writeFileSync(socketPath, 'substituted-marker', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    expect(() =>
      addon.exchange(
        frame('WORKER_TO_SUPERVISOR', request),
        frame('SUPERVISOR_TO_WORKER', response),
      ),
    ).toThrow(/RETAINED_NATIVE_LOCAL_IPC_DENIED/u);
    expect(existsSync(socketPath)).toBe(true);
  });

  it('denies oversized native frames and removes only its owned socket', () => {
    const socketPath = nextSocket();
    addon.prepare(socketPath);
    expect(() =>
      addon.exchange(
        Buffer.alloc(MAX_RETAINED_NATIVE_SUPERVISOR_IPC_FRAME_BYTES + 1, 65),
        frame('SUPERVISOR_TO_WORKER', response),
      ),
    ).toThrow(/RETAINED_NATIVE_LOCAL_IPC_DENIED/u);
    expect(existsSync(socketPath)).toBe(false);
  });
});
