import { createHash, generateKeyPairSync, sign as ed25519Sign, verify } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  type ClosableRetainedNativeSupervisorLocalIpcClient,
  DenyRetainedNativeSupervisorLocalIpcClient,
} from './retained-native-supervisor-local-ipc';
import { BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner } from './retained-native-supervisor-module-authorization-keyless-signer';
import { AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport } from './retained-native-supervisor-module-authorization-linux-signing-transport';
import {
  AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler,
  DenyRetainedNativeSupervisorModuleAuthorizationSigningCustodySession,
  type RetainedNativeSupervisorModuleAuthorizationSigningCustodySession,
} from './retained-native-supervisor-module-authorization-signing-handler';

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

function payload() {
  return {
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
}

function signingRequest() {
  const snapshot = payload();
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
    signerKeyId: 'native-module-signer-v1',
    snapshotPayloadHash: createHash('sha256').update(canonicalJson(snapshot)).digest('hex'),
    payload: snapshot,
  };
}

function requestEnvelope() {
  const request = signingRequest();
  const binding = {
    protocolVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_REQUEST',
    signerKeyId: request.signerKeyId,
    snapshotPayloadHash: request.snapshotPayloadHash,
    payload: request.payload,
    runtimeConnection: 'NOT_CONFIGURED',
  };
  return {
    ...binding,
    signingRequestHash: createHash('sha256').update(canonicalJson(binding)).digest('hex'),
  };
}

