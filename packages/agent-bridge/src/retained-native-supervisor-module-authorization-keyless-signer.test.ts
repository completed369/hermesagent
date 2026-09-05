import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from './codec';
import type { RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest } from './retained-native-supervisor-module-authorization-controller';
import {
  BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner,
  type RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport,
} from './retained-native-supervisor-module-authorization-keyless-signer';
import { RetainedNativeSupervisorLocalIpcError } from './retained-native-supervisor-local-ipc';

const SIGNER = 'native-module-root-signer-1';

function signingRequest(): Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest> {
  const payload = Object.freeze({
    schemaVersion: 1 as const,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION' as const,
    snapshotId: 'native-module-snapshot-1',
    snapshotVersion: 1,
    signerKeyId: SIGNER,
    algorithm: 'ED25519' as const,
    supervisorInstanceId: 'native-supervisor-1',
    issuedAt: '2026-09-06T00:00:00.000Z',
    validUntil: '2026-09-06T00:05:00.000Z',
    previousSnapshotHash: null,
    authorizations: Object.freeze([]),
  });
  return Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
    signerKeyId: SIGNER,
    snapshotPayloadHash: createHash('sha256').update(canonicalJson(payload)).digest('hex'),
    payload,
  });
}

type Producer = (request: Record<string, unknown>) => unknown | Promise<unknown>;

class SigningTransport implements RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport {
  calls = 0;
  closes = 0;
  requestText = '';

  constructor(
    private readonly producer: Producer,
    private readonly closeError = false,
  ) {}

  async exchange(request: Uint8Array, _signal: AbortSignal): Promise<unknown> {
    this.calls += 1;
    this.requestText = new TextDecoder().decode(request);
    return this.producer(JSON.parse(this.requestText) as Record<string, unknown>);
  }

  async close(): Promise<void> {
    this.closes += 1;
    if (this.closeError) throw new Error('synthetic close failure');
  }
}

