import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import {
  canonicalJson,
  linuxRetainedNativeSupervisorModuleLoadRequestHash,
  type LinuxRetainedNativeSupervisorModuleAuthorization,
  type LinuxRetainedNativeSupervisorModuleLoadRequest,
  type RetainedNativeSupervisorModuleAuthorizationRootRecord,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import {
  PostgresRetainedNativeModuleAuthorizationTrustComposition,
  RetainedNativeModuleAuthorizationTrustCompositionDeniedError,
  type RetainedNativeModuleAuthorizationTrustTransactionClient,
} from './retained-native-module-authorization-trust-composition';
import type { RetainedNativeModuleAuthorizationTrustSqlClient } from './retained-native-module-authorization-trust-state';

vi.mock('@ventureos/database', () => ({
  Prisma: {
    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      return { strings: [...strings], values };
    },
  },
}));

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const workspaceId = 'workspace-1';
const supervisorInstanceId = 'native-supervisor-1';
const keys = generateKeyPairSync('ed25519');
const spki = keys.publicKey.export({ format: 'der', type: 'spki' });
const root: Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord> = Object.freeze({
  schemaVersion: 1,
  rootRecordId: 'native-module-root-1',
  rootRecordVersion: 1,
  signerKeyId: 'native-module-signer-1',
  algorithm: 'ED25519',
  purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
  publicKeySpkiBase64: spki.toString('base64'),
  publicKeySpkiSha256: createHash('sha256').update(spki).digest('hex'),
  minimumSnapshotVersion: 1,
  validFrom: '2030-01-01T00:00:00.000Z',
  validUntil: '2031-01-01T00:00:00.000Z',
  revokedAt: null,
  testOnly: false,
});
const request: Readonly<LinuxRetainedNativeSupervisorModuleLoadRequest> = Object.freeze({
  schemaVersion: 1,
  platform: 'LINUX',
  architecture: 'X64',
  moduleKind: 'CLIENT',
  canonicalModulePath: '/opt/ventureos/native/client.node',
  socketPath: '/run/ventureos/supervisor/recovery.sock',
  runtimeConnection: 'NOT_CONFIGURED',
});
const authorization: Readonly<LinuxRetainedNativeSupervisorModuleAuthorization> = Object.freeze({
  ...request,
  authorizationId: 'client-grant-1',
  authorizationVersion: 1,
  requestHash: linuxRetainedNativeSupervisorModuleLoadRequestHash(request),
  validFrom: '2030-01-01T11:59:59.000Z',
  validUntil: '2030-01-01T12:02:00.000Z',
  moduleSha256: 'a'.repeat(64),
  moduleIdentityReference: 'linux:dev-1:ino-2',
  moduleOwnerUid: 1000,
  moduleOwnerGid: 1000,
  moduleMode: 0o500,
  moduleSizeBytes: 64_000,
  socketDirectory: '/run/ventureos/supervisor',
  socketDirectoryIdentityReference: 'linux:dev-4:ino-5',
  socketDirectoryOwnerUid: 1000,
  socketDirectoryOwnerGid: 1000,
  socketDirectoryMode: 0o700,
});
const payload = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION' as const,
  snapshotId: 'native-module-snapshot-1',
  snapshotVersion: 1,
  signerKeyId: root.signerKeyId,
  algorithm: 'ED25519' as const,
  supervisorInstanceId,
  issuedAt: '2030-01-01T11:59:59.000Z',
  validUntil: '2030-01-01T12:02:00.000Z',
  previousSnapshotHash: null,
  authorizations: [authorization],
});
const snapshot = Object.freeze({
  ...payload,
  signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64'),
});

function rootRow(value: Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord> = root) {
  return {
    ...value,
    validFrom: new Date(value.validFrom),
    validUntil: new Date(value.validUntil),
    revokedAt: value.revokedAt === null ? null : new Date(value.revokedAt),
  };
}