function inbound(
  requestFrame: unknown = new TextEncoder().encode(canonicalJson(requestEnvelope())),
) {
  return { endpointIdentity: endpoint, peerCredentials: peer, requestFrame };
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

class FixtureCustody implements RetainedNativeSupervisorModuleAuthorizationSigningCustodySession {
  readonly sign = vi.fn(async (_payload: Readonly<Uint8Array>, _signal: AbortSignal) =>
    Uint8Array.from({ length: 64 }, () => 7),
  );
  readonly close = vi.fn(async () => undefined);
}

describe('authenticated supervisor native-module signing handler', () => {
  it('completes the real client protocol and produces an independently verifiable signature', async () => {
    const keyPair = generateKeyPairSync('ed25519');
    const custody = new FixtureCustody();
    custody.sign.mockImplementation(async (bytes) =>
      ed25519Sign(null, Buffer.from(bytes), keyPair.privateKey),
    );
    const handler =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        custody,
        authorization,
      );
    const client: ClosableRetainedNativeSupervisorLocalIpcClient = {
      async exchange(_path, requestFrame, signal) {
        return {
          endpointBefore: endpoint,
          peerCredentials: peer,
          endpointAfter: endpoint,
          responseFrame: await handler.handle(inbound(requestFrame), signal),
        };
      },
      async close() {},
    };
    const transport =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
        client,
        authorization,
      );
    const signer = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
      'native-module-signer-v1',
      transport,
    );

    const result = (await signer.sign(signingRequest())) as Record<string, unknown>;

    expect(result).toMatchObject({
      schemaVersion: 1,
      signerKeyId: 'native-module-signer-v1',
      snapshotPayloadHash: signingRequest().snapshotPayloadHash,
    });
    expect(
      verify(
        null,
        Buffer.from(canonicalJson(payload())),
        keyPair.publicKey,
        Buffer.from(result.signature as string, 'base64'),
      ),
    ).toBe(true);
    expect(custody.sign).toHaveBeenCalledOnce();
    expect(custody.close).toHaveBeenCalledOnce();
  });

  it('denies endpoint or peer drift before custody and still closes the one-use session', async () => {
    const custody = new FixtureCustody();
    const handler =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        custody,
        authorization,
      );

    await expect(
      handler.handle(
        { ...inbound(), peerCredentials: { ...peer, peerPid: 811 } },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expectCode('INVALID_ATTESTATION'));
    expect(custody.sign).not.toHaveBeenCalled();
    expect(custody.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['non-canonical JSON', new TextEncoder().encode(JSON.stringify(requestEnvelope(), null, 2))],
    [
      'runtime promotion',
      new TextEncoder().encode(
        canonicalJson({ ...requestEnvelope(), runtimeConnection: 'CONNECTED' }),
      ),
    ],
    [
      'payload drift',
      new TextEncoder().encode(
        canonicalJson({ ...requestEnvelope(), payload: { ...payload(), snapshotVersion: 2 } }),
      ),
    ],
    [
      'request hash drift',
      new TextEncoder().encode(
        canonicalJson({ ...requestEnvelope(), signingRequestHash: '0'.repeat(64) }),
      ),
    ],
    [
      'extra field',
      new TextEncoder().encode(canonicalJson({ ...requestEnvelope(), privateKey: 'forbidden' })),
    ],
    ['invalid UTF-8', new Uint8Array([0xc3, 0x28])],
    ['oversized', new Uint8Array(32 * 1_024 + 1)],
  ])('denies %s without invoking custody', async (_label, requestFrame) => {
    const custody = new FixtureCustody();
    const handler =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        custody,
        authorization,
      );
    await expect(
      handler.handle(inbound(requestFrame), new AbortController().signal),
    ).rejects.toEqual(expect.objectContaining({ code: expect.any(String) }));
    expect(custody.sign).not.toHaveBeenCalled();
    expect(custody.close).toHaveBeenCalledOnce();
  });

  it('denies a malformed signature, replay, and unconfigured custody', async () => {
    const custody = new FixtureCustody();
    custody.sign.mockResolvedValue(new Uint8Array(63));
    const handler =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        custody,
        authorization,
      );
    await expect(handler.handle(inbound(), new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    await expect(handler.handle(inbound(), new AbortController().signal)).rejects.toEqual(
      expectCode('CONCURRENT_EXCHANGE'),
    );
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
          'native-module-signer-v1',
          new DenyRetainedNativeSupervisorModuleAuthorizationSigningCustodySession(),
          authorization,
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
  });

  it('aborts and closes a hung custody session without returning a late signature', async () => {
    const custody = new FixtureCustody();
    custody.sign.mockImplementation(async () => new Promise<never>(() => undefined));
    const handler =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        custody,
        authorization,
        100,
      );

    await expect(handler.handle(inbound(), new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(custody.close).toHaveBeenCalledOnce();
    expect(custody.sign.mock.calls[0]?.[1].aborted).toBe(true);
  });

  it('denies cancellation and redacts custody and close failures', async () => {
    const cancelledCustody = new FixtureCustody();
    const cancelled =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        cancelledCustody,
        authorization,
      );
    const controller = new AbortController();
    controller.abort();
    await expect(cancelled.handle(inbound(), controller.signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
    expect(cancelledCustody.sign).not.toHaveBeenCalled();
    expect(cancelledCustody.close).toHaveBeenCalledOnce();

    const activeCustody = new FixtureCustody();
    activeCustody.sign.mockImplementation(async () => new Promise<never>(() => undefined));
    const active =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        activeCustody,
        authorization,
      );
    const activeController = new AbortController();
    const activeExchange = active.handle(inbound(), activeController.signal);
    activeController.abort();
    await expect(activeExchange).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(activeCustody.close).toHaveBeenCalledOnce();

    const failedCustody = new FixtureCustody();
    failedCustody.sign.mockRejectedValue(new Error('HSM slot and secret detail'));
    failedCustody.close.mockRejectedValue(new Error('private socket detail'));
    const failed =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        failedCustody,
        authorization,
      );
    await expect(failed.handle(inbound(), new AbortController().signal)).rejects.toEqual(
      expectCode('EXCHANGE_DENIED'),
    );
  });

  it('cannot be composed with a deny local IPC client', () => {
    expect(
      () =>
        new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningTransport(
          new DenyRetainedNativeSupervisorLocalIpcClient(),
          authorization,
        ),
    ).toThrow(expectCode('NOT_CONFIGURED'));
  });

  it('shares explicit close and aborts active custody without permitting later use', async () => {
    const unopenedCustody = new FixtureCustody();
    const unopened =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        unopenedCustody,
        authorization,
      );
    await Promise.all([unopened.close(), unopened.close()]);
    expect(unopenedCustody.close).toHaveBeenCalledOnce();
    await expect(unopened.handle(inbound(), new AbortController().signal)).rejects.toEqual(
      expectCode('CONCURRENT_EXCHANGE'),
    );

    const activeCustody = new FixtureCustody();
    activeCustody.sign.mockImplementation(async () => new Promise<never>(() => undefined));
    const active =
      new AuthenticatedLinuxLocalRetainedNativeSupervisorModuleAuthorizationSigningHandler(
        'native-module-signer-v1',
        activeCustody,
        authorization,
      );
    const exchange = active.handle(inbound(), new AbortController().signal);
    await active.close();
    await expect(exchange).rejects.toEqual(expectCode('EXCHANGE_DENIED'));
    expect(activeCustody.sign.mock.calls[0]?.[1].aborted).toBe(true);
    expect(activeCustody.close).toHaveBeenCalledOnce();
  });
});
