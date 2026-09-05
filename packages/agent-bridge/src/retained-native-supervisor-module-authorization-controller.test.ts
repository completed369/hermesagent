import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from './codec';
import type { ProvisionedLinuxRetainedNativeSupervisorPaths } from './retained-native-supervisor-linux-path-provisioner';
import {
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication,
  BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher,
  type RetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore,
} from './retained-native-supervisor-module-authorization-audited-publisher';
import {
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance,
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController,
  retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotSigner,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest,
} from './retained-native-supervisor-module-authorization-controller';
import {
  AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher,
  type RetainedNativeSupervisorModuleAuthorizationRootRecord,
  type RetainedNativeSupervisorModuleAuthorizationSnapshot,
  type RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore,
} from './retained-native-supervisor-module-authorization-trust-source';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const WORKSPACE = 'workspace-1';
const INSTANCE = 'native-supervisor-production-1';
const SIGNER = 'native-module-root-signer-1';

class ApprovalAuthority implements RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthority {
  calls = 0;
  mutate: (grant: Record<string, unknown>) => Record<string, unknown> = (grant) => grant;

  async authorize(
    request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequest>,
  ): Promise<unknown> {
    this.calls += 1;
    return this.mutate({
      ...request,
      issuanceAuthorizationId: 'snapshot-issuance-authorization-1',
      authorityRequestHash:
        retainedNativeSupervisorModuleAuthorizationSnapshotIssuanceAuthorityRequestHash(request),
      approvalId: 'approval-1',
      approvalEvidenceHash: 'e'.repeat(64),
      authorizedByReference: 'ventureos:approval:approval-1',
      authorityLevel: 3,
      validFrom: '2030-01-01T11:59:55.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
    });
  }
}

class Ed25519Signer implements RetainedNativeSupervisorModuleAuthorizationSnapshotSigner {
  calls = 0;
  mutate: (result: Record<string, unknown>) => Record<string, unknown> = (result) => result;

  constructor(private readonly privateKey: KeyObject) {}

  async sign(
    request: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshotSigningRequest>,
  ): Promise<unknown> {
    this.calls += 1;
    return this.mutate({
      schemaVersion: 1,
      purpose: request.purpose,
      signerKeyId: request.signerKeyId,
      snapshotPayloadHash: request.snapshotPayloadHash,
      signature: sign(
        null,
        Buffer.from(canonicalJson(request.payload), 'utf8'),
        this.privateKey,
      ).toString('base64'),
    });
  }
}

class MemoryPublicationStore implements RetainedNativeSupervisorModuleAuthorizationSnapshotPublicationStore {
  calls = 0;
  snapshot: Readonly<RetainedNativeSupervisorModuleAuthorizationSnapshot> | null = null;

  async append(
    authenticated: AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot,
  ): Promise<'APPENDED'> {
    AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshot.assertAuthenticated(
      authenticated,
    );
    this.calls += 1;
    this.snapshot = authenticated.snapshot;
    return 'APPENDED';
  }
}

class MemoryAuditedPublicationStore implements RetainedNativeSupervisorModuleAuthorizationAuditedPublicationStore {
  calls = 0;
  publication: AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication | null =
    null;

  async append(
    publication: AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication,
  ): Promise<'APPENDED'> {
    AuthenticatedRetainedNativeSupervisorModuleAuthorizationAuditedPublication.assertAuthenticated(
      publication,
    );
    this.calls += 1;
    this.publication = publication;
    return 'APPENDED';
  }
}

