import { createHash, generateKeyPairSync } from 'node:crypto';

import {
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import {
  PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource,
  PostgresApiCoordinatorTopologyCarrierSignatureRootSource,
} from './topology-carrier-signature-root-source';
import type { TopologyCarrierSignatureRootSqlClient } from './topology-carrier-signature-root-registry';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
  carrierId: 'carrier-1',
  coordinatorPrincipalReference: 'api-coordinator-1',
  workerPrincipalReference: 'worker-client-1',
  workspaceId: 'workspace-1',
  supervisorInstanceId: 'native-supervisor-1',
  provisioningAttemptId: 'provisioning-attempt-1',
  provisioningPlanHash: 'b'.repeat(64),
  issuedAt: new Date(NOW - 1_000).toISOString(),
  expiresAt: new Date(NOW + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED' as const,
});
const publicSpki = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
const root: Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord> =
  Object.freeze({
    schemaVersion: 1,
    rootRecordId: 'carrier-root-1',
    rootRecordVersion: 1,
    signerKeyId: 'carrier-signer-1',
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
    principalRole: 'WORKER_CLIENT',
    principalReference: binding.workerPrincipalReference,
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    publicKeySpkiBase64: publicSpki.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(publicSpki).digest('hex'),
    validFrom: new Date(NOW - 2_000).toISOString(),
    validUntil: new Date(NOW + 5_000).toISOString(),
    revokedAt: null,
    testOnly: false,
  });
const coordinatorRoot: Readonly<RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord> =
  Object.freeze({
    ...root,
    rootRecordId: 'carrier-root-api-1',
    signerKeyId: 'carrier-signer-api-1',
    principalRole: 'API_COORDINATOR',
    principalReference: binding.coordinatorPrincipalReference,
  });

function storedRoot(overrides: Record<string, unknown> = {}) {
  return {
    ...root,
    validFrom: new Date(root.validFrom),
    validUntil: new Date(root.validUntil),
    revokedAt: null,
    ...overrides,
  };
}

function storedCoordinatorRoot(overrides: Record<string, unknown> = {}) {
  return {
    ...coordinatorRoot,
    validFrom: new Date(coordinatorRoot.validFrom),
    validUntil: new Date(coordinatorRoot.validUntil),
    revokedAt: null,
    ...overrides,
  };
}

class ScriptedSqlClient implements TopologyCarrierSignatureRootSqlClient {
  readonly queries: Prisma.Sql[] = [];
  constructor(private readonly responses: unknown[]) {}
  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.queries.push(query);
    if (this.responses.length === 0) throw new Error('Unexpected SQL call');
    const response = this.responses.shift();
    return (typeof response === 'function' ? await response() : response) as T;
  }
}

