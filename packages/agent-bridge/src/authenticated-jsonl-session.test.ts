import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveBridgeKeys,
  digestBridgePayload,
  digestSecretReference,
  signBridgeEnvelope,
} from './auth';
import {
  AuthenticatedJsonlSessionError,
  AuthenticatedRuntimeJsonlSession,
  MAX_AUTHENTICATED_BATCH_FRAMES,
  MAX_AUTHENTICATED_INGEST_BYTES,
  MAX_AUTHENTICATED_SESSION_FRAMES,
  type AuthenticatedJsonlSessionContext,
} from './authenticated-jsonl-session';
import { encodeBridgeLine } from './codec';
import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope, type BridgeMessageType } from './protocol';
import {
  DenyBridgeSecretLeaseResolver,
  ScopedBridgeSecretLeaseResolver,
  type BridgeSecretLeaseResolver,
  type BridgeSecretLeaseRequest,
} from './secret-lease';

const NOW = new Date('2026-08-27T00:00:00.000Z');
const SECRET = new Uint8Array(32).fill(7);

const context = (
  overrides: Partial<AuthenticatedJsonlSessionContext> = {},
): AuthenticatedJsonlSessionContext => ({
  schemaVersion: 1,
  workspaceId: 'workspace-one',
  runtimeId: 'runtime-one',
  connectionId: 'connection-one',
  sessionId: 'session-one',
  principalReference: 'principal-one',
  parentNonce: 'parent-nonce-one',
  runtimeNonce: 'runtime-nonce-one',
  secretReference: 'vault-item-one',
  expectedSecretDigest: digestSecretReference(SECRET),
  authGeneration: 1,
  authenticatedAt: NOW.toISOString(),
  expiresAt: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
  ...overrides,
});

function signedFrame(
  sequence: number,
  type: BridgeMessageType = sequence === 1 ? 'CAPABILITIES' : 'HEARTBEAT',
  payload: Record<string, unknown> = type === 'CAPABILITIES'
    ? { protocol: 'jsonl-v1' }
    : { health: 'HEALTHY' },
  overrides: Partial<Omit<BridgeEnvelope, 'mac' | 'payload' | 'payloadDigest'>> = {},
): BridgeEnvelope {
  const frameContext = context();
  const unsigned: Omit<BridgeEnvelope, 'mac'> = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    workspaceId: frameContext.workspaceId,
    runtimeId: frameContext.runtimeId,
    connectionId: frameContext.connectionId,
    sessionId: frameContext.sessionId,
    principalReference: frameContext.principalReference,
    sequence,
    messageId: `message-${sequence}`,
    type,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    payloadDigest: digestBridgePayload(payload),
    payload,
    ...overrides,
  };
  const keys = deriveBridgeKeys(SECRET, {
    workspaceId: frameContext.workspaceId,
    runtimeId: frameContext.runtimeId,
    connectionId: frameContext.connectionId,
    sessionId: frameContext.sessionId,
    principalReference: frameContext.principalReference,
    parentNonce: frameContext.parentNonce,
    runtimeNonce: frameContext.runtimeNonce,
  });
  try {
    return signBridgeEnvelope(unsigned, keys.runtimeToParent);
  } finally {
    keys.parentToRuntime.fill(0);
    keys.runtimeToParent.fill(0);
  }
}

const line = (frame: BridgeEnvelope): Uint8Array => encodeBridgeLine(frame);
const join = (...chunks: Uint8Array[]): Uint8Array =>
  Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

function resolver(requests: BridgeSecretLeaseRequest[] = []): ScopedBridgeSecretLeaseResolver {
  return new ScopedBridgeSecretLeaseResolver({
    async resolve(request) {
      requests.push(request);
      return SECRET;
    },
  });
}