class ScriptedSqlClient implements RetainedNativeModuleAuthorizationTrustTransactionClient {
  readonly queries: Prisma.Sql[] = [];
  readonly transactionOptions: unknown[] = [];
  constructor(private readonly responses: unknown[]) {}
  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.queries.push(query);
    if (this.responses.length === 0) throw new Error('private unexpected SQL detail');
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next as T;
  }
  async $transaction<T>(
    operation: (transaction: RetainedNativeModuleAuthorizationTrustSqlClient) => Promise<T>,
    options: Readonly<{ isolationLevel: 'Serializable' }>,
  ): Promise<T> {
    this.transactionOptions.push(options);
    return operation(this);
  }
}

function successfulResponses(finalRoots: unknown = [rootRow()]): unknown[] {
  return [
    [rootRow()],
    [{ snapshot }],
    [],
    [{ applied: 1 }],
    [{ locked: null }],
    [{ locked: null }],
    finalRoots,
    [{ snapshot }],
  ];
}

describe('PostgresRetainedNativeModuleAuthorizationTrustComposition', () => {
  it('exposes one exact grant only after root authentication and durable checkpoint advance', async () => {
    const database = new ScriptedSqlClient(successfulResponses());
    const composition = new PostgresRetainedNativeModuleAuthorizationTrustComposition(
      database,
      workspaceId,
      supervisorInstanceId,
      () => NOW,
    );

    await expect(composition.read(request)).resolves.toEqual(authorization);
    expect(database.queries).toHaveLength(8);
    expect(database.queries[0]?.values).toContain(workspaceId);
    expect(database.queries[0]?.values).toContain(supervisorInstanceId);
    expect(database.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    await expect(composition.read(request)).rejects.toBeInstanceOf(
      RetainedNativeModuleAuthorizationTrustCompositionDeniedError,
    );
  });

  it('denies empty roots before reading a snapshot or advancing a checkpoint', async () => {
    const database = new ScriptedSqlClient([[]]);
    await expect(
      new PostgresRetainedNativeModuleAuthorizationTrustComposition(
        database,
        workspaceId,
        supervisorInstanceId,
        () => NOW,
      ).read(request),
    ).rejects.toBeInstanceOf(RetainedNativeModuleAuthorizationTrustCompositionDeniedError);
    expect(database.queries).toHaveLength(1);
  });

  it('denies a root rotation or revocation that races authenticated checkpointing', async () => {
    const database = new ScriptedSqlClient(successfulResponses([]));
    await expect(
      new PostgresRetainedNativeModuleAuthorizationTrustComposition(
        database,
        workspaceId,
        supervisorInstanceId,
        () => NOW,
      ).read(request),
    ).rejects.toEqual(
      new RetainedNativeModuleAuthorizationTrustCompositionDeniedError(
        'Retained-native module authorization trust composition denied',
      ),
    );
    expect(database.queries).toHaveLength(8);
  });

  it('redacts invalid snapshots, database failures, and invalid scope references', async () => {
    const invalidSnapshot = { ...snapshot, signature: `${'A'.repeat(86)}==` };
    const invalidDatabase = new ScriptedSqlClient([[rootRow()], [{ snapshot: invalidSnapshot }]]);
    await expect(
      new PostgresRetainedNativeModuleAuthorizationTrustComposition(
        invalidDatabase,
        workspaceId,
        supervisorInstanceId,
        () => NOW,
      ).read(request),
    ).rejects.toBeInstanceOf(RetainedNativeModuleAuthorizationTrustCompositionDeniedError);
    expect(invalidDatabase.queries).toHaveLength(2);

    await expect(
      new PostgresRetainedNativeModuleAuthorizationTrustComposition(
        new ScriptedSqlClient([new Error('private database detail')]),
        workspaceId,
        supervisorInstanceId,
        () => NOW,
      ).read(request),
    ).rejects.toEqual(
      new RetainedNativeModuleAuthorizationTrustCompositionDeniedError(
        'Retained-native module authorization trust composition denied',
      ),
    );
    expect(
      () =>
        new PostgresRetainedNativeModuleAuthorizationTrustComposition(
          new ScriptedSqlClient([]),
          'workspace-secret-token',
          supervisorInstanceId,
        ),
    ).toThrow(RetainedNativeModuleAuthorizationTrustCompositionDeniedError);
  });
});
