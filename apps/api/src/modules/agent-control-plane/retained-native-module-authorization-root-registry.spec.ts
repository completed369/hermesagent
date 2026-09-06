import { createHash, generateKeyPairSync } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  canonicalJson,
  type RetainedNativeSupervisorModuleAuthorizationRootRecord,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import { PostgresRetainedNativeModuleAuthorizationRootRegistry } from './retained-native-module-authorization-root-registry';
import type { RetainedNativeModuleAuthorizationTrustSqlClient } from './retained-native-module-authorization-trust-state';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const context = Object.freeze({ workspaceId: 'workspace-1', principalId: 'control-plane-owner-1' });
const publicSpki = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
const root: Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord> = Object.freeze({
  schemaVersion: 1,
  rootRecordId: 'native-module-root-1',
  rootRecordVersion: 1,
  signerKeyId: 'native-module-signer-1',
  algorithm: 'ED25519',
  purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
  publicKeySpkiBase64: publicSpki.toString('base64'),
  publicKeySpkiSha256: createHash('sha256').update(publicSpki).digest('hex'),
  minimumSnapshotVersion: 1,
  validFrom: '2030-01-01T00:00:00.000Z',
  validUntil: '2031-01-01T00:00:00.000Z',
  revokedAt: null,
  testOnly: false,
});
const request = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_MODULE_AUTHORIZATION_PUBLIC_ROOT_PROVISIONING' as const,
  workspaceId: context.workspaceId,
  supervisorInstanceId: 'native-supervisor-1',
  root,
  runtimeConnection: 'NOT_CONFIGURED' as const,
});

class ScriptedSqlClient implements RetainedNativeModuleAuthorizationTrustSqlClient {
  readonly queries: Prisma.Sql[] = [];
  constructor(private readonly responses: unknown[]) {}
  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.queries.push(query);
    if (this.responses.length === 0) throw new Error('Unexpected SQL call');
    return this.responses.shift() as T;
  }
}

function capability(
  authorityLevel: 0 | 1 | 2 | 3 | 4 = 3,
  actorKind: 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM' = 'SYSTEM',
  source: 'CONTROL_PLANE' | 'AI_COO' = 'CONTROL_PLANE',
) {
  return OperationalEventCapability.issue(source, [{ ...context, actorKind, authorityLevel }]);
}

function sqlText(query: Prisma.Sql): string {
  return query.strings.join('?').replace(/\s+/gu, ' ').trim();
}

