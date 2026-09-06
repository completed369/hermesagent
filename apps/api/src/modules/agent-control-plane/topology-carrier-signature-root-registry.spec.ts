import { createHash, generateKeyPairSync } from 'node:crypto';

import { OperationalEventCapability } from '@ventureos/agent-control-plane';
import {
  canonicalJson,
  retainedNativeSupervisorTopologyObservationCarrierBindingHash,
  type RetainedNativeSupervisorTopologyObservationCarrierSignatureRootRecord,
} from '@ventureos/agent-bridge';
import { Prisma } from '@ventureos/database';
import { describe, expect, it, vi } from 'vitest';

import { PostgresTopologyCarrierSignatureRootRegistry } from './topology-carrier-signature-root-registry';
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
const binding = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'RETAINED_NATIVE_SUPERVISOR_TOPOLOGY_OBSERVATION_CARRIER' as const,
  authority: 'MUTUALLY_AUTHENTICATED_CROSS_CONTAINER_CHANNEL' as const,
  carrierId: 'carrier-1',
  coordinatorPrincipalReference: 'api-coordinator-1',
  workerPrincipalReference: 'worker-client-1',
  workspaceId: context.workspaceId,
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
    principalRole: 'API_COORDINATOR',
    principalReference: binding.coordinatorPrincipalReference,
    bindingHash: retainedNativeSupervisorTopologyObservationCarrierBindingHash(binding),
    publicKeySpkiBase64: publicSpki.toString('base64'),
    publicKeySpkiSha256: createHash('sha256').update(publicSpki).digest('hex'),
    validFrom: new Date(NOW - 2_000).toISOString(),
    validUntil: new Date(NOW + 5_000).toISOString(),
    revokedAt: null,
    testOnly: false,
  });
const request = Object.freeze({
  schemaVersion: 1 as const,
  purpose: 'TOPOLOGY_CARRIER_SIGNATURE_PUBLIC_ROOT_PROVISIONING' as const,
  workspaceId: context.workspaceId,
  supervisorInstanceId: binding.supervisorInstanceId,
  binding,
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

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    ...root,
    workspaceId: context.workspaceId,
    supervisorInstanceId: binding.supervisorInstanceId,
    carrierId: binding.carrierId,
    validFrom: new Date(root.validFrom),
    validUntil: new Date(root.validUntil),
    revokedAt: null,
    provisioningRequestHash: createHash('sha256').update(canonicalJson(request)).digest('hex'),
    provisioningAuthorizationId: `carrier-root:${'a'.repeat(64)}`,
    approvalId: `level3-control-plane:${'a'.repeat(64)}`,
    approvalEvidenceHash: 'a'.repeat(64),
    authorizedByReference: context.principalId,
    authorityLevel: 3,
    authorizedFrom: new Date(NOW - 1_000),
    authorizedUntil: new Date(NOW + 59_000),
    ...overrides,
  };
}

describe('topology carrier signature public-root registry', () => {
  it('atomically appends one exact-binding public root and Level-3 evidence', async () => {
    const database = new ScriptedSqlClient([[{ applied: 1 }]]);
    const registry = new PostgresTopologyCarrierSignatureRootRegistry(database);
    await expect(registry.provision(request, capability(), context, () => NOW)).resolves.toBe(
      'APPENDED',
    );
    expect(database.queries).toHaveLength(1);
    const sql = sqlText(database.queries[0]!);
    expect(sql).toContain('acp_topology_carrier_signature_root_scopes');
    expect(sql).toContain('acp_topology_carrier_signature_roots');
    expect(sql).toContain('acp_topology_carrier_signature_root_evidence');
    expect(sql).not.toContain('acp_runtime');
    expect(request.runtimeConnection).toBe('NOT_CONFIGURED');
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it('accepts exact replay but denies conflicting persisted state', async () => {
    const database = new ScriptedSqlClient([[{ applied: 0 }], [storedRow()]]);
    await expect(
      new PostgresTopologyCarrierSignatureRootRegistry(database).provision(
        request,
        capability(),
        context,
        () => NOW,
      ),
    ).resolves.toBe('REPLAYED');

    const conflict = new ScriptedSqlClient([
      [{ applied: 0 }],
      [storedRow({ principalReference: 'substituted-principal' })],
    ]);
    await expect(
      new PostgresTopologyCarrierSignatureRootRegistry(conflict).provision(
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
    await expect(
      new PostgresTopologyCarrierSignatureRootRegistry(database).provision(
        request,
        trustedCapability,
        context,
        () => NOW,
      ),
    ).rejects.toThrow();
    expect(database.queries).toHaveLength(0);
  });

  it('denies binding, role, principal, root-version, validity, revocation, and shape substitution', async () => {
    const variants: unknown[] = [
      { ...request, workspaceId: 'workspace-2' },
      { ...request, supervisorInstanceId: 'native-supervisor-2' },
      { ...request, root: { ...root, principalRole: 'WORKER_CLIENT' } },
      { ...request, root: { ...root, principalReference: binding.workerPrincipalReference } },
      { ...request, root: { ...root, rootRecordVersion: 2 } },
      { ...request, root: { ...root, bindingHash: 'c'.repeat(64) } },
      { ...request, root: { ...root, validFrom: binding.expiresAt } },
      { ...request, root: { ...root, validUntil: binding.issuedAt } },
      { ...request, root: { ...root, revokedAt: binding.issuedAt } },
      { ...request, extra: true },
      Object.defineProperty({ ...request }, 'root', { get: () => root, enumerable: true }),
    ];
    for (const variant of variants) {
      const database = new ScriptedSqlClient([]);
      await expect(
        new PostgresTopologyCarrierSignatureRootRegistry(database).provision(
          variant,
          capability(),
          context,
          () => NOW,
        ),
      ).rejects.toThrow();
      expect(database.queries).toHaveLength(0);
    }
  });

  it('reads only the exact live binding and denies ambiguity', async () => {
    const database = new ScriptedSqlClient([[storedRow()]]);
    const registry = new PostgresTopologyCarrierSignatureRootRegistry(database);
    await expect(registry.read(binding, 'API_COORDINATOR', () => NOW)).resolves.toEqual(root);
    const sql = sqlText(database.queries[0]!);
    expect(sql).toContain('r."bindingHash" =');
    expect(sql).toContain('r."principalRole" =');
    expect(sql).toContain('s."expiresAt" > clock_timestamp()');
    expect(sql).toContain('LIMIT 2');

    await expect(
      new PostgresTopologyCarrierSignatureRootRegistry(
        new ScriptedSqlClient([[storedRow(), storedRow()]]),
      ).read(binding, 'API_COORDINATOR', () => NOW),
    ).rejects.toThrow(/ambiguous/u);
    await expect(
      new PostgresTopologyCarrierSignatureRootRegistry(new ScriptedSqlClient([[]])).read(
        binding,
        'WORKER_CLIENT',
        () => NOW,
      ),
    ).resolves.toBeNull();
  });
});
