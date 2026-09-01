import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ventureos/database';
import type { LinuxExecutableAuthorityTrustCheckpoint } from '@ventureos/agent-bridge';

import {
  PostgresLinuxExecutableAuthorityTrustCheckpointStore,
  PostgresLinuxExecutableAuthorityTrustSnapshotReader,
  type ExecutableAuthorityTrustSqlClient,
} from './executable-authority-trust-state';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

class ScriptedSqlClient implements ExecutableAuthorityTrustSqlClient {
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
  snapshotVersion = 1,
  snapshotId = `snapshot-${snapshotVersion}`,
  snapshotHash = String(snapshotVersion).repeat(64),
): Readonly<LinuxExecutableAuthorityTrustCheckpoint> {
  return Object.freeze({
    schemaVersion: 1,
    signerKeyId: 'root-signer-1',
    snapshotId,
    snapshotVersion,
    snapshotHash,
  });
}

function sqlText(query: Prisma.Sql): string {
  return query.strings.join('?').replace(/\s+/gu, ' ').trim();
}

describe('durable executable authority trust state adapters', () => {
  it('reads only the highest persisted snapshot for one explicit signer and returns an owned copy', async () => {
    const snapshot = { schemaVersion: 1, signerKeyId: 'root-signer-1', records: [{}] };
    const database = new ScriptedSqlClient([[{ snapshot }]]);
    const reader = new PostgresLinuxExecutableAuthorityTrustSnapshotReader(
      database,
      'root-signer-1',
    );

    const result = (await reader.read()) as typeof snapshot;

    expect(result).toEqual(snapshot);
    expect(result).not.toBe(snapshot);
    expect(result.records).not.toBe(snapshot.records);
    expect(sqlText(database.queries[0]!)).toContain(
      'WHERE "signerKeyId" = ? ORDER BY "snapshotVersion" DESC LIMIT 1',
    );
    expect(Object.isFrozen(reader)).toBe(true);
  });

  it('fails closed for invalid signer bindings, absence, ambiguous rows, and database errors', async () => {
    expect(
      () => new PostgresLinuxExecutableAuthorityTrustSnapshotReader(new ScriptedSqlClient([]), ''),
    ).toThrow();
    expect(
      () =>
        new PostgresLinuxExecutableAuthorityTrustSnapshotReader(
          new ScriptedSqlClient([]),
          'secret-root',
        ),
    ).toThrow();
    await expect(
      new PostgresLinuxExecutableAuthorityTrustSnapshotReader(
        new ScriptedSqlClient([[]]),
        'root-signer-1',
      ).read(),
    ).rejects.toThrow();
    await expect(
      new PostgresLinuxExecutableAuthorityTrustSnapshotReader(
        new ScriptedSqlClient([[{ snapshot: {} }, { snapshot: {} }]]),
        'root-signer-1',
      ).read(),
    ).rejects.toThrow();
    await expect(
      new PostgresLinuxExecutableAuthorityTrustSnapshotReader(
        new ScriptedSqlClient([new Error('database unavailable')]),
        'root-signer-1',
      ).read(),
    ).rejects.toThrow('database unavailable');
  });

  it('reads an exact signer-scoped checkpoint and rejects malformed database rows', async () => {
    const value = checkpoint();
    const database = new ScriptedSqlClient([
      [value],
      [],
      [{ ...value, snapshotHash: 'not-a-hash' }],
    ]);
    const store = new PostgresLinuxExecutableAuthorityTrustCheckpointStore(database);

    await expect(store.read('root-signer-1')).resolves.toEqual(value);
    await expect(store.read('root-signer-1')).resolves.toBeNull();
    await expect(store.read('root-signer-1')).rejects.toThrow();
    expect(sqlText(database.queries[0]!)).toContain('LIMIT 2');
    expect(Object.isFrozen(store)).toBe(true);
  });

  it('performs atomic bootstrap and exact expected-value update CAS operations', async () => {
    const database = new ScriptedSqlClient([[{ applied: 1 }], [], [{ applied: 1 }], []]);
    const store = new PostgresLinuxExecutableAuthorityTrustCheckpointStore(database);

    await expect(store.compareAndSwap('root-signer-1', null, checkpoint())).resolves.toBe(true);
    await expect(store.compareAndSwap('root-signer-1', null, checkpoint())).resolves.toBe(false);
    await expect(store.compareAndSwap('root-signer-1', checkpoint(), checkpoint(2))).resolves.toBe(
      true,
    );
    await expect(store.compareAndSwap('root-signer-1', checkpoint(), checkpoint(2))).resolves.toBe(
      false,
    );

    expect(sqlText(database.queries[0]!)).toContain(
      'ON CONFLICT ("signerKeyId") DO NOTHING RETURNING 1 AS "applied"',
    );
    expect(sqlText(database.queries[2]!)).toContain(
      'AND "snapshotId" = ? AND "snapshotVersion" = ? AND "snapshotHash" = ?',
    );
  });

  it('rejects caller drift, version skips, identical successors, accessors, and hidden fields before SQL', async () => {
    const database = new ScriptedSqlClient([]);
    const store = new PostgresLinuxExecutableAuthorityTrustCheckpointStore(database);
    const current = checkpoint();

    await expect(store.compareAndSwap('other-signer', null, current)).rejects.toThrow();
    await expect(store.compareAndSwap('root-signer-1', current, checkpoint(3))).rejects.toThrow();
    await expect(
      store.compareAndSwap(
        'root-signer-1',
        current,
        checkpoint(2, current.snapshotId, '2'.repeat(64)),
      ),
    ).rejects.toThrow();
    await expect(
      store.compareAndSwap(
        'root-signer-1',
        current,
        checkpoint(2, 'snapshot-2', current.snapshotHash),
      ),
    ).rejects.toThrow();

    const accessor = { ...current } as Record<string, unknown>;
    Object.defineProperty(accessor, 'snapshotId', { enumerable: true, get: () => 'snapshot-1' });
    await expect(
      store.compareAndSwap(
        'root-signer-1',
        accessor as unknown as LinuxExecutableAuthorityTrustCheckpoint,
        checkpoint(2),
      ),
    ).rejects.toThrow();

    const hidden = { ...checkpoint(2) } as Record<string, unknown>;
    Object.defineProperty(hidden, 'extra', { value: true, enumerable: false });
    await expect(
      store.compareAndSwap(
        'root-signer-1',
        current,
        hidden as unknown as LinuxExecutableAuthorityTrustCheckpoint,
      ),
    ).rejects.toThrow();
    expect(database.queries).toHaveLength(0);
  });

  it('fails closed on malformed CAS results and preserves database failures', async () => {
    const store = new PostgresLinuxExecutableAuthorityTrustCheckpointStore(
      new ScriptedSqlClient([[{ applied: 1 }, { applied: 1 }]]),
    );
    await expect(store.compareAndSwap('root-signer-1', null, checkpoint())).rejects.toThrow();
    await expect(
      new PostgresLinuxExecutableAuthorityTrustCheckpointStore(
        new ScriptedSqlClient([new Error('database unavailable')]),
      ).compareAndSwap('root-signer-1', null, checkpoint()),
    ).rejects.toThrow('database unavailable');
  });
});
