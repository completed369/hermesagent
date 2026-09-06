import { createHash, generateKeyPairSync, sign as ed25519Sign } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  canonicalJson,
  type RetainedNativeSupervisorModuleAuthorizationRootRecord,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotSigner,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import {
  PostgresRetainedNativeModuleAuthorizationIssuanceComposition,
  RetainedNativeModuleAuthorizationIssuanceCompositionDeniedError,
} from './retained-native-module-authorization-issuance-composition';
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
const request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest> =
  Object.freeze({
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE',
    workspaceId: context.workspaceId,
    supervisorInstanceId: 'native-supervisor-1',
    snapshotId: 'native-module-snapshot-1',
    snapshotVersion: 1,
    signerKeyId: root.signerKeyId,
    previousSnapshotHash: null,
    issuedAt: '2030-01-01T12:00:00.000Z',
    validUntil: '2030-01-01T12:02:00.000Z',
    authorizations: [],
    runtimeConnection: 'NOT_CONFIGURED',
  });

function rootRow(value: Readonly<RetainedNativeSupervisorModuleAuthorizationRootRecord> = root) {
  return {
    ...value,
    validFrom: new Date(value.validFrom),
    validUntil: new Date(value.validUntil),
    revokedAt: value.revokedAt === null ? null : new Date(value.revokedAt),
  };
}

class ScriptedSqlClient implements RetainedNativeModuleAuthorizationTrustSqlClient {
  readonly queries: Prisma.Sql[] = [];
  constructor(private readonly responses: unknown[]) {}
  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.queries.push(query);
    if (this.responses.length === 0) throw new Error('private unexpected SQL detail');
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next as T;
  }
}

function capability(
  authorityLevel: 0 | 1 | 2 | 3 | 4 = 3,
  actorKind: 'HUMAN' | 'AGENT' | 'RUNTIME' | 'SYSTEM' = 'SYSTEM',
) {
  return OperationalEventCapability.issue('CONTROL_PLANE', [
    { ...context, actorKind, authorityLevel },
  ]);
}

class FixtureSigner implements RetainedNativeSupervisorModuleAuthorizationSnapshotSigner {
  readonly sign = vi.fn(
    async (input: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest>) => ({
      schemaVersion: 1 as const,
      purpose: input.purpose,
      signerKeyId: input.signerKeyId,
      snapshotPayloadHash: input.snapshotPayloadHash,
      signature: ed25519Sign(
        null,
        Buffer.from(canonicalJson(input.payload)),
        keys.privateKey,
      ).toString('base64'),
    }),
  );
}

describe('PostgresRetainedNativeModuleAuthorizationIssuanceComposition', () => {
  it('binds one registered public root through signing to audited durable publication', async () => {
    const database = new ScriptedSqlClient([[rootRow()], [{ applied: 1 }]]);
    const signer = new FixtureSigner();
    const composition = new PostgresRetainedNativeModuleAuthorizationIssuanceComposition(
      database,
      signer,
      () => NOW,
    );

    await expect(
      composition.issue(request, capability(), context, new AbortController().signal),
    ).resolves.toMatchObject({
      workspaceId: context.workspaceId,
      supervisorInstanceId: request.supervisorInstanceId,
      snapshotId: request.snapshotId,
      publication: 'APPENDED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(signer.sign).toHaveBeenCalledOnce();
    expect(database.queries).toHaveLength(2);
    await expect(
      composition.issue(request, capability(), context, new AbortController().signal),
    ).rejects.toBeInstanceOf(RetainedNativeModuleAuthorizationIssuanceCompositionDeniedError);
  });

  it('denies missing signer roots before approval, signing, or publication', async () => {
    const database = new ScriptedSqlClient([[rootRow({ ...root, signerKeyId: 'other-signer' })]]);
    const signer = new FixtureSigner();
    const composition = new PostgresRetainedNativeModuleAuthorizationIssuanceComposition(
      database,
      signer,
      () => NOW,
    );
    await expect(
      composition.issue(request, capability(), context, new AbortController().signal),
    ).rejects.toBeInstanceOf(RetainedNativeModuleAuthorizationIssuanceCompositionDeniedError);
    expect(signer.sign).not.toHaveBeenCalled();
    expect(database.queries).toHaveLength(1);
  });

  it.each([
    ['cross-workspace context', { ...context, workspaceId: 'workspace-2' }, capability()],
    ['Level-4 authority', context, capability(4)],
    ['runtime authority', context, capability(3, 'RUNTIME')],
  ])('denies %s without publishing', async (_name, candidateContext, candidateCapability) => {
    const database = new ScriptedSqlClient([[rootRow()]]);
    const signer = new FixtureSigner();
    const composition = new PostgresRetainedNativeModuleAuthorizationIssuanceComposition(
      database,
      signer,
      () => NOW,
    );
    await expect(
      composition.issue(
        request,
        candidateCapability,
        candidateContext,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RetainedNativeModuleAuthorizationIssuanceCompositionDeniedError);
    expect(signer.sign).not.toHaveBeenCalled();
    expect(database.queries).toHaveLength(0);
  });

  it('denies an invalid signature and redacts registry failures without publication', async () => {
    const invalidSigner: RetainedNativeSupervisorModuleAuthorizationSnapshotSigner = {
      async sign(input) {
        return {
          schemaVersion: 1,
          purpose: input.purpose,
          signerKeyId: input.signerKeyId,
          snapshotPayloadHash: input.snapshotPayloadHash,
          signature: `${'A'.repeat(86)}==`,
        };
      },
    };
    const invalidDatabase = new ScriptedSqlClient([[rootRow()]]);
    await expect(
      new PostgresRetainedNativeModuleAuthorizationIssuanceComposition(
        invalidDatabase,
        invalidSigner,
        () => NOW,
      ).issue(request, capability(), context, new AbortController().signal),
    ).rejects.toEqual(
      new RetainedNativeModuleAuthorizationIssuanceCompositionDeniedError(
        'Retained-native module authorization issuance composition denied',
      ),
    );
    expect(invalidDatabase.queries).toHaveLength(1);

    const failedDatabase = new ScriptedSqlClient([new Error('private database detail')]);
    await expect(
      new PostgresRetainedNativeModuleAuthorizationIssuanceComposition(
        failedDatabase,
        new FixtureSigner(),
        () => NOW,
      ).issue(request, capability(), context, new AbortController().signal),
    ).rejects.toEqual(
      new RetainedNativeModuleAuthorizationIssuanceCompositionDeniedError(
        'Retained-native module authorization issuance composition denied',
      ),
    );
  });
});
