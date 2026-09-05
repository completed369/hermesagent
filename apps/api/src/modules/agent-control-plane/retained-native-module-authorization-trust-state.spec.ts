import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ventureos/database';
import type { RetainedNativeSupervisorModuleAuthorizationCheckpoint } from '@ventureos/agent-bridge';

import {
  PostgresRetainedNativeModuleAuthorizationCheckpointStore,
  PostgresRetainedNativeModuleAuthorizationSnapshotReader,
  type RetainedNativeModuleAuthorizationTrustSqlClient,
} from './retained-native-module-authorization-trust-state';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

class ScriptedSqlClient implements RetainedNativeModuleAuthorizationTrustSqlClient {
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
  overrides: Partial<RetainedNativeSupervisorModuleAuthorizationCheckpoint> = {},
): Readonly<RetainedNativeSupervisorModuleAuthorizationCheckpoint> {
  return Object.freeze({
    schemaVersion: 1,
    supervisorInstanceId: 'native-supervisor-1',
    signerKeyId: 'root-signer-1',
    snapshotId: `snapshot-${version}`,
    snapshotVersion: version,
    snapshotHash: String(version).repeat(64),
    clientAuthorizationId: 'client-grant-1',
    clientAuthorizationVersion: version,
    clientAuthorizationHash: 'a'.repeat(64),
    listenerAuthorizationId: 'listener-grant-1',
    listenerAuthorizationVersion: version,
    listenerAuthorizationHash: 'b'.repeat(64),
    ...overrides,
  });
}

function sqlText(query: Prisma.Sql): string {
  return query.strings.join('?').replace(/\s+/gu, ' ').trim();
}

describe('durable retained-native module authorization trust adapters', () => {
  it('reads the highest snapshot for one explicit supervisor and returns an owned copy', async () => {
    const snapshot = { schemaVersion: 1, supervisorInstanceId: 'native-supervisor-1' };
    const database = new ScriptedSqlClient([[{ snapshot }]]);
    const reader = new PostgresRetainedNativeModuleAuthorizationSnapshotReader(
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
      () =>
        new PostgresRetainedNativeModuleAuthorizationSnapshotReader(new ScriptedSqlClient([]), ''),
    ).toThrow();
    await expect(
      new PostgresRetainedNativeModuleAuthorizationSnapshotReader(
        new ScriptedSqlClient([[]]),
        'native-supervisor-1',
      ).read(),
    ).rejects.toThrow();
    await expect(
      new PostgresRetainedNativeModuleAuthorizationSnapshotReader(
        new ScriptedSqlClient([[{ snapshot: {} }, { snapshot: {} }]]),
        'native-supervisor-1',
      ).read(),
    ).rejects.toThrow();
    await expect(
      new PostgresRetainedNativeModuleAuthorizationSnapshotReader(
        new ScriptedSqlClient([new Error('database unavailable')]),
        'native-supervisor-1',
      ).read(),
    ).rejects.toThrow('database unavailable');
  });

  it('reads exact active and revoked checkpoints and rejects malformed rows', async () => {
    const revoked = checkpoint(2, {
      clientAuthorizationId: null,
      clientAuthorizationVersion: null,
      clientAuthorizationHash: null,
      listenerAuthorizationId: null,
      listenerAuthorizationVersion: null,
      listenerAuthorizationHash: null,
    });
    const database = new ScriptedSqlClient([
      [checkpoint()],
      [revoked],
      [],
      [{ ...checkpoint(), extra: true }],
    ]);
    const store = new PostgresRetainedNativeModuleAuthorizationCheckpointStore(database);
    await expect(store.read('native-supervisor-1')).resolves.toEqual(checkpoint());
    await expect(store.read('native-supervisor-1')).resolves.toEqual(revoked);
    await expect(store.read('native-supervisor-1')).resolves.toBeNull();
    await expect(store.read('native-supervisor-1')).rejects.toThrow();
    expect(Object.isFrozen(store)).toBe(true);
  });

  it('uses atomic bootstrap and exact all-field expected-value updates', async () => {
    const database = new ScriptedSqlClient([[{ applied: 1 }], [], [{ applied: 1 }], []]);
    const store = new PostgresRetainedNativeModuleAuthorizationCheckpointStore(database);
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
      'AND "listenerAuthorizationHash" IS NOT DISTINCT FROM ?',
    );
  });

  it('allows root rotation and explicit revocation while rejecting rollback and malformed input before SQL', async () => {
    const database = new ScriptedSqlClient([[{ applied: 1 }], [{ applied: 1 }]]);
    const store = new PostgresRetainedNativeModuleAuthorizationCheckpointStore(database);
    const rotated = checkpoint(2, { signerKeyId: 'root-signer-2' });
    const revoked = checkpoint(3, {
      signerKeyId: 'root-signer-2',
      clientAuthorizationId: null,
      clientAuthorizationVersion: null,
      clientAuthorizationHash: null,
      listenerAuthorizationId: null,
      listenerAuthorizationVersion: null,
      listenerAuthorizationHash: null,
    });
    await expect(store.compareAndSwap('native-supervisor-1', checkpoint(), rotated)).resolves.toBe(
      true,
    );
    await expect(store.compareAndSwap('native-supervisor-1', rotated, revoked)).resolves.toBe(true);

    const denied = new PostgresRetainedNativeModuleAuthorizationCheckpointStore(
      new ScriptedSqlClient([]),
    );
    await expect(
      denied.compareAndSwap('native-supervisor-1', checkpoint(), checkpoint(3)),
    ).rejects.toThrow();
    await expect(
      denied.compareAndSwap(
        'native-supervisor-1',
        checkpoint(2),
        checkpoint(3, { clientAuthorizationVersion: 1 }),
      ),
    ).rejects.toThrow();
    await expect(
      denied.compareAndSwap(
        'native-supervisor-1',
        checkpoint(2),
        checkpoint(3, {
          clientAuthorizationVersion: 2,
          clientAuthorizationHash: 'c'.repeat(64),
        }),
      ),
    ).rejects.toThrow();
    const accessor = { ...checkpoint() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'snapshotId', { enumerable: true, get: () => 'snapshot-1' });
    await expect(
      denied.compareAndSwap(
        'native-supervisor-1',
        accessor as unknown as RetainedNativeSupervisorModuleAuthorizationCheckpoint,
        checkpoint(2),
      ),
    ).rejects.toThrow();
  });
});
