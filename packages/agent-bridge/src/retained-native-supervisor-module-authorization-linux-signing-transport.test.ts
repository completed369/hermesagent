import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  DenyRetainedNativeSupervisorLocalIpcClient,
  type ClosableRetainedNativeSupervisorLocalIpcClient,
} from './retained-native-supervisor-local-ipc';
import {
  BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner,
  MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES,
} from './retained-native-supervisor-module-authorization-keyless-signer';
import { AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport } from './retained-native-supervisor-module-authorization-linux-signing-transport';

const socketPath = '/run/ventureos/native-module-signer.sock';
const authorization = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  socketPath,
  socketDevice: 41,
  socketInode: 9001,
  socketOwnerUid: 700,
  socketOwnerGid: 701,
  socketMode: 0o600,
  expectedPeerPid: 810,
  expectedPeerUid: 700,
  expectedPeerGid: 701,
  runtimeConnection: 'NOT_CONFIGURED',
});
const endpoint = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_LSTAT_UNIX_SOCKET',
  fileType: 'SOCKET',
  socketPath,
  socketDevice: 41,
  socketInode: 9001,
  socketOwnerUid: 700,
  socketOwnerGid: 701,
  socketMode: 0o600,
});
const peer = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  authority: 'LINUX_SO_PEERCRED',
  peerPid: 810,
  peerUid: 700,
  peerGid: 701,
});

class FixtureClient implements ClosableRetainedNativeSupervisorLocalIpcClient {
  readonly exchange = vi.fn(
    async (
      _path: string,
      _request: Readonly<Uint8Array>,
      _signal: AbortSignal,
    ): Promise<unknown> => ({
      endpointBefore: endpoint,
      peerCredentials: peer,
      endpointAfter: endpoint,
      responseFrame: Buffer.from('{}'),
    }),
  );
  readonly close = vi.fn(async (): Promise<void> => undefined);
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

function signingRequest() {
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
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
    signerKeyId: 'native-module-signer-v1',
    snapshotPayloadHash: createHash('sha256').update(canonicalJson(payload)).digest('hex'),
    payload,
  };
}

describe('authenticated Linux local native-module signing transport', () => {
  it('binds one request to exact endpoint and SO_PEERCRED evidence', async () => {
    const client = new FixtureClient();
    const transport =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
        client,
        authorization,
      );
    const request = new TextEncoder().encode('{"request":true}');

    await expect(transport.exchange(request, new AbortController().signal)).resolves.toEqual(
      new TextEncoder().encode('{}'),
    );
    expect(client.exchange).toHaveBeenCalledWith(socketPath, request, expect.any(AbortSignal));
    await expect(transport.close()).resolves.toBeUndefined();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('composes with the keyless signer while retaining NOT_CONFIGURED runtime truth', async () => {
    const client = new FixtureClient();
    client.exchange.mockImplementation(async (_path, request) => {
      const envelope = JSON.parse(new TextDecoder().decode(request)) as Record<string, unknown>;
      return {
        endpointBefore: endpoint,
        peerCredentials: peer,
        endpointAfter: endpoint,
        responseFrame: new TextEncoder().encode(
          canonicalJson({
            protocolVersion: 1,
            purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_RESPONSE',
            runtimeConnection: 'NOT_CONFIGURED',
            signerKeyId: envelope.signerKeyId,
            snapshotPayloadHash: envelope.snapshotPayloadHash,
            signingRequestHash: envelope.signingRequestHash,
            signature: Buffer.alloc(64, 7).toString('base64'),
          }),
        ),
      };
    });
    const transport =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
        client,
        authorization,
      );
    const signer = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
      'native-module-signer-v1',
      transport,
    );

    await expect(signer.sign(signingRequest())).resolves.toMatchObject({
      signerKeyId: 'native-module-signer-v1',
      signature: Buffer.alloc(64, 7).toString('base64'),
    });
    await expect(
      transport.exchange(new Uint8Array([1, 2]), new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
  });

  it('denies unconfigured clients and malformed authorization before exchange', () => {
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
          new DenyRetainedNativeSupervisorLocalIpcClient(),
          authorization,
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
          new FixtureClient(),
          { ...authorization, runtimeConnection: 'CONNECTED' },
        ),
    ).toThrow(expectCode('INVALID_AUTHORIZATION'));
  });

  it.each([
    ['endpoint replacement', { endpointAfter: { ...endpoint, inode: 9002 } }],
    ['wrong peer', { peerCredentials: { ...peer, peerPid: 811 } }],
    ['extra result key', { extra: true }],
    [
      'endpoint accessor',
      {
        endpointBefore: Object.defineProperty({}, 'schemaVersion', {
          get: () => 1,
          enumerable: true,
        }),
      },
    ],
  ])('denies %s', async (_label, drift) => {
    const client = new FixtureClient();
    client.exchange.mockResolvedValue({
      endpointBefore: endpoint,
      peerCredentials: peer,
      endpointAfter: endpoint,
      responseFrame: Buffer.from('{}'),
      ...drift,
    });
    const transport =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
        client,
        authorization,
      );
    await expect(
      transport.exchange(new Uint8Array([1, 2]), new AbortController().signal),
    ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
    await expect(transport.close()).resolves.toBeUndefined();
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['oversized', Buffer.alloc(MAX_RETAINED_NATIVE_MODULE_SIGNING_RESPONSE_BYTES + 1)],
    ['non-bytes', '{}'],
  ])('denies a %s response', async (_label, responseFrame) => {
    const client = new FixtureClient();
    client.exchange.mockResolvedValue({
      endpointBefore: endpoint,
      peerCredentials: peer,
      endpointAfter: endpoint,
      responseFrame,
    });
    const transport =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
        client,
        authorization,
      );
    await expect(
      transport.exchange(new Uint8Array([1, 2]), new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    await expect(transport.close()).resolves.toBeUndefined();
  });

  it('denies close-before-use, cancellation, replay, and client failure', async () => {
    const cancelled =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
        new FixtureClient(),
        authorization,
      );
    await expect(cancelled.close()).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    const controller = new AbortController();
    controller.abort();
    await expect(cancelled.exchange(new Uint8Array([1, 2]), controller.signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await expect(
      cancelled.exchange(new Uint8Array([1, 2]), new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    await expect(cancelled.close()).resolves.toBeUndefined();

    const client = new FixtureClient();
    client.exchange.mockRejectedValue(new Error('private signer socket detail'));
    const failed =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
        client,
        authorization,
      );
    await expect(
      failed.exchange(new Uint8Array([1, 2]), new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    await expect(failed.close()).resolves.toBeUndefined();
    await expect(
      failed.exchange(new Uint8Array([1, 2]), new AbortController().signal),
    ).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
  });

  it('actively closes a client whose exchange remains pending after signer cancellation', async () => {
    const client = new FixtureClient();
    client.exchange.mockImplementation(async () => new Promise<never>(() => undefined));
    const transport =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
        client,
        authorization,
      );
    const signer = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
      'native-module-signer-v1',
      transport,
      100,
    );

    await expect(signer.sign(signingRequest())).rejects.toEqual(expectCode('NOT_CONFIGURED'));
    expect(client.close).toHaveBeenCalledOnce();
  });
});