function encoded(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

describe('bounded keyless retained-native module snapshot signer', () => {
  it('signs only the canonical approved payload and closes the channel before returning', async () => {
    const keys = generateKeyPairSync('ed25519');
    const transport = new SigningTransport((envelope) =>
      encoded({
        protocolVersion: 1,
        purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_RESPONSE',
        runtimeConnection: 'NOT_CONFIGURED',
        signature: sign(
          null,
          Buffer.from(canonicalJson(envelope.payload)),
          keys.privateKey,
        ).toString('base64'),
        signerKeyId: envelope.signerKeyId,
        signingRequestHash: envelope.signingRequestHash,
        snapshotPayloadHash: envelope.snapshotPayloadHash,
      }),
    );
    const signer = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
      SIGNER,
      transport,
    );

    const result = (await signer.sign(signingRequest())) as Record<string, unknown>;

    expect(transport.calls).toBe(1);
    expect(transport.closes).toBe(1);
    expect(transport.requestText).toBe(canonicalJson(JSON.parse(transport.requestText)));
    expect(transport.requestText).not.toMatch(/private|credential|secret|signature/iu);
    expect(result).toMatchObject({
      schemaVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
      signerKeyId: SIGNER,
      snapshotPayloadHash: signingRequest().snapshotPayloadHash,
    });
    expect(
      verify(
        null,
        Buffer.from(canonicalJson(signingRequest().payload)),
        keys.publicKey,
        Buffer.from(result.signature as string, 'base64'),
      ),
    ).toBe(true);
    await expect(signer.sign(signingRequest())).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    expect(transport.calls).toBe(1);
  });

  it('denies signer, payload-hash, shape, prototype, and accessor drift before transport', async () => {
    const valid = signingRequest();
    const cases: unknown[] = [
      { ...valid, signerKeyId: 'other-signer' },
      { ...valid, snapshotPayloadHash: '0'.repeat(64) },
      { ...valid, unexpected: true },
      Object.assign(Object.create({ inherited: true }), valid),
    ];
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, 'signerKeyId', {
      enumerable: true,
      get: () => SIGNER,
    });
    cases.push(accessor);

    for (const candidate of cases) {
      const transport = new SigningTransport(() => encoded({}));
      const signer = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
        SIGNER,
        transport,
      );
      await expect(signer.sign(candidate)).rejects.toBeInstanceOf(
        RetainedNativeSupervisorLocalIpcError,
      );
      expect(transport.calls).toBe(0);
      expect(transport.closes).toBe(1);
      await expect(signer.sign(valid)).rejects.toBeInstanceOf(
        RetainedNativeSupervisorLocalIpcError,
      );
    }
  });

  it('denies non-canonical, oversized, malformed, and request-drifted responses after closing', async () => {
    const valid = signingRequest();
    const signature = Buffer.alloc(64, 7).toString('base64');
    const response = (envelope: Record<string, unknown>) => ({
      protocolVersion: 1,
      purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_SIGNING_RESPONSE',
      runtimeConnection: 'NOT_CONFIGURED',
      signature,
      signerKeyId: envelope.signerKeyId,
      signingRequestHash: envelope.signingRequestHash,
      snapshotPayloadHash: envelope.snapshotPayloadHash,
    });
    const producers: Producer[] = [
      (envelope) => new TextEncoder().encode(` ${canonicalJson(response(envelope))}`),
      () => new Uint8Array(1_025),
      () => new TextEncoder().encode('{'),
      (envelope) => encoded({ ...response(envelope), signingRequestHash: '0'.repeat(64) }),
      (envelope) => encoded({ ...response(envelope), runtimeConnection: 'CONNECTED' }),
      (envelope) => Buffer.from(canonicalJson(response(envelope))),
    ];

    for (const producer of producers) {
      const transport = new SigningTransport(producer);
      const signer = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
        SIGNER,
        transport,
      );
      await expect(signer.sign(valid)).rejects.toBeInstanceOf(
        RetainedNativeSupervisorLocalIpcError,
      );
      expect(transport.calls).toBe(1);
      expect(transport.closes).toBe(1);
    }
  });

  it('fails closed on exchange timeout and channel-close failure', async () => {
    const stalled = new SigningTransport(() => new Promise<never>(() => undefined));
    const timed = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
      SIGNER,
      stalled,
      100,
    );
    await expect(timed.sign(signingRequest())).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    expect(stalled.closes).toBe(1);

    const closeFailure = new SigningTransport(() => encoded({}), true);
    const signer = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
      SIGNER,
      closeFailure,
    );
    await expect(signer.sign(signingRequest())).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    expect(closeFailure.closes).toBe(1);

    let hangingCloseCalls = 0;
    const hangingClose: RetainedNativeSupervisorModuleAuthorizationKeylessSigningTransport = {
      async exchange() {
        return encoded({});
      },
      async close() {
        hangingCloseCalls += 1;
        return new Promise<never>(() => undefined);
      },
    };
    const boundedClose =
      new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
        SIGNER,
        hangingClose,
        100,
      );
    await expect(boundedClose.sign(signingRequest())).rejects.toBeInstanceOf(
      RetainedNativeSupervisorLocalIpcError,
    );
    expect(hangingCloseCalls).toBe(1);
  });

  it('rejects invalid construction and overlarge canonical signing requests', async () => {
    const transport = new SigningTransport(() => encoded({}));
    expect(
      () =>
        new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
          'secret-key',
          transport,
        ),
    ).toThrow(RetainedNativeSupervisorLocalIpcError);
    expect(
      () =>
        new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
          SIGNER,
          transport,
          99,
        ),
    ).toThrow(RetainedNativeSupervisorLocalIpcError);

    const base = signingRequest();
    const payload = {
      ...base.payload,
      authorizations: Array.from({ length: 256 }, (_, index) => ({
        authorizationId: `authorization-${index}-${'x'.repeat(1_900)}`,
      })),
    };
    const large = {
      ...base,
      payload,
      snapshotPayloadHash: createHash('sha256').update(canonicalJson(payload)).digest('hex'),
    };
    const signer = new BoundedKeylessRetainedNativeSupervisorModuleAuthorizationSnapshotSigner(
      SIGNER,
      transport,
    );
    await expect(signer.sign(large)).rejects.toBeInstanceOf(RetainedNativeSupervisorLocalIpcError);
    expect(transport.calls).toBe(0);
    expect(transport.closes).toBe(1);
  });
});