describe('retained-native module authorization public-root registry', () => {
  it('atomically appends a public root and Level-3 evidence without runtime activation', async () => {
    const database = new ScriptedSqlClient([[{ applied: 1 }]]);
    const registry = new PostgresRetainedNativeModuleAuthorizationRootRegistry(database);
    await expect(registry.provision(request, capability(), context, () => NOW)).resolves.toBe(
      'APPENDED',
    );
    expect(database.queries).toHaveLength(1);
    const sql = sqlText(database.queries[0]!);
    expect(sql).toContain('acp_retained_native_module_authorization_roots');
    expect(sql).toContain('acp_retained_native_module_authorization_root_evidence');
    expect(sql).toContain('ON CONFLICT DO NOTHING RETURNING 1 ), bound_scope AS');
    expect(sql).toContain('SELECT 1 FROM inserted_scope UNION ALL SELECT 1 FROM');
    expect(request.runtimeConnection).toBe('NOT_CONFIGURED');
    expect(sql).not.toContain('acp_runtime');
    expect(database.queries[0]!.values.join(' ')).not.toMatch(/private|secret|credential/iu);
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it('accepts only an exact immutable replay even when the fresh authorization clock differs', async () => {
    const provisioningRequestHash = createHash('sha256')
      .update(canonicalJson(request))
      .digest('hex');
    const row = {
      ...root,
      workspaceId: context.workspaceId,
      supervisorInstanceId: request.supervisorInstanceId,
      validFrom: new Date(root.validFrom),
      validUntil: new Date(root.validUntil),
      revokedAt: null,
      provisioningRequestHash,
      provisioningAuthorizationId: `native-module-root:${'a'.repeat(64)}`,
      approvalId: `level3-control-plane:${'a'.repeat(64)}`,
      approvalEvidenceHash: 'a'.repeat(64),
      authorizedByReference: context.principalId,
      authorityLevel: 3,
      authorizedFrom: new Date(NOW - 1_000),
      authorizedUntil: new Date(NOW + 59_000),
    };
    const database = new ScriptedSqlClient([[{ applied: 0 }], [row]]);
    const registry = new PostgresRetainedNativeModuleAuthorizationRootRegistry(database);
    await expect(registry.provision(request, capability(), context, () => NOW)).resolves.toBe(
      'REPLAYED',
    );
    expect(database.queries).toHaveLength(2);

    const conflicting = new ScriptedSqlClient([
      [{ applied: 0 }],
      [{ ...row, minimumSnapshotVersion: 2 }],
    ]);
    await expect(
      new PostgresRetainedNativeModuleAuthorizationRootRegistry(conflicting).provision(
        request,
        capability(),
        context,
        () => NOW,
      ),
    ).rejects.toThrow(/Conflicting/u);
  });

  it.each([
    ['wrong source', capability(3, 'SYSTEM', 'AI_COO')],
    ['insufficient authority', capability(2)],
    ['Level-4 authority', capability(4)],
    ['runtime principal', capability(3, 'RUNTIME')],
  ])('denies %s before issuing SQL', async (_name, trustedCapability) => {
    const database = new ScriptedSqlClient([]);
    const registry = new PostgresRetainedNativeModuleAuthorizationRootRegistry(database);
    await expect(
      registry.provision(request, trustedCapability, context, () => NOW),
    ).rejects.toThrow();
    expect(database.queries).toHaveLength(0);
  });

  it('denies cross-workspace, malformed, accessor, invalid-key, and invalid-clock inputs', async () => {
    const cases: readonly unknown[] = [
      { ...request, workspaceId: 'workspace-2' },
      { ...request, extra: true },
      Object.defineProperty({ ...request }, 'workspaceId', {
        enumerable: true,
        get: () => context.workspaceId,
      }),
      { ...request, root: { ...root, publicKeySpkiSha256: '0'.repeat(64) } },
    ];
    for (const candidate of cases) {
      const database = new ScriptedSqlClient([]);
      await expect(
        new PostgresRetainedNativeModuleAuthorizationRootRegistry(database).provision(
          candidate,
          capability(),
          context,
          () => NOW,
        ),
      ).rejects.toThrow();
      expect(database.queries).toHaveLength(0);
    }
    await expect(
      new PostgresRetainedNativeModuleAuthorizationRootRegistry(
        new ScriptedSqlClient([]),
      ).provision(request, capability(), context, () => Number.NaN),
    ).rejects.toThrow(/clock/u);
  });

  it('reads only current roots for one exact workspace and supervisor and enforces the bound', async () => {
    const row = {
      ...root,
      validFrom: new Date(root.validFrom),
      validUntil: new Date(root.validUntil),
      revokedAt: null,
    };
    const database = new ScriptedSqlClient([[row]]);
    const result = await new PostgresRetainedNativeModuleAuthorizationRootRegistry(database).read(
      context.workspaceId,
      request.supervisorInstanceId,
    );
    expect(result).toEqual([root]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(sqlText(database.queries[0]!)).toContain(
      'WHERE "workspaceId" = CAST(? AS UUID) AND "supervisorInstanceId" = ? ORDER BY "rootRecordId", "rootRecordVersion" DESC',
    );
    await expect(
      new PostgresRetainedNativeModuleAuthorizationRootRegistry(
        new ScriptedSqlClient([Array.from({ length: 9 }, () => row)]),
      ).read(context.workspaceId, request.supervisorInstanceId),
    ).rejects.toThrow(/bound/u);
  });
});
