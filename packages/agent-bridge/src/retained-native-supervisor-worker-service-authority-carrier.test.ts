import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from './codec';
import {
  linuxRetainedNativeSupervisorServiceRequestHash,
  type LinuxRetainedNativeSupervisorServiceAuthority,
  type LinuxRetainedNativeSupervisorServiceGrant,
} from './retained-native-supervisor-service-owner';
import {
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type ClosableRetainedNativeSupervisorTopologyObservationCarrier,
} from './retained-native-supervisor-topology-observation-carrier';
import {
  Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier,
  Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint,
  type RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner,
} from './retained-native-supervisor-topology-observation-carrier-signature';
import {
  AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority,
  BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler,
} from './retained-native-supervisor-worker-service-authority-carrier';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const binding = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER',
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL',
  carrierId: 'carrier-service-authority-one',
  coordinatorPrincipalReference: 'service:api:one',
  workerPrincipalReference: 'service:worker:one',
  workspaceId: 'workspace-one',
  supervisorInstanceId: 'supervisor-one',
  provisioningAttemptId: 'attempt-0001',
  provisioningPlanHash: 'a'.repeat(64),
  issuedAt: new Date(now - 1_000).toISOString(),
  expiresAt: new Date(now + 4_000).toISOString(),
  runtimeConnection: 'NOT_CONFIGURED',
} as const);
const request = Object.freeze({
  schemaVersion: 1,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_ONE_SESSION_SERVICE',
  workspaceId: binding.workspaceId,
  supervisorInstanceId: binding.supervisorInstanceId,
  serviceKind: 'TOPOLOGY_CARRIER_WORKER_LISTENER',
  provisioningId: 'provisioning-one',
  pathProvisionRequestHash: 'b'.repeat(64),
  pathApprovalEvidenceHash: 'c'.repeat(64),
  socketDirectory: '/run/ventureos/workspace-one',
  socketDirectoryIdentityReference: 'linux:dev-a:ino-b',
  socketDirectoryOwnerUid: 65532,
  socketDirectoryOwnerGid: 65532,
  socketDirectoryMode: 0o700,
  socketPath: '/run/ventureos/workspace-one/carrier.sock',
  expectedPeerRole: 'API_COORDINATOR',
  expectedPeerPid: 401,
  expectedPeerUid: 65532,
  expectedPeerGid: 65532,
  maximumSessionDurationMs: 2_000,
  runtimeConnection: 'NOT_CONFIGURED',
} as const);

function code(value: string) {
  return expect.objectContaining({ code: value });
}

function grant(
  drift: Partial<LinuxRetainedNativeSupervisorServiceGrant> = {},
): LinuxRetainedNativeSupervisorServiceGrant {
  return {
    ...request,
    serviceRunId: 'native-supervisor-service:one',
    requestHash: linuxRetainedNativeSupervisorServiceRequestHash(request),
    approvalId: 'level3-control-plane:one',
    approvalEvidenceHash: 'd'.repeat(64),
    authorizedByReference: 'founder:one',
    authorityLevel: 3,
    validFrom: new Date(now - 100).toISOString(),
    validUntil: new Date(now + 5_000).toISOString(),
    ...drift,
  };
}

function keyFixture(role: 'API_COORDINATOR' | 'WORKER_CLIENT', principalReference: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const signerKeyId = `key:${role.toLowerCase()}:one`;
  const root = Object.freeze({
    schemaVersion: 1,
    rootRecordId: `root:${role.toLowerCase()}:one`,
    rootRecordVersion: 1,
    signerKeyId,
    algorithm: 'ED25519',
    purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER_DELIVERY',
    principalRole: role,
    principalReference,
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    publicKeySpkiBase64: spki.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(spki).digest('hex'),
    validFrom: new Date(now - 2_000).toISOString(),
    validUntil: new Date(now + 20_000).toISOString(),
    revokedAt: null,
    testOnly: false,
  } as const);
  const signer: RetainedNativeSupervisorTopologyObservationCarrierDeliverySigner = {
    sign: vi.fn(async (payload: unknown) => ({
      algorithm: 'ED25519',
      signerKeyId,
      payloadHash: createHash('sha256').update(canonicalJson(payload)).digest('hex'),
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    })),
  };
  return { root, signer };
}

class RawCarrier implements ClosableRetainedNativeSupervisorTopologyObservationCarrier {
  endpoint!: Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint;
  readonly close = vi.fn(async () => undefined);
  exchange = vi.fn(async (input: unknown, signal: AbortSignal) =>
    this.mutateResponse(await this.endpoint.handle(input, signal)),
  );

  constructor(readonly mutateResponse: (input: unknown) => unknown = (input) => input) {}
}