function provisioned(
  kind: 'CLIENT' | 'LISTENER',
  overrides: Partial<ProvisionedLinuxRetainedNativeSupervisorPaths> = {},
): ProvisionedLinuxRetainedNativeSupervisorPaths {
  return {
    schemaVersion: 1,
    platform: 'LINUX',
    architecture: 'X64',
    moduleKind: kind,
    provisioningId: `provisioning-${kind.toLowerCase()}-1`,
    requestHash: kind === 'CLIENT' ? 'a'.repeat(64) : 'b'.repeat(64),
    canonicalModulePath: `/opt/ventureos/native/${kind.toLowerCase()}.node`,
    moduleSha256: kind === 'CLIENT' ? 'c'.repeat(64) : 'd'.repeat(64),
    moduleIdentityReference: kind === 'CLIENT' ? 'linux:dev-1:ino-2' : 'linux:dev-1:ino-3',
    moduleOwnerUid: 1000,
    moduleOwnerGid: 1000,
    moduleMode: 0o500,
    moduleSizeBytes: 64_000,
    socketDirectory: '/run/ventureos/supervisor',
    socketDirectoryIdentityReference: 'linux:dev-4:ino-5',
    socketDirectoryOwnerUid: 1000,
    socketDirectoryOwnerGid: 1000,
    socketDirectoryMode: 0o700,
    socketPath: '/run/ventureos/supervisor/recovery.sock',
    runtimeConnection: 'NOT_CONFIGURED',
    ...overrides,
  };
}

function issueRequest(
  authorizations: RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest['authorizations'] = [
    {
      authorizationId: 'native-module-client-authorization-1',
      authorizationVersion: 1,
      validFrom: '2030-01-01T11:59:59.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
      provisionedPaths: provisioned('CLIENT'),
    },
    {
      authorizationId: 'native-module-listener-authorization-1',
      authorizationVersion: 1,
      validFrom: '2030-01-01T11:59:59.000Z',
      validUntil: '2030-01-01T12:01:00.000Z',
      provisionedPaths: provisioned('LISTENER'),
    },
  ],
): RetainedNativeSupervisorModuleAuthorizationSnapshotIssueRequest {
  return {
    schemaVersion: 1,
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT_ISSUANCE',
    workspaceId: WORKSPACE,
    supervisorInstanceId: INSTANCE,
    snapshotId: 'native-module-snapshot-1',
    snapshotVersion: 1,
    signerKeyId: SIGNER,
    previousSnapshotHash: null,
    issuedAt: '2030-01-01T11:59:58.000Z',
    validUntil: '2030-01-01T12:02:00.000Z',
    authorizations,
    runtimeConnection: 'NOT_CONFIGURED',
  };
}

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const root: RetainedNativeSupervisorModuleAuthorizationRootRecord = {
    schemaVersion: 1,
    rootRecordId: 'native-module-root-record-1',
    rootRecordVersion: 1,
    signerKeyId: SIGNER,
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_SUPERVISOR_MODULE_AUTHORIZATION_SNAPSHOT',
    publicKeySpkiBase64: spki.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(spki).digest('hex'),
    minimumSnapshotVersion: 1,
    validFrom: '2029-01-01T00:00:00.000Z',
    validUntil: '2031-01-01T00:00:00.000Z',
    revokedAt: null,
    testOnly: false,
  };
  const authority = new ApprovalAuthority();
  const signer = new Ed25519Signer(privateKey);
  const store = new MemoryPublicationStore();
  const publisher = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotPublisher(
    INSTANCE,
    [root],
    store,
    () => NOW,
  );
  const controller = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController(
    WORKSPACE,
    INSTANCE,
    authority,
    signer,
    publisher,
    () => NOW,
  );
  return { authority, signer, store, controller, root, privateKey };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code,
  });
}