function resolverThatAdvancesAfterVerification(milliseconds: number): BridgeSecretLeaseResolver {
  return {
    async withSecret<T>(
      _request: Readonly<BridgeSecretLeaseRequest>,
      consumer: (secret: Uint8Array) => Promise<T> | T,
    ): Promise<T> {
      const lease = Uint8Array.from(SECRET);
      try {
        const result = await consumer(lease);
        vi.setSystemTime(new Date(NOW.getTime() + milliseconds));
        return result;
      } finally {
        lease.fill(0);
      }
    },
  };
}

describe('authenticated runtime JSONL session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('accepts split and coalesced runtime frames with exact leased scope and frozen output', async () => {
    const requests: BridgeSecretLeaseRequest[] = [];
    const session = new AuthenticatedRuntimeJsonlSession(context(), resolver(requests));
    const first = line(signedFrame(1));
    const splitAt = Math.floor(first.byteLength / 2);

    await expect(session.ingest(first.subarray(0, splitAt))).resolves.toEqual([]);
    expect(session.snapshot()).toMatchObject({
      acceptedFrames: 0,
      ingestedBytes: splitAt,
      bufferedBytes: splitAt,
      capabilitiesAccepted: false,
    });
    const accepted = await session.ingest(
      join(first.subarray(splitAt), line(signedFrame(2, 'PROGRESS', { percent: 25 }))),
    );

    expect(accepted.map((frame) => frame.sequence)).toEqual([1, 2]);
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted[1])).toBe(true);
    expect(Object.isFrozen(accepted[1]!.payload)).toBe(true);
    expect(session.snapshot()).toMatchObject({
      state: 'ACTIVE',
      nextSequence: 3,
      acceptedFrames: 2,
      bufferedBytes: 0,
      capabilitiesAccepted: true,
    });
    expect(requests).toEqual([
      {
        workspaceId: 'workspace-one',
        runtimeId: 'runtime-one',
        connectionId: 'connection-one',
        secretReference: 'vault-item-one',
        expectedDigest: context().expectedSecretDigest,
        authGeneration: 1,
        purpose: 'VERIFY_FRAME',
      },
    ]);
    expect(Object.isFrozen(session.context())).toBe(true);
  });

  it.each([
    [{ ...context(), extra: true }, 'INVALID_CONTEXT'],
    [context({ workspaceId: 'password-reference' }), 'INVALID_CONTEXT'],
    [context({ authenticatedAt: '2026-08-27 00:00:00Z' }), 'INVALID_CONTEXT'],
    [context({ expiresAt: NOW.toISOString() }), 'INVALID_CONTEXT'],
    [
      context({ expiresAt: new Date(NOW.getTime() + 15 * 60_000 + 1).toISOString() }),
      'INVALID_CONTEXT',
    ],
  ])('rejects malformed or unbounded context with a fixed error', (candidate, code) => {
    expect(() => new AuthenticatedRuntimeJsonlSession(candidate, resolver())).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('sanitizes exceptional context objects', () => {
    const candidate = new Proxy(context(), {
      ownKeys() {
        throw new Error('private parser detail');
      },
    });
    expect(() => new AuthenticatedRuntimeJsonlSession(candidate, resolver())).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONTEXT' }),
    );
  });

  it.each(['CHALLENGE', 'AUTHENTICATE'] as const)(
    'forbids post-authentication %s frames and becomes terminal',
    async (type) => {
      const session = new AuthenticatedRuntimeJsonlSession(context(), resolver());
      await expect(session.ingest(line(signedFrame(1, type)))).rejects.toMatchObject({
        code: 'FORBIDDEN_MESSAGE',
      });
      expect(session.snapshot()).toMatchObject({ state: 'FAILED', acceptedFrames: 0 });
      await expect(session.ingest(line(signedFrame(1)))).rejects.toMatchObject({
        code: 'TERMINAL',
      });
    },
  );

  it('requires exactly one first CAPABILITIES frame and commits that phase atomically', async () => {
    const beforeCapabilities = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    await expect(
      beforeCapabilities.ingest(line(signedFrame(1, 'HEARTBEAT'))),
    ).rejects.toMatchObject({ code: 'PROTOCOL_STATE' });

    const duplicate = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    await duplicate.ingest(line(signedFrame(1)));
    await expect(duplicate.ingest(line(signedFrame(2, 'CAPABILITIES')))).rejects.toMatchObject({
      code: 'PROTOCOL_STATE',
    });

    const sameBatch = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    await expect(
      sameBatch.ingest(join(line(signedFrame(1)), line(signedFrame(2)))),
    ).resolves.toHaveLength(2);
    expect(sameBatch.snapshot()).toMatchObject({ capabilitiesAccepted: true, nextSequence: 3 });

    const duplicateInBatch = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    await expect(
      duplicateInBatch.ingest(
        join(line(signedFrame(1)), line(signedFrame(2)), line(signedFrame(3, 'CAPABILITIES'))),
      ),
    ).rejects.toMatchObject({ code: 'PROTOCOL_STATE' });
    expect(duplicateInBatch.snapshot()).toEqual({
      state: 'FAILED',
      nextSequence: 1,
      acceptedFrames: 0,
      ingestedBytes: 0,
      bufferedBytes: 0,
      capabilitiesAccepted: false,
    });
  });

  it('rejects sequence drift before leasing and commits none of a batch', async () => {
    const requests: BridgeSecretLeaseRequest[] = [];
    const session = new AuthenticatedRuntimeJsonlSession(context(), resolver(requests));
    await expect(
      session.ingest(join(line(signedFrame(1)), line(signedFrame(3)))),
    ).rejects.toMatchObject({ code: 'SEQUENCE_MISMATCH' });
    expect(requests).toHaveLength(0);
    expect(session.snapshot()).toEqual({
      state: 'FAILED',
      nextSequence: 1,
      acceptedFrames: 0,
      ingestedBytes: 0,
      bufferedBytes: 0,
      capabilitiesAccepted: false,
    });
  });

  it('verifies the whole batch before committing any envelope', async () => {
    const bad = signedFrame(2);
    const invalidMac = `${bad.mac[0] === 'A' ? 'B' : 'A'}${bad.mac.slice(1)}`;
    const session = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    await expect(
      session.ingest(join(line(signedFrame(1)), line({ ...bad, mac: invalidMac }))),
    ).rejects.toMatchObject({ code: 'FRAME_INVALID' });
    expect(session.snapshot()).toMatchObject({
      state: 'FAILED',
      nextSequence: 1,
      acceptedFrames: 0,
      ingestedBytes: 0,
      capabilitiesAccepted: false,
    });
  });

  it('denies a concurrent ingest and prevents the waiting ingest from committing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = new ScopedBridgeSecretLeaseResolver({
      async resolve() {
        await gate;
        return SECRET;
      },
    });
    const session = new AuthenticatedRuntimeJsonlSession(context(), delayed);
    const first = session.ingest(line(signedFrame(1)));
    await Promise.resolve();
    await expect(session.ingest(line(signedFrame(1)))).rejects.toMatchObject({
      code: 'CONCURRENT_INGEST',
    });
    release();
    await expect(first).rejects.toMatchObject({ code: 'TERMINAL' });
    expect(session.snapshot()).toMatchObject({ state: 'FAILED', acceptedFrames: 0 });
  });

  it.each([
    ['sensitive text', { note: 'secret=hunter2' }],
    ['control text', { note: 'hello\u0001world' }],
    ['unsafe key', { constructor: 'value' }],
    [
      'deep payload',
      Array.from({ length: 10 }).reduce<Record<string, unknown>>((nested) => ({ nested }), {
        value: 1,
      }),
    ],
  ])('denies %s without exposing parser details', async (_name, payload) => {
    const session = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    await expect(session.ingest(line(signedFrame(1, 'PROGRESS', payload)))).rejects.toEqual(
      new AuthenticatedJsonlSessionError('FRAME_INVALID'),
    );
  });

  it('rejects an oversized chunk before copying it', async () => {
    const from = vi.spyOn(Uint8Array, 'from');
    const session = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    await expect(
      session.ingest(new Uint8Array(MAX_AUTHENTICATED_INGEST_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'SESSION_LIMIT' });
    expect(from).not.toHaveBeenCalled();
  });

  it('enforces per-batch and per-session frame bounds', async () => {
    const tooMany = Array.from({ length: MAX_AUTHENTICATED_BATCH_FRAMES + 1 }, (_, index) =>
      line(signedFrame(index + 1)),
    );
    const batchSession = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    await expect(batchSession.ingest(join(...tooMany))).rejects.toMatchObject({
      code: 'SESSION_LIMIT',
    });

    const session = new AuthenticatedRuntimeJsonlSession(context(), resolver());
    for (let offset = 0; offset < MAX_AUTHENTICATED_SESSION_FRAMES; offset += 32) {
      const frames = Array.from({ length: 32 }, (_, index) =>
        line(signedFrame(offset + index + 1)),
      );
      await session.ingest(join(...frames));
    }
    await expect(
      session.ingest(line(signedFrame(MAX_AUTHENTICATED_SESSION_FRAMES + 1))),
    ).rejects.toMatchObject({ code: 'SESSION_LIMIT' });
  });

  it('enforces exact frame time and session expiry boundaries', async () => {
    const boundary = signedFrame(
      1,
      'CAPABILITIES',
      { protocol: 'jsonl-v1' },
      {
        issuedAt: new Date(NOW.getTime() + 30_000).toISOString(),
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    );
    await expect(
      new AuthenticatedRuntimeJsonlSession(context(), resolver()).ingest(line(boundary)),
    ).resolves.toHaveLength(1);

    const future = signedFrame(
      1,
      'CAPABILITIES',
      { protocol: 'jsonl-v1' },
      {
        issuedAt: new Date(NOW.getTime() + 30_001).toISOString(),
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    );
    await expect(
      new AuthenticatedRuntimeJsonlSession(context(), resolver()).ingest(line(future)),
    ).rejects.toMatchObject({ code: 'FRAME_INVALID' });

    const preAuthentication = signedFrame(
      1,
      'CAPABILITIES',
      { protocol: 'jsonl-v1' },
      {
        issuedAt: new Date(NOW.getTime() - 1).toISOString(),
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    );
    await expect(
      new AuthenticatedRuntimeJsonlSession(context(), resolver()).ingest(line(preAuthentication)),
    ).rejects.toMatchObject({ code: 'FRAME_INVALID' });

    const outsideSession = signedFrame(
      1,
      'CAPABILITIES',
      { protocol: 'jsonl-v1' },
      {
        issuedAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    );
    await expect(
      new AuthenticatedRuntimeJsonlSession(
        context({ expiresAt: new Date(NOW.getTime() + 30_000).toISOString() }),
        resolver(),
      ).ingest(line(outsideSession)),
    ).rejects.toMatchObject({ code: 'FRAME_INVALID' });

    const session = new AuthenticatedRuntimeJsonlSession(
      context({ expiresAt: new Date(NOW.getTime() + 1).toISOString() }),
      resolver(),
    );
    vi.setSystemTime(new Date(NOW.getTime() + 1));
    await expect(session.ingest(line(signedFrame(1)))).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('rechecks frame and session expiry after the secret lease returns and commits nothing', async () => {
    const delayedPastFrame = new AuthenticatedRuntimeJsonlSession(
      context(),
      resolverThatAdvancesAfterVerification(60_000),
    );
    await expect(delayedPastFrame.ingest(line(signedFrame(1)))).rejects.toMatchObject({
      code: 'FRAME_INVALID',
    });
    expect(delayedPastFrame.snapshot()).toMatchObject({
      state: 'FAILED',
      acceptedFrames: 0,
      ingestedBytes: 0,
      capabilitiesAccepted: false,
    });

    vi.setSystemTime(NOW);
    const delayedPastSession = new AuthenticatedRuntimeJsonlSession(
      context({ expiresAt: new Date(NOW.getTime() + 30_000).toISOString() }),
      resolverThatAdvancesAfterVerification(30_000),
    );
    const sessionBoundFrame = signedFrame(
      1,
      'CAPABILITIES',
      { protocol: 'jsonl-v1' },
      { expiresAt: new Date(NOW.getTime() + 30_000).toISOString() },
    );
    await expect(delayedPastSession.ingest(line(sessionBoundFrame))).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(delayedPastSession.snapshot()).toMatchObject({
      state: 'FAILED',
      acceptedFrames: 0,
      ingestedBytes: 0,
      capabilitiesAccepted: false,
    });
  });

  it.each([
    [
      'skips the verifier callback',
      (): BridgeSecretLeaseResolver => ({
        async withSecret<T>(): Promise<T> {
          return undefined as T;
        },
      }),
      (): BridgeEnvelope => signedFrame(1),
    ],
    [
      'swallows a verifier callback failure',
      (): BridgeSecretLeaseResolver => ({
        async withSecret<T>(
          _request: Readonly<BridgeSecretLeaseRequest>,
          consumer: (secret: Uint8Array) => Promise<T> | T,
        ): Promise<T> {
          const lease = Uint8Array.from(SECRET);
          try {
            return await consumer(lease);
          } catch {
            return undefined as T;
          } finally {
            lease.fill(0);
          }
        },
      }),
      (): BridgeEnvelope => {
        const valid = signedFrame(1);
        return {
          ...valid,
          mac: `${valid.mac[0] === 'A' ? 'B' : 'A'}${valid.mac.slice(1)}`,
        };
      },
    ],
  ])('denies a resolver that %s', async (_name, makeResolver, makeFrame) => {
    const session = new AuthenticatedRuntimeJsonlSession(context(), makeResolver());
    await expect(session.ingest(line(makeFrame()))).rejects.toMatchObject({
      code: 'AUTHENTICATION_DENIED',
    });
    expect(session.snapshot()).toEqual({
      state: 'FAILED',
      nextSequence: 1,
      acceptedFrames: 0,
      ingestedBytes: 0,
      bufferedBytes: 0,
      capabilitiesAccepted: false,
    });
    await expect(session.ingest(line(signedFrame(1)))).rejects.toMatchObject({
      code: 'TERMINAL',
    });
  });

  it('maps production denial to a fixed error and zeroes both derived keys on success and error', async () => {
    const denied = new AuthenticatedRuntimeJsonlSession(
      context(),
      new DenyBridgeSecretLeaseResolver(),
    );
    await expect(denied.ingest(line(signedFrame(1)))).rejects.toMatchObject({
      code: 'AUTHENTICATION_DENIED',
    });

    const fill = vi.spyOn(Uint8Array.prototype, 'fill');
    await new AuthenticatedRuntimeJsonlSession(context(), resolver()).ingest(line(signedFrame(1)));
    expect(fill.mock.calls.filter(([value]) => value === 0).length).toBeGreaterThanOrEqual(3);

    fill.mockClear();
    const bad = signedFrame(1);
    await expect(
      new AuthenticatedRuntimeJsonlSession(context(), resolver()).ingest(
        line({ ...bad, mac: `${bad.mac[0] === 'A' ? 'B' : 'A'}${bad.mac.slice(1)}` }),
      ),
    ).rejects.toMatchObject({ code: 'FRAME_INVALID' });
    expect(fill.mock.calls.filter(([value]) => value === 0).length).toBeGreaterThanOrEqual(3);
  });
});
