import { afterEach, describe, expect, it, vi } from 'vitest';

import { digestSecretReference } from './auth';
import {
  BridgeSecretLeaseError,
  DenyBridgeSecretLeaseResolver,
  MAX_BRIDGE_SECRET_BYTES,
  ScopedBridgeSecretLeaseResolver,
  type BridgeSecretLeaseRequest,
} from './secret-lease';

const material = (length = 32) => new Uint8Array(length).fill(7);

const request = (overrides: Partial<BridgeSecretLeaseRequest> = {}): BridgeSecretLeaseRequest => ({
  workspaceId: 'workspace-one',
  runtimeId: 'runtime-one',
  connectionId: 'connection-one',
  secretReference: 'vault-item-one',
  authGeneration: 1,
  purpose: 'PROVISION',
  ...overrides,
});

describe('scoped bridge secret leases', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([0, 31, MAX_BRIDGE_SECRET_BYTES + 1])(
    'rejects invalid material length %s without invoking the consumer',
    async (length) => {
      let consumed = false;
      const resolver = new ScopedBridgeSecretLeaseResolver({
        async resolve() {
          return material(length);
        },
      });
      await expect(
        resolver.withSecret(request(), () => {
          consumed = true;
        }),
      ).rejects.toMatchObject({ code: 'INVALID_MATERIAL' });
      expect(consumed).toBe(false);
    },
  );

  it('rejects oversized source material before making an owned copy', async () => {
    const from = vi.spyOn(Uint8Array, 'from');
    let consumed = false;
    const resolver = new ScopedBridgeSecretLeaseResolver({
      async resolve() {
        return material(MAX_BRIDGE_SECRET_BYTES + 1);
      },
    });
    await expect(
      resolver.withSecret(request(), () => {
        consumed = true;
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MATERIAL' });
    expect(from).not.toHaveBeenCalled();
    expect(consumed).toBe(false);
  });

  it.each([32, MAX_BRIDGE_SECRET_BYTES])('accepts bounded material length %s', async (length) => {
    const resolver = new ScopedBridgeSecretLeaseResolver({
      async resolve() {
        return material(length);
      },
    });
    await expect(resolver.withSecret(request(), (secret) => secret.byteLength)).resolves.toBe(
      length,
    );
  });

  it('uses a fresh owned copy and zeroes it after success and failure', async () => {
    const source = material();
    let leasedAfterSuccess: Uint8Array | undefined;
    const resolver = new ScopedBridgeSecretLeaseResolver({
      async resolve() {
        return source;
      },
    });
    const escaped = await resolver.withSecret(request(), (secret) => {
      leasedAfterSuccess = secret;
      return secret;
    });
    expect(escaped).toBe(leasedAfterSuccess);
    expect([...escaped].every((byte) => byte === 0)).toBe(true);
    expect([...source].every((byte) => byte === 7)).toBe(true);

    let leasedAfterFailure: Uint8Array | undefined;
    await expect(
      resolver.withSecret(request(), (secret) => {
        leasedAfterFailure = secret;
        throw new Error('consumer failure');
      }),
    ).rejects.toThrow('consumer failure');
    expect([...leasedAfterFailure!].every((byte) => byte === 0)).toBe(true);
  });

  it('resolves fresh material for every lease and never caches', async () => {
    let calls = 0;
    const resolver = new ScopedBridgeSecretLeaseResolver({
      async resolve() {
        calls += 1;
        return material();
      },
    });
    await resolver.withSecret(request(), () => undefined);
    await resolver.withSecret(request(), () => undefined);
    expect(calls).toBe(2);
  });

  it('requires the exact expected digest for authentication and frame verification', async () => {
    const secret = material();
    const resolver = new ScopedBridgeSecretLeaseResolver({
      async resolve() {
        return secret;
      },
    });
    const authenticate = request({
      purpose: 'AUTHENTICATE',
      expectedDigest: digestSecretReference(secret),
    });
    await expect(resolver.withSecret(authenticate, () => 'verified')).resolves.toBe('verified');
    await expect(
      resolver.withSecret({ ...authenticate, expectedDigest: 'a'.repeat(64) }, () => undefined),
    ).rejects.toMatchObject({ code: 'DIGEST_MISMATCH' });
    await expect(
      resolver.withSecret(request({ purpose: 'VERIFY_FRAME' }), () => undefined),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      resolver.withSecret(
        request({ purpose: 'SIGN_FRAME', expectedDigest: digestSecretReference(secret) }),
        () => 'signed',
      ),
    ).resolves.toBe('signed');
    await expect(
      resolver.withSecret(request({ purpose: 'SIGN_FRAME' }), () => undefined),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      resolver.withSecret(
        request({ purpose: 'PROVISION', expectedDigest: digestSecretReference(secret) }),
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it.each([
    { workspaceId: 'password-reference' },
    { runtimeId: 'chain-of-thought' },
    { connectionId: 'glpat-abcdefghijklmnopqrstuvwxyz' },
    {
      secretReference: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue',
    },
    { authGeneration: 0 },
  ])('rejects unsafe scope before consulting a source: %j', async (override) => {
    let consulted = false;
    const resolver = new ScopedBridgeSecretLeaseResolver({
      async resolve() {
        consulted = true;
        return material();
      },
    });
    await expect(resolver.withSecret(request(override), () => undefined)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(consulted).toBe(false);
  });

  it('passes an exact frozen scope to the source and sanitizes source failures', async () => {
    const sensitiveSourceMessage = 'backend leaked vault-item-one and synthetic material';
    const resolver = new ScopedBridgeSecretLeaseResolver({
      async resolve(scope) {
        expect(Object.isFrozen(scope)).toBe(true);
        expect(scope).toEqual(request());
        throw new Error(sensitiveSourceMessage);
      },
    });
    const failure = await resolver.withSecret(request(), () => undefined).catch((error) => error);
    expect(failure).toBeInstanceOf(BridgeSecretLeaseError);
    expect(failure).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    expect(String(failure)).not.toContain('vault-item-one');
    expect(String(failure)).not.toContain('synthetic material');
  });

  it('keeps the production resolver deny-only', async () => {
    await expect(
      new DenyBridgeSecretLeaseResolver().withSecret(request(), () => undefined),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