describe('BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController', () => {
  it('approval-binds, signs, authenticates, and publishes canonical owner-only module authority', async () => {
    const { authority, signer, store, controller } = fixture();
    const receipt = await controller.issue(issueRequest(), new AbortController().signal);

    expect(receipt).toEqual({
      schemaVersion: 1,
      workspaceId: WORKSPACE,
      supervisorInstanceId: INSTANCE,
      snapshotId: 'native-module-snapshot-1',
      snapshotVersion: 1,
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      issuanceAuthorizationId: 'snapshot-issuance-authorization-1',
      approvalId: 'approval-1',
      approvalEvidenceHash: 'e'.repeat(64),
      publication: 'APPENDED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(authority.calls).toBe(1);
    expect(signer.calls).toBe(1);
    expect(store.calls).toBe(1);
    expect(store.snapshot?.authorizations.map(({ moduleKind }) => moduleKind)).toEqual([
      'CLIENT',
      'LISTENER',
    ]);
    expect(store.snapshot?.authorizations[0]).toMatchObject({
      moduleMode: 0o500,
      socketDirectoryMode: 0o700,
      runtimeConnection: 'NOT_CONFIGURED',
    });
  });

  it('publishes an explicitly approved empty snapshot for revocation', async () => {
    const { store, controller } = fixture();
    await controller.issue(issueRequest([]), new AbortController().signal);
    expect(store.snapshot?.authorizations).toEqual([]);
  });

  it('mints approval evidence only for the independently authenticated audited publisher', async () => {
    const base = fixture();
    const store = new MemoryAuditedPublicationStore();
    const publisher = new BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher(
      WORKSPACE,
      INSTANCE,
      [base.root],
      store,
      () => NOW,
    );
    const controller = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController(
      WORKSPACE,
      INSTANCE,
      new ApprovalAuthority(),
      new Ed25519Signer(base.privateKey),
      publisher,
      () => NOW,
    );

    await expect(
      controller.issue(issueRequest([]), new AbortController().signal),
    ).resolves.toMatchObject({
      publication: 'APPENDED',
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(store.calls).toBe(1);
    expect(store.publication?.issuance).toMatchObject({
      workspaceId: WORKSPACE,
      supervisorInstanceId: INSTANCE,
      issuanceAuthorizationId: 'snapshot-issuance-authorization-1',
      approvalId: 'approval-1',
      approvalEvidenceHash: 'e'.repeat(64),
      authorityLevel: 3,
      runtimeConnection: 'NOT_CONFIGURED',
    });
    expect(store.publication?.issuance.snapshotHash).toBe(store.publication?.snapshot.snapshotHash);
  });

  it('rejects forged issuance proof before authenticated audited storage', async () => {
    const base = fixture();
    const store = new MemoryAuditedPublicationStore();
    const publisher = new BoundedRetainedNativeSupervisorModuleAuthorizationAuditedPublisher(
      WORKSPACE,
      INSTANCE,
      [base.root],
      store,
      () => NOW,
    );
    const forged = Object.create(
      AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance.prototype,
    ) as AuthenticatedRetainedNativeSupervisorModuleAuthorizationSnapshotIssuance;
    await expect(publisher.publish({}, forged)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION',
    });
    expect(store.calls).toBe(0);
  });

  it('denies by default before signing or publication', async () => {
    const controller = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController(
      WORKSPACE,
      INSTANCE,
      undefined,
      undefined,
      undefined,
      () => NOW,
    );
    await expectCode(
      controller.issue(issueRequest([]), new AbortController().signal),
      'NOT_CONFIGURED',
    );
  });

  it('rejects a grant not bound to the exact request and approval evidence', async () => {
    const { authority, signer, store, controller } = fixture();
    authority.mutate = (grant) => ({ ...grant, approvalEvidenceHash: 'not-a-digest' });
    await expectCode(
      controller.issue(issueRequest(), new AbortController().signal),
      'INVALID_AUTHORIZATION',
    );
    expect(signer.calls).toBe(0);
    expect(store.calls).toBe(0);
  });

  it('rejects authority above the permitted non-Founder Level 3 boundary', async () => {
    const { authority, signer, controller } = fixture();
    authority.mutate = (grant) => ({ ...grant, authorityLevel: 4 });
    await expectCode(
      controller.issue(issueRequest(), new AbortController().signal),
      'INVALID_AUTHORIZATION',
    );
    expect(signer.calls).toBe(0);
  });

  it('rejects signer substitution and never publishes it', async () => {
    const { signer, store, controller } = fixture();
    signer.mutate = (result) => ({ ...result, signerKeyId: 'different-signer' });
    await expectCode(
      controller.issue(issueRequest(), new AbortController().signal),
      'INVALID_AUTHORIZATION',
    );
    expect(store.calls).toBe(0);
  });

  it('lets the independent publisher reject an invalid cryptographic signature', async () => {
    const { signer, store, controller } = fixture();
    signer.mutate = (result) => ({ ...result, signature: Buffer.alloc(64).toString('base64') });
    await expectCode(
      controller.issue(issueRequest(), new AbortController().signal),
      'NOT_CONFIGURED',
    );
    expect(store.calls).toBe(0);
  });

  it('rejects cross-socket CLIENT/LISTENER attestations before requesting approval', async () => {
    const { authority, controller } = fixture();
    const request = issueRequest([
      issueRequest().authorizations[0]!,
      {
        ...issueRequest().authorizations[1]!,
        provisionedPaths: provisioned('LISTENER', {
          socketPath: '/run/ventureos/supervisor/other.sock',
        }),
      },
    ]);
    await expectCode(
      controller.issue(request, new AbortController().signal),
      'INVALID_ATTESTATION',
    );
    expect(authority.calls).toBe(0);
  });

  it('rejects duplicate grant identities before requesting approval', async () => {
    const { authority, controller } = fixture();
    const request = issueRequest([
      issueRequest().authorizations[0]!,
      {
        ...issueRequest().authorizations[1]!,
        authorizationId: 'native-module-client-authorization-1',
      },
    ]);
    await expectCode(
      controller.issue(request, new AbortController().signal),
      'INVALID_AUTHORIZATION',
    );
    expect(authority.calls).toBe(0);
  });

  it('rejects writable module attestations and accessor-bearing inputs', async () => {
    const writable = issueRequest([
      {
        ...issueRequest().authorizations[0]!,
        provisionedPaths: provisioned('CLIENT', { moduleMode: 0o700 as 320 }),
      },
    ]);
    await expectCode(
      fixture().controller.issue(writable, new AbortController().signal),
      'INVALID_ATTESTATION',
    );

    const accessor = issueRequest([]) as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'snapshotId', { enumerable: true, get: () => 'snapshot-1' });
    await expectCode(
      fixture().controller.issue(accessor, new AbortController().signal),
      'INVALID_AUTHORIZATION',
    );
  });

  it('is one-shot and fails closed on cancellation before authority or publication', async () => {
    const { authority, controller } = fixture();
    const abort = new AbortController();
    abort.abort();
    await expectCode(controller.issue(issueRequest(), abort.signal), 'INVALID_AUTHORIZATION');
    expect(authority.calls).toBe(0);
    await expectCode(
      controller.issue(issueRequest(), new AbortController().signal),
      'INVALID_AUTHORIZATION',
    );
  });

  it('rechecks cancellation and authority freshness after approval', async () => {
    const { authority, signer, store, controller } = fixture();
    const abort = new AbortController();
    const original = authority.authorize.bind(authority);
    authority.authorize = async (request) => {
      const result = await original(request);
      abort.abort();
      return result;
    };
    await expectCode(controller.issue(issueRequest(), abort.signal), 'INVALID_AUTHORIZATION');
    expect(signer.calls).toBe(0);
    expect(store.calls).toBe(0);
  });

  it('does not sign when authority returns after the snapshot has expired', async () => {
    const { authority, signer, store } = fixture();
    const clockValues = [NOW, NOW + 2 * 60_000 + 1];
    const controller = new BoundedRetainedNativeSupervisorModuleAuthorizationSnapshotController(
      WORKSPACE,
      INSTANCE,
      authority,
      signer,
      { publish: async () => 'APPENDED' },
      () => clockValues.shift() ?? NOW + 2 * 60_000 + 1,
    );
    authority.mutate = (grant) => ({
      ...grant,
      validUntil: '2030-01-01T12:04:00.000Z',
    });
    await expectCode(
      controller.issue(issueRequest(), new AbortController().signal),
      'INVALID_AUTHORIZATION',
    );
    expect(signer.calls).toBe(0);
    expect(store.calls).toBe(0);
  });
});
