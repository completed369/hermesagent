import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  BoundedLinuxRetainedNativeSupervisorSession,
  type LinuxRetainedNativeSupervisorAcceptedSession,
  type LinuxRetainedNativeSupervisorSessionBinding,
} from './retained-native-supervisor-linux-session';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler,
  type RetainedNativeSupervisorModuleAuthorizationSigningCustodySession,
} from './retained-native-supervisor-module-authorization-signing-handler';

const socketPath = '/run/ventureos/native-module-signer.sock';
const stat = Object.freeze({
  fileType: 'SOCKET',
  device: 41,
  inode: 9001,
  ownerUid: 700,
  ownerGid: 701,
  mode: 0o600,
});
const credentials = Object.freeze({ pid: 810, uid: 700, gid: 701 });
const authorization = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  socketPath,
  socketDevice: stat.device,
  socketInode: stat.inode,
  socketOwnerUid: stat.ownerUid,
  socketOwnerGid: stat.ownerGid,
  socketMode: stat.mode,
  expectedPeerPid: credentials.pid,
  expectedPeerUid: credentials.uid,
  expectedPeerGid: credentials.gid,
  runtimeConnection: 'NOT_CONFIGURED',
});

function requestFrame(): Uint8Array {
  const payload = {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION',
    algorithm: 'ED25519',
    signerKeyId: 'native-module-signer-v1',
    snapshotId: 'snapshot-1',
    snapshotVersion: 1,
    supervisorInstanceId: 'supervisor-1',
    issuedAt: '2026-09-06T00:00:00.000Z',
    validUntil: '2026-09-06T00:05:00.000Z',
    previousSnapshotHash: null,
    authorizations: [],
  };
  const snapshotPayloadHash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
  const binding = {
    protocolVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_REQUEST',
    signerKeyId: 'native-module-signer-v1',
    snapshotPayloadHash,
    payload,
    runtimeConnection: 'NOT_CONFIGURED',
  };
  return new TextEncoder().encode(
    canonicalJson({
      ...binding,
      signingRequestHash: createHash('sha256').update(canonicalJson(binding)).digest('hex'),
    }),
  );
}

class FixtureCustody implements RetainedNativeSupervisorModuleAuthorizationSigningCustodySession {
  readonly sign = vi.fn(async () => Uint8Array.from({ length: 64 }, () => 9));
  readonly close = vi.fn(async () => undefined);
}

class FixtureAcceptedSession implements LinuxRetainedNativeSupervisorAcceptedSession {
  written: Uint8Array | undefined;
  readonly peerCredentials = vi.fn(async () => credentials);
  readonly readToEof = vi.fn(async () => requestFrame());
  readonly writeAndShutdown = vi.fn(async (frame: Readonly<Uint8Array>) => {
    this.written = Uint8Array.from(frame);
  });
  readonly close = vi.fn(async () => undefined);
}

class FixtureBinding implements LinuxRetainedNativeSupervisorSessionBinding {
  readonly platform = 'LINUX' as const;
  readonly accepted = new FixtureAcceptedSession();
  readonly lstatUnixSocket = vi.fn(async () => stat);
  readonly acceptAuthorizedUnixSocket = vi.fn(async () => this.accepted);
}

function fixture() {
  const binding = new FixtureBinding();
  const custody = new FixtureCustody();
  const handler =
    new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
      'native-module-signer-v1',
      custody,
      authorization,
    );
  return {
    binding,
    custody,
    session: new BoundedLinuxRetainedNativeSupervisorSession(binding, handler),
  };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('bounded Linux retained-native supervisor signing session', () => {
  it('owns one authenticated accept, bounded signing response, and both closes', async () => {
    const { binding, custody, session } = fixture();

    await expect(
      session.handleOne(socketPath, new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(custody.sign).toHaveBeenCalledOnce();
    expect(custody.close).toHaveBeenCalledOnce();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
    expect(binding.accepted.writeAndShutdown).toHaveBeenCalledOnce();
    const response = JSON.parse(new TextDecoder().decode(binding.accepted.written)) as Record<
      string,
      unknown
    >;
    expect(response).toEqual({
      protocolVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_RESPONSE',
      runtimeConnection: 'NOT_CONFIGURED',
      signature: Buffer.alloc(64, 9).toString('base64'),
      signerKeyId: 'native-module-signer-v1',
      signingRequestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      snapshotPayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('closes unattempted custody when endpoint evidence fails before accept', async () => {
    const { binding, custody, session } = fixture();
    binding.lstatUnixSocket.mockResolvedValue({ ...stat, inode: 0 } as never);

    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('INVALID_ATTESTATION'),
    );
    expect(binding.acceptAuthorizedUnixSocket).not.toHaveBeenCalled();
    expect(custody.sign).not.toHaveBeenCalled();
    expect(custody.close).toHaveBeenCalledOnce();
  });

  it('closes custody and the accepted socket when reading fails before handler invocation', async () => {
    const { binding, custody, session } = fixture();
    binding.accepted.readToEof.mockRejectedValue(new Error('private native read detail'));

    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(custody.sign).not.toHaveBeenCalled();
    expect(custody.close).toHaveBeenCalledOnce();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
    expect(binding.accepted.writeAndShutdown).not.toHaveBeenCalled();
  });

  it('withholds the response when signing custody close fails', async () => {
    const { binding, custody, session } = fixture();
    custody.close.mockRejectedValue(new Error('private custody close detail'));

    await expect(session.handleOne(socketPath, new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(binding.accepted.writeAndShutdown).not.toHaveBeenCalled();
    expect(binding.accepted.close).toHaveBeenCalledOnce();
  });
});