function subject(
  grantDrift: Partial<LinuxRetainedNativeSupervisorServiceGrant> = {},
  mutateResponse: (input: unknown) => unknown = (input) => input,
  issuerError?: Error,
) {
  const api = keyFixture('API_COORDINATOR', binding.coordinatorPrincipalReference);
  const worker = keyFixture('WORKER_CLIENT', binding.workerPrincipalReference);
  const issuer: LinuxRetainedNativeSupervisorServiceAuthority = {
    authorize: vi.fn(async () => {
      if (issuerError) throw issuerError;
      return grant(grantDrift);
    }),
  };
  const handler = new BoundedRetainedNativeSupervisorWorkerServiceAuthorityCoordinatorHandler(
    issuer,
    request,
    binding,
    () => now,
  );
  const endpoint = new Ed25519RetainedNativeSupervisorTopologyObservationCoordinatorEndpoint(
    handler,
    api.signer,
    worker.root,
    binding,
    () => now,
  );
  const raw = new RawCarrier(mutateResponse);
  raw.endpoint = endpoint;
  const carrier = new Ed25519AuthenticatedRetainedNativeSupervisorTopologyObservationWorkerCarrier(
    raw,
    worker.signer,
    api.root,
    binding,
    () => now,
  );
  const controller = new AbortController();
  const authority = new AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority(
    carrier,
    request,
    binding,
    controller.signal,
    () => now,
  );
  return { api, authority, carrier, controller, issuer, raw, worker };
}

describe('authenticated worker service-authority carrier protocol', () => {
  it('delivers one exact fresh worker-listener grant over mutual signatures', async () => {
    const { api, authority, issuer, raw, worker } = subject();
    await expect(authority.authorize(request)).resolves.toEqual(grant());
    expect(worker.signer.sign).toHaveBeenCalledOnce();
    expect(api.signer.sign).toHaveBeenCalledOnce();
    expect(issuer.authorize).toHaveBeenCalledWith(request);
    expect(raw.close).toHaveBeenCalledOnce();
    await expect(authority.authorize(request)).rejects.toEqual(code('EXCHANGE_DENIED'));
  });

  it('denies local request drift before consuming the carrier or issuer', async () => {
    const { authority, issuer, raw } = subject();
    await expect(
      authority.authorize({ ...request, socketPath: '/run/ventureos/workspace-one/drift.sock' }),
    ).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(raw.exchange).not.toHaveBeenCalled();
    expect(issuer.authorize).not.toHaveBeenCalled();
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it('denies a signed but stale or request-drifted grant and closes the carrier', async () => {
    const stale = subject({ validUntil: new Date(now).toISOString() });
    await expect(stale.authority.authorize(request)).rejects.toEqual(code('INVALID_AUTHORIZATION'));
    expect(stale.raw.close).toHaveBeenCalledOnce();

    const drifted = subject({ expectedPeerPid: request.expectedPeerPid + 1 });
    await expect(drifted.authority.authorize(request)).rejects.toEqual(
      code('INVALID_AUTHORIZATION'),
    );
    expect(drifted.raw.close).toHaveBeenCalledOnce();
  });

  it('denies transport substitution of the API response', async () => {
    const { authority, raw } = subject({}, (input) => ({
      ...(input as Record<string, unknown>),
      message: { substituted: true },
    }));
    await expect(authority.authorize(request)).rejects.toEqual(code('INVALID_ATTESTATION'));
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it('normalizes issuer failure and cancellation and closes without leaking transport', async () => {
    const failed = subject({}, (input) => input, new Error('sensitive issuer detail'));
    await expect(failed.authority.authorize(request)).rejects.toEqual(
      code('INVALID_AUTHORIZATION'),
    );
    expect(failed.raw.close).toHaveBeenCalledOnce();

    const cancelled = subject();
    cancelled.controller.abort();
    await expect(cancelled.authority.authorize(request)).rejects.toEqual(
      code('INVALID_AUTHORIZATION'),
    );
    expect(cancelled.raw.exchange).not.toHaveBeenCalled();
    expect(cancelled.raw.close).toHaveBeenCalledOnce();
  });

  it('uses the canonical carrier method despite instance shadowing', async () => {
    const { authority, carrier, raw } = subject();
    const shadow = vi.fn(async () => ({ message: { grant: grant() } }));
    Object.defineProperty(carrier, 'exchange', { value: shadow });
    await expect(authority.authorize(request)).resolves.toEqual(grant());
    expect(shadow).not.toHaveBeenCalled();
    expect(raw.exchange).toHaveBeenCalledOnce();
  });

  it('denies structural carrier substitution, wrong scope, and cancellation', () => {
    expect(
      () =>
        new AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority(
          { exchange: vi.fn(), close: vi.fn() } as never,
          request,
          binding,
          new AbortController().signal,
          () => now,
        ),
    ).toThrow(code('INVALID_AUTHORIZATION'));
    const { carrier } = subject();
    expect(
      () =>
        new AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority(
          carrier,
          { ...request, workspaceId: 'workspace-two' },
          binding,
          new AbortController().signal,
          () => now,
        ),
    ).toThrow(code('INVALID_AUTHORIZATION'));
    const controller = new AbortController();
    controller.abort();
    expect(
      () =>
        new AuthenticatedCarrierLinuxRetainedNativeSupervisorWorkerServiceAuthority(
          carrier,
          request,
          binding,
          controller.signal,
          () => now,
        ),
    ).toThrow(code('NOT_CONFIGURED'));
  });
});