describe('API-coordinator topology carrier public-root source', () => {
  it('resolves only the exact durable worker root once', async () => {
    const database = new ScriptedSqlClient([[storedRoot()]]);
    const source = new PostgresApiCoordinatorTopologyCarrierSignatureRootSource(
      database,
      binding,
      () => NOW,
    );
    await expect(
      source.read(binding, 'WORKER_CLIENT', new AbortController().signal),
    ).resolves.toEqual(root);
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]!.values).toContain('WORKER_CLIENT');
    expect(Object.isFrozen(source)).toBe(true);
    await expect(
      source.read(binding, 'WORKER_CLIENT', new AbortController().signal),
    ).rejects.toThrow(/denied/u);
    expect(database.queries).toHaveLength(1);
  });

  it('denies wrong-role, binding substitution, pre-cancellation, missing, and ambiguous roots', async () => {
    const cases: readonly [unknown, 'API_COORDINATOR' | 'WORKER_CLIENT', AbortSignal, unknown[]][] =
      [
        [binding, 'API_COORDINATOR', new AbortController().signal, []],
        [{ ...binding, carrierId: 'carrier-2' }, 'WORKER_CLIENT', new AbortController().signal, []],
        [binding, 'WORKER_CLIENT', AbortSignal.abort(), []],
        [binding, 'WORKER_CLIENT', new AbortController().signal, [[]]],
        [
          binding,
          'WORKER_CLIENT',
          new AbortController().signal,
          [[storedRoot(), storedRoot({ rootRecordId: 'carrier-root-2' })]],
        ],
      ];
    for (const [candidateBinding, role, signal, responses] of cases) {
      const database = new ScriptedSqlClient([...responses]);
      const source = new PostgresApiCoordinatorTopologyCarrierSignatureRootSource(
        database,
        binding,
        () => NOW,
      );
      await expect(source.read(candidateBinding as typeof binding, role, signal)).rejects.toThrow(
        /denied/u,
      );
    }
  });

  it('withholds a late database result after cancellation', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const database = new ScriptedSqlClient([
      async () => {
        await pending;
        return [storedRoot()];
      },
    ]);
    const cancellation = new AbortController();
    const read = new PostgresApiCoordinatorTopologyCarrierSignatureRootSource(
      database,
      binding,
      () => NOW,
    ).read(binding, 'WORKER_CLIENT', cancellation.signal);
    await vi.waitFor(() => expect(database.queries).toHaveLength(1));
    cancellation.abort();
    await expect(read).rejects.toThrow(/denied/u);
    release();
  });

  it('withholds an unresolved database read when the exact binding expires', async () => {
    vi.useFakeTimers();
    try {
      const shortBinding = Object.freeze({
        ...binding,
        issuedAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 100).toISOString(),
      });
      const database = new ScriptedSqlClient([() => new Promise<never>(() => undefined)]);
      const read = new PostgresApiCoordinatorTopologyCarrierSignatureRootSource(
        database,
        shortBinding,
        () => NOW,
      ).read(shortBinding, 'WORKER_CLIENT', new AbortController().signal);
      await Promise.resolve();
      await Promise.resolve();
      expect(database.queries).toHaveLength(1);
      const denied = expect(read).rejects.toThrow(/denied/u);
      await vi.advanceTimersByTimeAsync(100);
      await denied;
    } finally {
      vi.useRealTimers();
    }
  });

  it('revalidates binding lifetime and returned worker-root scope after the read', async () => {
    let now = NOW;
    const expiresAt = Date.parse(binding.expiresAt);
    const lateDatabase = new ScriptedSqlClient([
      () => {
        now = expiresAt;
        return [storedRoot()];
      },
    ]);
    await expect(
      new PostgresApiCoordinatorTopologyCarrierSignatureRootSource(
        lateDatabase,
        binding,
        () => now,
      ).read(binding, 'WORKER_CLIENT', new AbortController().signal),
    ).rejects.toThrow(/denied/u);

    const substitutions = [
      { principalRole: 'API_COORDINATOR' },
      { principalReference: binding.coordinatorPrincipalReference },
      { bindingHash: 'c'.repeat(64) },
      { rootRecordVersion: 2 },
    ];
    for (const substitution of substitutions) {
      const database = new ScriptedSqlClient([[storedRoot(substitution)]]);
      await expect(
        new PostgresApiCoordinatorTopologyCarrierSignatureRootSource(
          database,
          binding,
          () => NOW,
        ).read(binding, 'WORKER_CLIENT', new AbortController().signal),
      ).rejects.toThrow(/denied/u);
    }
  });
});

