import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ventureos/database';
import type { RetainedNativeSupervisorTrustCheckpoint } from '@ventureos/agent-bridge';

import {
  PostgresRetainedNativeSupervisorTrustCheckpointStore,
  PostgresRetainedNativeSupervisorTrustSnapshotReader,
  type RetainedNativeSupervisorTrustSqlClient,
} from './retained-native-supervisor-trust-state';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

class ScriptedSqlClient implements RetainedNativeSupervisorTrustSqlClient {
  readonly queries: Prisma.Sql[] = [];
  constructor(private readonly responses: unknown[]) {}
  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.queries.push(query);
    if (this.responses.length === 0) throw new Error('Unexpected SQL call');
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next as T;
  }
}

function checkpoint(
  version = 1,
  overrides: Partial<RetainedNativeSupervisorTrustCheckpoint> = {},
): Readonly<RetainedNativeSupervisorTrustCheckpoint> {
  return Object.freeze({
    schemaVersion: 1,
    supervisorInstanceId: 'native-supervisor-1',
    signerKeyId: 'root-signer-1',
    snapshotId: `snapshot-${version}`,
    snapshotVersion: version,
    snapshotHash: String(version).repeat(64),
    activeSupervisorKeyId: 'native-key-1',
    activePublicKeySpkiSha256: 'a'.repeat(64),
    activeTrustRecordId: 'native-trust-1',
    activeTrustRecordVersion: version,
    ...overrides,
  });
}

function sqlText(query: Prisma.Sql): string {
  return query.strings.join('?').replace(/\s+/gu, ' ').trim();
}

describe('durable retained-native supervisor trust state adapters', () => {
  it('reads the highest snapshot for one explicit supervisor and returns an owned copy', async () => {
    const snapshot = { schemaVersion: 1, supervisorInstanceId: 'native-supervisor-1' };
    const database = new ScriptedSqlClient([[{ snapshot }]]);
    const reader = new PostgresRetainedNativeSupervisorTrustSnapshotReader(
      database,
      'native-supervisor-1',
    );
    const result = await reader.read();
    expect(result).toEqual(snapshot);
    expect(result).not.toBe(snapshot);
    expect(sqlText(database.queries[0]!)).toContain(
      'WHERE "supervisorInstanceId" = ? ORDER BY "snapshotVersion" DESC LIMIT 1',
    );
    expect(Object.isFrozen(reader)).toBe(true);
  });

  it('fails closed for invalid bindings, missing or ambiguous snapshots, and database errors', async () => {
    expect(
      () => new PostgresRetainedNativeSupervisorTrustSnapshotReader(new ScriptedSqlClient([]), ''),
    ).toThrow();
    await expect(
      new PostgresRetainedNativeSupervisorTrustSnapshotReader(
        new ScriptedSqlClient([[]]),
        'native-supervisor-1',
      ).read(),
    ).rejects.toThrow();
    await expect(
      new PostgresRetainedNativeSupervisorTrustSnapshotReader(
        new ScriptedSqlClient([[{ snapshot: {} }, { snapshot: {} }]]),
        'native-supervisor-1',
      ).read(),
    ).rejects.toThrow();
    await expect(
      new PostgresRetainedNativeSupervisorTrustSnapshotReader(
        new ScriptedSqlClient([new Error('database unavailable')]),
        'native-supervisor-1',
      ).read(),
    ).rejects.toThrow('database unavailable');
  });

  it('reads exact active and revoked checkpoints and rejects malformed rows', async () => {
    const active = checkpoint();
    const revoked = checkpoint(2, {
      activeSupervisorKeyId: null,
      activePublicKeySpkiSha256: null,
      activeTrustRecordId: null,
      activeTrustRecordVersion: null,
    });
    const database = new ScriptedSqlClient([[active], [revoked], [], [{ ...active, extra: true }]]);
    const store = new PostgresRetainedNativeSupervisorTrustCheckpointStore(database);
    await expect(store.read('native-supervisor-1')).resolves.toEqual(active);
    await expect(store.read('native-supervisor-1')).resolves.toEqual(revoked);
    await expect(store.read('native-supervisor-1')).resolves.toBeNull();
    await expect(store.read('native-supervisor-1')).rejects.toThrow();
    expect(sqlText(database.queries[0]!)).toContain('LIMIT 2');
    expect(Object.isFrozen(store)).toBe(true);
  });

  it('uses atomic bootstrap and exact all-field expected-value updates', async () => {
    const database = new ScriptedSqlClient([[{ applied: 1 }], [], [{ applied: 1 }], []]);
    const store = new PostgresRetainedNativeSupervisorTrustCheckpointStore(database);
    await expect(store.compareAndSwap('native-supervisor-1', null, checkpoint())).resolves.toBe(
      true,
    );
    await expect(store.compareAndSwap('native-supervisor-1', null, checkpoint())).resolves.toBe(
      false,
    );
    await expect(
      store.compareAndSwap('native-supervisor-1', checkpoint(), checkpoint(2)),
    ).resolves.toBe(true);
    await expect(
      store.compareAndSwap('native-supervisor-1', checkpoint(), checkpoint(2)),
    ).resolves.toBe(false);
    expect(sqlText(database.queries[0]!)).toContain(
      'ON CONFLICT ("supervisorInstanceId") DO NOTHING RETURNING 1 AS "applied"',
    );
    expect(sqlText(database.queries[2]!)).toContain(
      'AND "activeTrustRecordVersion" IS NOT DISTINCT FROM ?',
    );
  });

  it('allows linked root/key rotation and monotonic explicit revocation', async () => {
    const database = new ScriptedSqlClient([[{ applied: 1 }], [{ applied: 1 }]]);
    const store = new PostgresRetainedNativeSupervisorTrustCheckpointStore(database);
    const rotated = checkpoint(2, {
      signerKeyId: 'root-signer-2',
      activeSupervisorKeyId: 'native-key-2',
      activePublicKeySpkiSha256: 'b'.repeat(64),
      activeTrustRecordId: 'native-trust-2',
      activeTrustRecordVersion: 1,
    });
    const revoked = checkpoint(3, {
      signerKeyId: 'root-signer-2',
      activeSupervisorKeyId: null,
      activePublicKeySpkiSha256: null,
      activeTrustRecordId: null,
      activeTrustRecordVersion: null,
    });
    await expect(store.compareAndSwap('native-supervisor-1', checkpoint(), rotated)).resolves.toBe(
      true,
    );
    await expect(store.compareAndSwap('native-supervisor-1', rotated, revoked)).resolves.toBe(true);
  });

  it('rejects scope drift, skips, adjacent substitution, record rollback, and malformed objects before SQL', async () => {
    const database = new ScriptedSqlClient([]);
    const store = new PostgresRetainedNativeSupervisorTrustCheckpointStore(database);
    const current = checkpoint();
    await expect(store.compareAndSwap('other-instance', null, current)).rejects.toThrow();
    await expect(
      store.compareAndSwap('native-supervisor-1', current, checkpoint(3)),
    ).rejects.toThrow();
    await expect(
      store.compareAndSwap(
        'native-supervisor-1',
        current,
        checkpoint(2, { activePublicKeySpkiSha256: 'b'.repeat(64) }),
      ),
    ).rejects.toThrow();
    await expect(
      store.compareAndSwap(
        'native-supervisor-1',
        checkpoint(2),
        checkpoint(3, { activeTrustRecordVersion: 1 }),
      ),
    ).rejects.toThrow();
    const accessor = { ...current } as Record<string, unknown>;
    Object.defineProperty(accessor, 'snapshotId', { enumerable: true, get: () => 'snapshot-1' });
    await expect(
      store.compareAndSwap(
        'native-supervisor-1',
        accessor as unknown as RetainedNativeSupervisorTrustCheckpoint,
        checkpoint(2),
      ),
    ).rejects.toThrow();
    expect(database.queries).toHaveLength(0);
  });

  it('fails closed on malformed CAS results and preserves database failures', async () => {
    await expect(
      new PostgresRetainedNativeSupervisorTrustCheckpointStore(
        new ScriptedSqlClient([[{ applied: 1 }, { applied: 1 }]]),
      ).compareAndSwap('native-supervisor-1', null, checkpoint()),
    ).rejects.toThrow();
    await expect(
      new PostgresRetainedNativeSupervisorTrustCheckpointStore(
        new ScriptedSqlClient([new Error('database unavailable')]),
      ).compareAndSwap('native-supervisor-1', null, checkpoint()),
    ).rejects.toThrow('database unavailable');
  });
});