describe('API-published coordinator topology carrier public-root source', () => {
  it('resolves only the exact durable API coordinator root once', async () => {
    const database = new ScriptedSqlClient([[storedCoordinatorRoot()]]);
    const source = new PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource(
      database,
      binding,
      () => NOW,
    );
    await expect(
      source.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).resolves.toEqual(coordinatorRoot);
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]!.values).toContain('API_COORDINATOR');
    expect(Object.isFrozen(source)).toBe(true);
    await expect(
      source.read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).rejects.toThrow(/denied/u);
    expect(database.queries).toHaveLength(1);
  });

  it('denies the opposite role, binding drift, cancellation, missing, and ambiguous state', async () => {
    const cases: readonly [unknown, 'API_COORDINATOR' | 'WORKER_CLIENT', AbortSignal, unknown[]][] =
      [
        [binding, 'WORKER_CLIENT', new AbortController().signal, []],
        [
          { ...binding, carrierId: 'carrier-2' },
          'API_COORDINATOR',
          new AbortController().signal,
          [],
        ],
        [binding, 'API_COORDINATOR', AbortSignal.abort(), []],
        [binding, 'API_COORDINATOR', new AbortController().signal, [[]]],
        [
          binding,
          'API_COORDINATOR',
          new AbortController().signal,
          [
            [
              storedCoordinatorRoot(),
              storedCoordinatorRoot({ rootRecordId: 'carrier-root-api-2' }),
            ],
          ],
        ],
      ];
    for (const [candidateBinding, role, signal, responses] of cases) {
      const database = new ScriptedSqlClient([...responses]);
      await expect(
        new PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource(
          database,
          binding,
          () => NOW,
        ).read(candidateBinding as typeof binding, role, signal),
      ).rejects.toThrow(/denied/u);
    }
  });

  it('propagates cancellation and bounds a non-cooperating read by binding expiry', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const database = new ScriptedSqlClient([
      async () => {
        await pending;
        return [storedCoordinatorRoot()];
      },
    ]);
    const cancellation = new AbortController();
    const read = new PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource(
      database,
      binding,
      () => NOW,
    ).read(binding, 'API_COORDINATOR', cancellation.signal);
    await vi.waitFor(() => expect(database.queries).toHaveLength(1));
    cancellation.abort();
    await expect(read).rejects.toThrow(/denied/u);
    release();

    vi.useFakeTimers();
    try {
      const shortBinding = Object.freeze({
        ...binding,
        issuedAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 100).toISOString(),
      });
      const blockedDatabase = new ScriptedSqlClient([() => new Promise<never>(() => undefined)]);
      const expiring = new PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource(
        blockedDatabase,
        shortBinding,
        () => NOW,
      ).read(shortBinding, 'API_COORDINATOR', new AbortController().signal);
      await Promise.resolve();
      await Promise.resolve();
      const denied = expect(expiring).rejects.toThrow(/denied/u);
      await vi.advanceTimersByTimeAsync(100);
      await denied;
    } finally {
      vi.useRealTimers();
    }
  });

  it('withholds late, substituted, revoked, or under-scoped coordinator roots', async () => {
    let current = NOW;
    const expiresAt = Date.parse(binding.expiresAt);
    const lateDatabase = new ScriptedSqlClient([
      () => {
        current = expiresAt;
        return [storedCoordinatorRoot()];
      },
    ]);
    await expect(
      new PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource(
        lateDatabase,
        binding,
        () => current,
      ).read(binding, 'API_COORDINATOR', new AbortController().signal),
    ).rejects.toThrow(/denied/u);

    const substitutions = [
      { principalRole: 'WORKER_CLIENT' },
      { principalReference: binding.workerPrincipalReference },
      { bindingHash: 'c'.repeat(64) },
      { rootRecordVersion: 2 },
      { revokedAt: new Date(NOW).toISOString() },
      { validFrom: new Date(NOW).toISOString() },
      { validUntil: new Date(NOW + 3_999).toISOString() },
    ];
    for (const substitution of substitutions) {
      const database = new ScriptedSqlClient([[storedCoordinatorRoot(substitution)]]);
      await expect(
        new PostgresApiCoordinatorPublishedTopologyCarrierSignatureRootSource(
          database,
          binding,
          () => NOW,
        ).read(binding, 'API_COORDINATOR', new AbortController().signal),
      ).rejects.toThrow(/denied/u);
    }
  });
});
