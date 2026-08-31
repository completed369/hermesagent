import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BRIDGE_BROKER_EVIDENCE_VERIFIER,
  BRIDGE_ARTIFACT_CONTENT_VERIFIER,
  BRIDGE_CAPABILITY_POLICY_VERIFIER,
  BRIDGE_SECRET_LEASE_RESOLVER,
  BRIDGE_TEST_ONLY_GATE,
  BRIDGE_PROTOCOL_VERSION,
  CODEX_APP_SERVER_ADAPTER_KIND,
  CODEX_REGISTRATION_AUTHORIZATION_SOURCE,
  BridgeProtocolError,
  canonicalJson,
  decodeBridgeBatch,
  deriveBridgeKeys,
  digestBridgePayload,
  digestSecretReference,
  encodeBridgeLine,
  validateBridgeEnvelope,
  validateUsageDelta,
  verifyBridgeEnvelope,
  signBridgeEnvelope,
  BridgeSecretLeaseError,
  codexRegistrationAuthorizationRequestHash,
  createCodexRegistrationAuthorizationRequest,
  DenyCodexRegistrationAuthorizationSource,
  validateCodexAuthenticatedRegistrationCandidate,
  validateCodexRegistrationAuthorizationDecision,
  type BridgeArtifactContentVerifier,
  type BridgeBrokerEvidenceVerifier,
  type BridgeCapabilityPolicyVerifier,
  type BridgeEnvelope,
  type BridgeSecretLeaseRequest,
  type BridgeSecretLeaseResolver,
  type BridgeTestOnlyGate,
  type CodexAuthenticatedRegistrationCandidate,
  type CodexRegistrationAuthorizationSource,
  type TrustedBridgeBrokerEvidence,
} from '@ventureos/agent-bridge';
import {
  validateAcpApprovalReference,
  type AssignmentEvidenceVerifier,
  type DurableArtifactEvidenceVerifier,
  type OperationalEvent,
  type OperationalEventCapability,
  type TrustedArtifactEvidence,
  type TrustedAssignmentEvidence,
  type WorkspaceContext,
} from '@ventureos/agent-control-plane';
import { Prisma, prisma } from '@ventureos/database';
import type { AuditService } from '../audit/audit.service';
import { AUDIT_SERVICE } from '../audit/audit.tokens';
import { AcpCostGovernanceService } from './acp-cost-governance.service';

export class AcpBridgeAdmissionError extends Error {}
export class AcpBridgeAdmissionDeniedError extends AcpBridgeAdmissionError {}
export class AcpBridgeAdmissionConflictError extends AcpBridgeAdmissionError {}
export class AcpBridgeAdmissionNotFoundError extends AcpBridgeAdmissionError {}

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_CODE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const CAPABILITY_OWNER_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;

function exactPayload(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AcpBridgeAdmissionDeniedError('Bridge message payload does not match its schema');
  }
}

function reference(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') throw new AcpBridgeAdmissionDeniedError(`${field} is required`);
  try {
    validateAcpApprovalReference(value, field);
  } catch {
    throw new AcpBridgeAdmissionDeniedError(`${field} must be a safe non-sensitive reference`);
  }
}

function publicReference(value: unknown, field: string): asserts value is string {
  reference(value, field);
}

function capabilityOwnerReference(value: unknown): asserts value is string {
  reference(value, 'ownerReference');
  if (!CAPABILITY_OWNER_REFERENCE.test(value)) {
    throw new AcpBridgeAdmissionDeniedError(
      'ownerReference must match the authenticated capability reference',
    );
  }
}

function auditSubjectReference(value: unknown, field: string): asserts value is string {
  reference(value, field);
  if (!CAPABILITY_OWNER_REFERENCE.test(value)) {
    throw new AcpBridgeAdmissionDeniedError(
      `${field} must match the capability-safe audit reference`,
    );
  }
}

function digest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new AcpBridgeAdmissionDeniedError(`${field} must be a SHA-256 digest`);
  }
}

function assertControlPlane(
  capability: OperationalEventCapability,
  context: WorkspaceContext,
  minimumAuthority: 0 | 1 | 2 | 3,
): 'HUMAN' | 'AGENT' | 'SYSTEM' {
  capability.assertSource('CONTROL_PLANE');
  const actorKind = capability.actorKindFor(context);
  if (actorKind === 'RUNTIME' || capability.authorityLevelFor(context) < minimumAuthority) {
    throw new AcpBridgeAdmissionDeniedError('Trusted control-plane authority is required');
  }
  return actorKind;
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  const now = rows[0]?.now;
  if (!(now instanceof Date)) throw new AcpBridgeAdmissionDeniedError('Database clock unavailable');
  return now;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function egressAuditIdempotencyKey(
  kind: 'claim' | 'release',
  binding: Readonly<Record<string, unknown>>,
): string {
  return `bridge-egress-${kind}:${sha256({
    ...binding,
    domain: `ventureos.bridge.egress.${kind}.audit.v1`,
  })}`;
}

function exactDigestMatch(left: string, right: string): boolean {
  return (
    SHA256.test(left) &&
    SHA256.test(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export interface ProvisionBridgeRuntimeInput {
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly adapterKind: 'PROTOCOL_NEUTRAL' | 'DETERMINISTIC_FAKE';
  readonly environment: string;
  readonly principalReference: string;
  readonly secretReference: string;
  readonly capabilityPolicyHash: string;
  readonly idempotencyKey: string;
}

export interface RegisterCodexRuntimeInput {
  readonly candidate: Readonly<CodexAuthenticatedRegistrationCandidate>;
  readonly environment: string;
  readonly secretReference: string;
  readonly capabilityPolicyHash: string;
  readonly idempotencyKey: string;
}

export interface PrepareBridgeDispatchInput {
  readonly dispatchId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly brokerEvidence: TrustedBridgeBrokerEvidence;
  readonly idempotencyKey: string;
}

export interface PrepareBridgeDispatchAuthorizationInput {
  readonly capsuleId: string;
  readonly dispatchId: string;
  readonly idempotencyKey: string;
}

export interface ClaimBridgeEgressHandoffInput {
  readonly attemptId: string;
  readonly outboxId: string;
  readonly idempotencyKey: string;
}

export interface ReleaseBridgeEgressHandoffInput {
  readonly releaseId: string;
  readonly attemptId: string;
  readonly idempotencyKey: string;
}

export interface AcceptAuthenticatedBridgeBatchInput {
  readonly sessionId: string;
  readonly bytes: Uint8Array;
}

interface BridgeUsageAuditTotals {
  readonly taskCostUsedMinorUnits: number;
  readonly taskComputeUsed: number;
  readonly taskCostLimitMinorUnits: number;
  readonly workspaceCostUsedMinorUnits: number;
  readonly workspaceCostLimitMinorUnits: number;
  readonly workspacePolicyId: string;
  readonly ledgerEntryId: string;
}

/**
 * Service-only authenticated admission boundary. It accepts already-delivered
 * protocol frames; it has no controller, transport, network, or process path.
 */
@Injectable()
export class AcpBridgeAdmissionService
  implements AssignmentEvidenceVerifier, DurableArtifactEvidenceVerifier
{
  constructor(
    @Inject(AUDIT_SERVICE) private readonly auditService: AuditService,
    @Inject(BRIDGE_SECRET_LEASE_RESOLVER)
    private readonly secrets: BridgeSecretLeaseResolver,
    @Inject(BRIDGE_BROKER_EVIDENCE_VERIFIER)
    private readonly brokerEvidence: BridgeBrokerEvidenceVerifier,
    @Inject(BRIDGE_CAPABILITY_POLICY_VERIFIER)
    private readonly capabilityPolicy: BridgeCapabilityPolicyVerifier,
    @Inject(BRIDGE_ARTIFACT_CONTENT_VERIFIER)
    private readonly artifactContent: BridgeArtifactContentVerifier,
    @Inject(BRIDGE_TEST_ONLY_GATE) private readonly testOnlyGate: BridgeTestOnlyGate,
    @Inject(AcpCostGovernanceService)
    private readonly costGovernance: AcpCostGovernanceService,
    @Inject(CODEX_REGISTRATION_AUTHORIZATION_SOURCE)
    private readonly codexRegistrationAuthorizations: CodexRegistrationAuthorizationSource = new DenyCodexRegistrationAuthorizationSource(),
  ) {}

  async registerCodexRuntime(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: RegisterCodexRuntimeInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    reference(input.environment, 'environment');
    reference(input.secretReference, 'secretReference');
    reference(input.idempotencyKey, 'idempotencyKey');
    digest(input.capabilityPolicyHash, 'capabilityPolicyHash');
    let candidate: Readonly<CodexAuthenticatedRegistrationCandidate>;
    try {
      candidate = validateCodexAuthenticatedRegistrationCandidate(input.candidate);
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Invalid Codex registration evidence');
    }
    if (
      candidate.workspaceId !== context.workspaceId ||
      candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
      candidate.authGeneration !== 1
    )
      throw new AcpBridgeAdmissionDeniedError('Codex registration identity is not admissible');

    const authorizationRequest = createCodexRegistrationAuthorizationRequest(
      candidate,
      input.environment,
      input.capabilityPolicyHash,
      input.idempotencyKey,
    );
    const authorizationRequestHash =
      codexRegistrationAuthorizationRequestHash(authorizationRequest);
    let authorization: ReturnType<typeof validateCodexRegistrationAuthorizationDecision>;
    try {
      authorization = validateCodexRegistrationAuthorizationDecision(
        await this.codexRegistrationAuthorizations.read(authorizationRequest),
        authorizationRequestHash,
      );
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Codex registration authorization denied');
    }
    const secretDigest = await this.withSecretLease(
      {
        workspaceId: context.workspaceId,
        runtimeId: candidate.runtimeId,
        connectionId: candidate.connectionId,
        secretReference: input.secretReference,
        authGeneration: candidate.authGeneration,
        purpose: 'PROVISION',
      },
      (secret) => digestSecretReference(secret),
    );
    if (
      candidate.secretBindingHash !==
      sha256({ expectedSecretDigest: secretDigest, secretReference: input.secretReference })
    )
      throw new AcpBridgeAdmissionDeniedError('Codex registration secret binding mismatch');

    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = await databaseNow(tx);
          const observedAt = new Date(candidate.observedAt);
          const authorizationIssuedAt = new Date(authorization.issuedAt);
          const authorizationExpiresAt = new Date(authorization.expiresAt);
          if (
            observedAt > now ||
            now.getTime() - observedAt.getTime() > 5 * 60_000 ||
            authorizationIssuedAt < observedAt ||
            authorizationIssuedAt > now ||
            authorizationExpiresAt <= now
          )
            throw new AcpBridgeAdmissionDeniedError('Codex registration evidence expired');

          const [existingByCandidate, existingByKey, existingRuntime, existingAuthorization] =
            await Promise.all([
              tx.acpRuntimeRegistrationEvidence.findUnique({
                where: {
                  workspaceId_registrationCandidateHash: {
                    workspaceId: context.workspaceId,
                    registrationCandidateHash: candidate.registrationCandidateHash,
                  },
                },
                include: { connection: { include: { runtime: true } } },
              }),
              tx.acpRuntimeRegistrationEvidence.findUnique({
                where: {
                  workspaceId_registrationIdempotencyKey: {
                    workspaceId: context.workspaceId,
                    registrationIdempotencyKey: input.idempotencyKey,
                  },
                },
                include: { connection: { include: { runtime: true } } },
              }),
              tx.acpRuntime.findUnique({
                where: {
                  workspaceId_id: { workspaceId: context.workspaceId, id: candidate.runtimeId },
                },
                include: { connections: true },
              }),
              tx.acpRuntimeRegistrationEvidence.findUnique({
                where: {
                  workspaceId_authorizationId: {
                    workspaceId: context.workspaceId,
                    authorizationId: authorization.authorizationId,
                  },
                },
              }),
            ]);
          const existingEvidence = existingByCandidate ?? existingByKey;
          if (existingEvidence) {
            const runtime = existingEvidence.connection.runtime;
            const connection = existingEvidence.connection;
            if (
              existingByCandidate?.registrationIdempotencyKey !== input.idempotencyKey ||
              existingByKey?.registrationCandidateHash !== candidate.registrationCandidateHash ||
              existingEvidence.runtimeId !== candidate.runtimeId ||
              existingEvidence.connectionId !== candidate.connectionId ||
              existingEvidence.sessionId !== candidate.sessionId ||
              existingEvidence.principalReference !== candidate.principalReference ||
              existingEvidence.authorizationId !== authorization.authorizationId ||
              existingEvidence.authorizationRequestHash !== authorizationRequestHash ||
              existingEvidence.authorizedByReference !== authorization.authorizedByReference ||
              existingEvidence.authorizationIssuedAt.getTime() !==
                authorizationIssuedAt.getTime() ||
              existingEvidence.authorizationExpiresAt.getTime() !==
                authorizationExpiresAt.getTime() ||
              runtime.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
              runtime.status !== 'NOT_CONFIGURED' ||
              runtime.secretReference !== input.secretReference ||
              runtime.secretDigest !== secretDigest ||
              runtime.capabilityPolicyHash !== input.capabilityPolicyHash ||
              connection.environment !== input.environment ||
              connection.status !== 'NOT_CONFIGURED' ||
              connection.authGeneration !== candidate.authGeneration
            )
              throw new AcpBridgeAdmissionConflictError('Codex registration replay drifted');
            return { runtime, connection, evidence: existingEvidence, replayed: true };
          }
          if (existingRuntime || existingAuthorization)
            throw new AcpBridgeAdmissionConflictError('Codex registration identity already exists');

          const runtime = await tx.acpRuntime.create({
            data: {
              id: candidate.runtimeId,
              workspaceId: context.workspaceId,
              adapterKind: CODEX_APP_SERVER_ADAPTER_KIND,
              principalReference: candidate.principalReference,
              secretReference: input.secretReference,
              secretDigest,
              capabilityPolicyHash: input.capabilityPolicyHash,
              provisioningIdempotencyKey: input.idempotencyKey,
            },
          });
          const connection = await tx.acpRuntimeConnection.create({
            data: {
              id: candidate.connectionId,
              workspaceId: context.workspaceId,
              runtimeId: candidate.runtimeId,
              environment: input.environment,
              authGeneration: candidate.authGeneration,
            },
          });
          const evidence = await tx.acpRuntimeRegistrationEvidence.create({
            data: {
              workspaceId: context.workspaceId,
              registrationCandidateHash: candidate.registrationCandidateHash,
              runtimeId: candidate.runtimeId,
              connectionId: candidate.connectionId,
              sessionId: candidate.sessionId,
              principalReference: candidate.principalReference,
              adapterKind: candidate.adapterKind,
              authGeneration: candidate.authGeneration,
              accountAuthMode: candidate.accountAuthMode,
              manifestHash: candidate.manifestHash,
              adapterPolicyHash: candidate.adapterPolicyHash,
              bridgeIdentityHash: candidate.bridgeIdentityHash,
              secretBindingHash: candidate.secretBindingHash,
              accountEvidenceHash: candidate.accountEvidenceHash,
              observedAt,
              authorizationId: authorization.authorizationId,
              authorizationRequestHash,
              authorizedByReference: authorization.authorizedByReference,
              authorizationIssuedAt,
              authorizationExpiresAt,
              registrationIdempotencyKey: input.idempotencyKey,
            },
          });
          await this.auditService.recordOperationalEvent(
            capability,
            context,
            {
              id: randomUUID(),
              workspaceId: context.workspaceId,
              type: 'runtime.connection.updated',
              source: 'CONTROL_PLANE',
              actorKind,
              actorId: context.principalId,
              subjectType: 'AcpRuntimeRegistrationEvidence',
              subjectId: candidate.registrationCandidateHash,
              occurredAt: now.toISOString(),
              idempotencyKey: `${input.idempotencyKey}:event`,
              correlationId: candidate.sessionId,
              facts: {
                status: 'NOT_CONFIGURED',
                runtimeId: candidate.runtimeId,
              },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
          return { runtime, connection, evidence, replayed: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex registration conflict; retry with current durable state',
        );
      throw error;
    }
  }

  async provisionRuntime(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ProvisionBridgeRuntimeInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    for (const [field, value] of Object.entries(input)) {
      if (field !== 'capabilityPolicyHash') reference(value, field);
    }
    digest(input.capabilityPolicyHash, 'capabilityPolicyHash');
    await this.assertAdapterIsolation(context.workspaceId, input.adapterKind, input.environment);
    const forbiddenRealRuntime = /^(?:codex|hermes|pi)(?:[._:-]|$)/iu;
    if (forbiddenRealRuntime.test(input.runtimeId)) {
      throw new AcpBridgeAdmissionDeniedError(
        'Real named runtimes require a separately reviewed connection change',
      );
    }
    const secretDigest = await this.withSecretLease(
      {
        workspaceId: context.workspaceId,
        runtimeId: input.runtimeId,
        connectionId: input.connectionId,
        secretReference: input.secretReference,
        authGeneration: 1,
        purpose: 'PROVISION',
      },
      (secret) => digestSecretReference(secret),
    );
    return prisma.$transaction(
      async (tx) => {
        const [existingByRuntime, existingByKey] = await Promise.all([
          tx.acpRuntime.findUnique({
            where: {
              workspaceId_id: { workspaceId: context.workspaceId, id: input.runtimeId },
            },
            include: { connections: true },
          }),
          tx.acpRuntime.findUnique({
            where: {
              workspaceId_provisioningIdempotencyKey: {
                workspaceId: context.workspaceId,
                provisioningIdempotencyKey: input.idempotencyKey,
              },
            },
            include: { connections: true },
          }),
        ]);
        const existingRuntime = existingByRuntime ?? existingByKey;
        if (existingRuntime) {
          const existingConnection = existingRuntime.connections.find(
            (connection) => connection.id === input.connectionId,
          );
          if (
            existingRuntime.id !== input.runtimeId ||
            existingRuntime.adapterKind !== input.adapterKind ||
            existingRuntime.provisioningIdempotencyKey !== input.idempotencyKey ||
            existingRuntime.principalReference !== input.principalReference ||
            existingRuntime.secretReference !== input.secretReference ||
            existingRuntime.secretDigest !== secretDigest ||
            existingRuntime.capabilityPolicyHash !== input.capabilityPolicyHash ||
            !existingConnection ||
            existingConnection.runtimeId !== input.runtimeId ||
            existingConnection.environment !== input.environment
          ) {
            throw new AcpBridgeAdmissionConflictError('Runtime provisioning replay drifted');
          }
          return { runtime: existingRuntime, connection: existingConnection, replayed: true };
        }
        const runtime = await tx.acpRuntime.create({
          data: {
            id: input.runtimeId,
            workspaceId: context.workspaceId,
            adapterKind: input.adapterKind,
            principalReference: input.principalReference,
            secretReference: input.secretReference,
            secretDigest,
            capabilityPolicyHash: input.capabilityPolicyHash,
            provisioningIdempotencyKey: input.idempotencyKey,
          },
        });
        const connection = await tx.acpRuntimeConnection.create({
          data: {
            id: input.connectionId,
            workspaceId: context.workspaceId,
            runtimeId: input.runtimeId,
            environment: input.environment,
          },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'runtime.connection.updated',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpRuntimeConnection',
            subjectId: connection.id,
            occurredAt: new Date().toISOString(),
            idempotencyKey: `${input.idempotencyKey}:event`,
            facts: { status: 'NOT_CONFIGURED', runtimeId: runtime.id },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return { runtime, connection, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async openSession(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: {
      readonly sessionId: string;
      readonly connectionId: string;
      readonly parentNonce: string;
      readonly expiresAt: string;
    },
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    reference(input.sessionId, 'sessionId');
    reference(input.connectionId, 'connectionId');
    reference(input.parentNonce, 'parentNonce');
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()))
      throw new AcpBridgeAdmissionDeniedError('Invalid expiry');
    return prisma.$transaction(async (tx) => {
      const connection = await tx.acpRuntimeConnection.findUnique({
        where: { workspaceId_id: { workspaceId: context.workspaceId, id: input.connectionId } },
        include: { runtime: true },
      });
      if (!connection) throw new AcpBridgeAdmissionNotFoundError('Runtime connection not found');
      await this.assertAdapterIsolation(
        context.workspaceId,
        connection.runtime.adapterKind,
        connection.environment,
      );
      const now = await databaseNow(tx);
      if (expiresAt <= now || expiresAt.getTime() > now.getTime() + 5 * 60_000) {
        throw new AcpBridgeAdmissionDeniedError(
          'Session expiry must be future and at most five minutes',
        );
      }
      const session = await tx.acpBridgeSession.create({
        data: {
          id: input.sessionId,
          workspaceId: context.workspaceId,
          runtimeId: connection.runtimeId,
          connectionId: connection.id,
          principalReference: connection.runtime.principalReference,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          parentNonce: input.parentNonce,
          expiresAt,
        },
      });
      await this.auditService.recordOperationalEvent(
        capability,
        context,
        {
          id: randomUUID(),
          workspaceId: context.workspaceId,
          type: 'runtime.connection.updated',
          source: 'CONTROL_PLANE',
          actorKind,
          actorId: context.principalId,
          subjectType: 'AcpBridgeSession',
          subjectId: session.id,
          occurredAt: now.toISOString(),
          idempotencyKey: `bridge-session:${session.id}`,
          facts: { status: 'NOT_CONFIGURED', runtimeId: connection.runtimeId },
        },
        actorKind === 'HUMAN' ? context.principalId : undefined,
        tx,
      );
      return session;
    });
  }

  async authenticateSession(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    envelope: BridgeEnvelope,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    validateBridgeEnvelope(envelope);
    if (envelope.type !== 'AUTHENTICATE')
      throw new AcpBridgeAdmissionDeniedError('Expected authentication frame');
    exactPayload(envelope.payload, ['parentNonce', 'runtimeNonce']);
    const parentNonce = envelope.payload.parentNonce;
    const runtimeNonce = envelope.payload.runtimeNonce;
    reference(parentNonce, 'parentNonce');
    reference(runtimeNonce, 'runtimeNonce');
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${envelope.sessionId} FOR UPDATE`,
        );
        const session = await tx.acpBridgeSession.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: envelope.sessionId } },
          include: { connection: { include: { runtime: true } } },
        });
        if (!session) throw new AcpBridgeAdmissionNotFoundError('Bridge session not found');
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${session.connectionId} FOR UPDATE`,
        );
        const lockedConnection = await tx.acpRuntimeConnection.findUniqueOrThrow({
          where: {
            workspaceId_id: { workspaceId: context.workspaceId, id: session.connectionId },
          },
          include: { runtime: true },
        });
        const now = await databaseNow(tx);
        await this.assertAdapterIsolation(
          context.workspaceId,
          lockedConnection.runtime.adapterKind,
          lockedConnection.environment,
        );
        if (
          session.expiresAt <= now ||
          session.state !== 'CHALLENGED' ||
          session.expectedSequence !== 1
        ) {
          throw new AcpBridgeAdmissionConflictError('Bridge session is not challenge-ready');
        }
        if (parentNonce !== session.parentNonce) {
          throw new AcpBridgeAdmissionDeniedError('Challenge nonce mismatch');
        }
        const keyContext = {
          workspaceId: session.workspaceId,
          runtimeId: session.runtimeId,
          connectionId: session.connectionId,
          sessionId: session.id,
          principalReference: session.principalReference,
          parentNonce: session.parentNonce,
          runtimeNonce,
        };
        const keyDigest = await this.withSecretLease(
          {
            workspaceId: session.workspaceId,
            runtimeId: session.runtimeId,
            connectionId: session.connectionId,
            secretReference: lockedConnection.runtime.secretReference,
            expectedDigest: lockedConnection.runtime.secretDigest,
            authGeneration: lockedConnection.authGeneration,
            purpose: 'AUTHENTICATE',
          },
          (secret) => {
            const keys = deriveBridgeKeys(secret, keyContext);
            try {
              verifyBridgeEnvelope(envelope, keys.runtimeToParent, keyContext, now);
              return createHash('sha256')
                .update(keys.parentToRuntime)
                .update(keys.runtimeToParent)
                .digest('hex');
            } finally {
              keys.parentToRuntime.fill(0);
              keys.runtimeToParent.fill(0);
            }
          },
        );
        if (envelope.sequence !== 1)
          throw new AcpBridgeAdmissionConflictError('Authentication sequence mismatch');
        const receipt = await this.createReceipt(tx, envelope);
        const updated = await tx.acpBridgeSession.update({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: session.id } },
          data: {
            state: 'AUTHENTICATED',
            runtimeNonce,
            keyDigest,
            expectedSequence: 2,
            authenticatedAt: now,
          },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'runtime.connection.updated',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpBridgeSession',
            subjectId: session.id,
            occurredAt: now.toISOString(),
            idempotencyKey: `bridge-auth:${receipt.id}`,
            facts: { status: 'NOT_CONFIGURED', runtimeId: session.runtimeId },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async acceptRuntimeMessage(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    envelope: BridgeEnvelope,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    validateBridgeEnvelope(envelope);
    if (
      envelope.type === 'AUTHENTICATE' ||
      envelope.type === 'CHALLENGE' ||
      envelope.type === 'DISPATCH'
    ) {
      throw new AcpBridgeAdmissionDeniedError('Use the dedicated authentication boundary');
    }
    const snapshot = decodeBridgeBatch(encodeBridgeLine(envelope))[0];
    if (!snapshot) throw new AcpBridgeAdmissionDeniedError('Bridge frame snapshot unavailable');
    const receipts = await this.acceptRuntimeEnvelopes(
      capability,
      context,
      actorKind,
      snapshot.sessionId,
      [snapshot],
    );
    return receipts[0]!;
  }

  async acceptAuthenticatedBatch(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: AcceptAuthenticatedBridgeBatchInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).sort().join(',') !== 'bytes,sessionId' ||
      !(input.bytes instanceof Uint8Array)
    ) {
      throw new AcpBridgeAdmissionDeniedError('Authenticated bridge batch input is invalid');
    }
    reference(input.sessionId, 'sessionId');
    let envelopes: readonly BridgeEnvelope[];
    try {
      envelopes = decodeBridgeBatch(input.bytes);
    } catch (error) {
      if (error instanceof BridgeProtocolError) {
        throw new AcpBridgeAdmissionDeniedError('Authenticated bridge batch is invalid');
      }
      throw error;
    }
    return this.acceptRuntimeEnvelopes(capability, context, actorKind, input.sessionId, envelopes);
  }

  private async acceptRuntimeEnvelopes(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    actorKind: 'HUMAN' | 'AGENT' | 'SYSTEM',
    sessionId: string,
    envelopes: readonly BridgeEnvelope[],
  ) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${sessionId} FOR UPDATE`,
        );
        let session = await tx.acpBridgeSession.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: sessionId } },
          include: { connection: { include: { runtime: true } } },
        });
        if (!session) throw new AcpBridgeAdmissionNotFoundError('Bridge session not found');
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${session.connectionId} FOR UPDATE`,
        );
        let lockedConnection = await tx.acpRuntimeConnection.findUniqueOrThrow({
          where: {
            workspaceId_id: { workspaceId: context.workspaceId, id: session.connectionId },
          },
          include: { runtime: true },
        });
        const claimedDispatchIds = [
          ...new Set(
            envelopes.flatMap((envelope) =>
              typeof envelope.payload.dispatchId === 'string' ? [envelope.payload.dispatchId] : [],
            ),
          ),
        ].sort();
        const claimedRunIds = new Set<string>();
        const claimedTaskIds = new Set<string>();
        for (const claimedDispatchId of claimedDispatchIds) {
          reference(claimedDispatchId, 'dispatchId');
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${claimedDispatchId} FOR UPDATE`,
          );
          const claimedDispatch = await tx.acpBridgeDispatch.findUnique({
            where: {
              workspaceId_id: { workspaceId: context.workspaceId, id: claimedDispatchId },
            },
          });
          if (claimedDispatch) {
            claimedRunIds.add(claimedDispatch.runId);
            claimedTaskIds.add(claimedDispatch.taskId);
          }
        }
        for (const claimedRunId of [...claimedRunIds].sort()) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${claimedRunId} FOR UPDATE`,
          );
        }
        for (const claimedTaskId of [...claimedTaskIds].sort()) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${claimedTaskId} FOR UPDATE`,
          );
        }
        const now = await databaseNow(tx);
        await this.assertAdapterIsolation(
          context.workspaceId,
          lockedConnection.runtime.adapterKind,
          lockedConnection.environment,
        );
        if (
          !session.runtimeNonce ||
          !session.authenticatedAt ||
          session.expiresAt <= now ||
          session.state === 'CLOSED'
        ) {
          throw new AcpBridgeAdmissionDeniedError(
            'Authenticated unexpired bridge session required',
          );
        }
        const keyContext = {
          workspaceId: session.workspaceId,
          runtimeId: session.runtimeId,
          connectionId: session.connectionId,
          sessionId: session.id,
          principalReference: session.principalReference,
          parentNonce: session.parentNonce,
          runtimeNonce: session.runtimeNonce,
        };
        const sessionExpiresAt = session.expiresAt;
        if (
          envelopes.some(
            (envelope) =>
              envelope.type === 'AUTHENTICATE' ||
              envelope.type === 'CHALLENGE' ||
              envelope.type === 'DISPATCH',
          )
        ) {
          throw new AcpBridgeAdmissionDeniedError('Use the dedicated authentication boundary');
        }
        for (const [index, envelope] of envelopes.entries()) {
          if (envelope.sequence !== session.expectedSequence + index) {
            throw new AcpBridgeAdmissionConflictError('Bridge sequence replay or gap');
          }
        }
        if (
          (session.state === 'AUTHENTICATED' && envelopes[0]?.type !== 'CAPABILITIES') ||
          (session.state !== 'AUTHENTICATED' &&
            envelopes.some((envelope) => envelope.type === 'CAPABILITIES')) ||
          envelopes.slice(1).some((envelope) => envelope.type === 'CAPABILITIES')
        ) {
          throw new AcpBridgeAdmissionDeniedError('Capability exchange ordering is invalid');
        }
        let verifiedAt: Date;
        let verificationCompleted = false;
        try {
          verifiedAt = await this.withSecretLease(
            {
              workspaceId: session.workspaceId,
              runtimeId: session.runtimeId,
              connectionId: session.connectionId,
              secretReference: lockedConnection.runtime.secretReference,
              expectedDigest: lockedConnection.runtime.secretDigest,
              authGeneration: lockedConnection.authGeneration,
              purpose: 'VERIFY_FRAME',
            },
            async (secret) => {
              const keys = deriveBridgeKeys(secret, keyContext);
              try {
                for (const envelope of envelopes) {
                  verifyBridgeEnvelope(envelope, keys.runtimeToParent, keyContext, now);
                }
                const current = await databaseNow(tx);
                if (sessionExpiresAt <= current) {
                  throw new AcpBridgeAdmissionDeniedError(
                    'Authenticated unexpired bridge session required',
                  );
                }
                for (const envelope of envelopes) {
                  verifyBridgeEnvelope(envelope, keys.runtimeToParent, keyContext, current);
                }
                verificationCompleted = true;
                return current;
              } finally {
                keys.parentToRuntime.fill(0);
                keys.runtimeToParent.fill(0);
              }
            },
          );
        } catch (error) {
          if (error instanceof BridgeProtocolError) {
            throw new AcpBridgeAdmissionDeniedError('Authenticated bridge batch was denied');
          }
          throw error;
        }
        if (!verificationCompleted || !(verifiedAt instanceof Date)) {
          throw new AcpBridgeAdmissionDeniedError('Authenticated bridge batch was not verified');
        }
        const persistenceNow = await databaseNow(tx);
        if (
          session.expiresAt <= persistenceNow ||
          envelopes.some((envelope) => new Date(envelope.expiresAt) <= persistenceNow)
        ) {
          throw new AcpBridgeAdmissionDeniedError('Authenticated bridge batch expired');
        }
        const receipts = [];
        for (const envelope of envelopes) {
          const receipt = await this.createReceipt(tx, envelope);
          const usageTotals = await this.applyMessage(
            tx,
            { ...session, connection: lockedConnection },
            envelope,
            receipt.id,
            receipt.receivedAt,
            persistenceNow,
            capability,
            context,
            actorKind,
          );
          await tx.acpBridgeSession.update({
            where: { workspaceId_id: { workspaceId: context.workspaceId, id: session.id } },
            data: { expectedSequence: { increment: 1 } },
          });
          const audit = this.auditForMessage(envelope, receipt.id, persistenceNow, usageTotals);
          await this.auditService.recordOperationalEvent(
            capability,
            context,
            {
              ...audit,
              id: randomUUID(),
              workspaceId: context.workspaceId,
              source: 'CONTROL_PLANE',
              actorKind,
              actorId: context.principalId,
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
          receipts.push(receipt);
          session = await tx.acpBridgeSession.findUniqueOrThrow({
            where: { workspaceId_id: { workspaceId: context.workspaceId, id: session.id } },
            include: { connection: { include: { runtime: true } } },
          });
          lockedConnection = session.connection;
        }
        const commitNow = await databaseNow(tx);
        if (
          session.expiresAt <= commitNow ||
          envelopes.some((envelope) => new Date(envelope.expiresAt) <= commitNow) ||
          envelopes.some(
            (envelope) =>
              envelope.type === 'HEARTBEAT' &&
              new Date(envelope.issuedAt).getTime() < commitNow.getTime() - 60_000,
          ) ||
          (envelopes.some((envelope) => envelope.type === 'DISPATCH_ACCEPTED') &&
            (!lockedConnection.lastHeartbeatAt ||
              lockedConnection.lastHeartbeatHealth !== 'HEALTHY' ||
              lockedConnection.lastHeartbeatAt.getTime() < commitNow.getTime() - 60_000))
        ) {
          throw new AcpBridgeAdmissionDeniedError('Authenticated bridge batch expired');
        }
        return Object.freeze(receipts);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async prepareDispatch(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: PrepareBridgeDispatchInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    for (const [field, value] of Object.entries({
      dispatchId: input.dispatchId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
    }))
      reference(value, field);
    for (const [field, value] of Object.entries(input.brokerEvidence))
      field === 'evidenceHash' ? digest(value, field) : reference(value, field);
    if (
      input.brokerEvidence.workspaceId !== context.workspaceId ||
      input.brokerEvidence.agentId !== input.agentId ||
      !(await this.brokerEvidence.verify(input.brokerEvidence))
    ) {
      throw new AcpBridgeAdmissionDeniedError('Trusted broker evidence was not verified');
    }
    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.acpBridgeDispatch.findUnique({
          where: {
            workspaceId_idempotencyKey: {
              workspaceId: context.workspaceId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          if (
            existing.id !== input.dispatchId ||
            existing.sessionId !== input.sessionId ||
            existing.agentId !== input.agentId ||
            existing.runId !== input.brokerEvidence.runId ||
            existing.taskId !== input.brokerEvidence.taskId ||
            existing.agentId !== input.brokerEvidence.agentId ||
            existing.runtimeId !== input.brokerEvidence.runtimeId ||
            existing.connectionId !== input.brokerEvidence.connectionId ||
            existing.brokerEvidenceId !== input.brokerEvidence.evidenceId ||
            existing.brokerEvidenceHash !== input.brokerEvidence.evidenceHash ||
            existing.assignmentEvidenceId !== `assignment:${input.dispatchId}`
          ) {
            throw new AcpBridgeAdmissionConflictError('Dispatch idempotency replay drifted');
          }
          return { dispatch: existing, replayed: true };
        }
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${input.sessionId} FOR UPDATE`,
        );
        let session = await tx.acpBridgeSession.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: input.sessionId } },
        });
        if (!session) throw new AcpBridgeAdmissionNotFoundError('Bound session not found');
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${session.connectionId} FOR UPDATE`,
        );
        let connection = await tx.acpRuntimeConnection.findUnique({
          where: {
            workspaceId_id: {
              workspaceId: context.workspaceId,
              id: session.connectionId,
            },
          },
          include: { runtime: true },
        });
        if (!connection)
          throw new AcpBridgeAdmissionNotFoundError('Bound runtime connection not found');
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${input.brokerEvidence.runId} FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${input.brokerEvidence.taskId} FOR UPDATE`,
        );
        let run = await tx.acpRun.findUnique({
          where: {
            workspaceId_id: { workspaceId: context.workspaceId, id: input.brokerEvidence.runId },
          },
          include: { task: true },
        });
        if (!run) throw new AcpBridgeAdmissionNotFoundError('Bound run not found');
        await this.assertAdapterIsolation(
          context.workspaceId,
          connection.runtime.adapterKind,
          connection.environment,
        );
        if (!(await this.brokerEvidence.verify(input.brokerEvidence))) {
          throw new AcpBridgeAdmissionDeniedError('Broker evidence changed before dispatch claim');
        }
        session = await tx.acpBridgeSession.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: input.sessionId } },
        });
        connection = await tx.acpRuntimeConnection.findUniqueOrThrow({
          where: {
            workspaceId_id: { workspaceId: context.workspaceId, id: session.connectionId },
          },
          include: { runtime: true },
        });
        run = await tx.acpRun.findUniqueOrThrow({
          where: {
            workspaceId_id: { workspaceId: context.workspaceId, id: input.brokerEvidence.runId },
          },
          include: { task: true },
        });
        const now = await databaseNow(tx);
        if (
          session.state !== 'PARTIAL' ||
          session.expiresAt <= now ||
          connection.status !== 'PARTIAL' ||
          connection.lastHeartbeatHealth !== 'HEALTHY' ||
          !connection.lastHeartbeatAt ||
          connection.lastHeartbeatAt.getTime() < now.getTime() - 60_000
        )
          throw new AcpBridgeAdmissionDeniedError('Fresh PARTIAL bridge evidence is required');
        if (run.requiredAuthority >= 4 || run.status !== 'PREPARED' || run.task.status !== 'READY')
          throw new AcpBridgeAdmissionDeniedError('Only ready Level 0-3 runs may be admitted');
        if (
          input.brokerEvidence.taskId !== run.taskId ||
          input.brokerEvidence.agentId !== input.agentId ||
          input.brokerEvidence.runtimeId !== session.runtimeId ||
          input.brokerEvidence.connectionId !== session.connectionId ||
          connection.runtimeId !== session.runtimeId ||
          connection.id !== session.connectionId
        )
          throw new AcpBridgeAdmissionDeniedError('Broker evidence binding mismatch');
        const assignmentEvidenceId = `assignment:${input.dispatchId}`;
        const assignmentEvidenceHash = sha256({
          evidenceId: assignmentEvidenceId,
          workspaceId: context.workspaceId,
          taskId: run.taskId,
          runId: run.id,
          agentId: input.agentId,
          runtimeId: session.runtimeId,
          connectionId: session.connectionId,
          brokerEvidenceHash: input.brokerEvidence.evidenceHash,
        });
        const dispatchEnvelopeHash = sha256({
          schemaVersion: 1,
          dispatchId: input.dispatchId,
          taskId: run.taskId,
          runId: run.id,
          runtimeId: session.runtimeId,
          connectionId: session.connectionId,
          sessionId: session.id,
          authorityLevel: run.requiredAuthority,
          policyHash: run.policyHash,
        });
        const dispatch = await tx.acpBridgeDispatch.create({
          data: {
            id: input.dispatchId,
            workspaceId: context.workspaceId,
            objectiveId: run.objectiveId,
            taskId: run.taskId,
            runId: run.id,
            runtimeId: session.runtimeId,
            connectionId: session.connectionId,
            sessionId: session.id,
            agentId: input.agentId,
            authorityLevel: run.requiredAuthority,
            brokerEvidenceId: input.brokerEvidence.evidenceId,
            brokerEvidenceHash: input.brokerEvidence.evidenceHash,
            assignmentEvidenceId,
            assignmentEvidenceHash,
            dispatchEnvelopeHash,
            idempotencyKey: input.idempotencyKey,
          },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'run.progress',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpBridgeDispatch',
            subjectId: dispatch.id,
            occurredAt: now.toISOString(),
            idempotencyKey: `bridge-dispatch:${input.idempotencyKey}`,
            correlationId: run.id,
            facts: { payloadFieldCount: 0, payloadBytes: 0 },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return { dispatch, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Prepares one authenticated parent-to-runtime DISPATCH envelope and stores
   * only immutable correlation/digest metadata. It does not write a raw line,
   * enqueue transport work, claim delivery, or promote runtime status.
   */
  async prepareDispatchAuthorization(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: PrepareBridgeDispatchAuthorizationInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    for (const [field, value] of Object.entries(input)) reference(value, field);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const dispatchReference = await tx.acpBridgeDispatch.findUnique({
              where: { workspaceId_id: { workspaceId: context.workspaceId, id: input.dispatchId } },
              select: { sessionId: true, connectionId: true, runId: true, taskId: true },
            });
            if (!dispatchReference)
              throw new AcpBridgeAdmissionNotFoundError('Bridge dispatch not found');

            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${dispatchReference.sessionId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${dispatchReference.connectionId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${input.dispatchId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${dispatchReference.runId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${dispatchReference.taskId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT r."id" FROM "acp_runtimes" r JOIN "acp_runtime_connections" c ON c."workspaceId" = r."workspaceId" AND c."runtimeId" = r."id" WHERE c."workspaceId" = ${context.workspaceId}::uuid AND c."id" = ${dispatchReference.connectionId} FOR UPDATE OF r`,
            );

            const loadBoundState = () =>
              tx.acpBridgeDispatch.findUniqueOrThrow({
                where: {
                  workspaceId_id: { workspaceId: context.workspaceId, id: input.dispatchId },
                },
                include: {
                  run: { include: { task: true } },
                  session: true,
                  connection: { include: { runtime: true } },
                },
              });
            let dispatch = await loadBoundState();
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_broker_reservations" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${dispatch.brokerEvidenceId} FOR UPDATE`,
            );
            const reservation = await tx.acpBrokerReservation.findUniqueOrThrow({
              where: {
                workspaceId_id: {
                  workspaceId: context.workspaceId,
                  id: dispatch.brokerEvidenceId,
                },
              },
            });
            const existing = await tx.acpBridgeDispatchOutbox.findFirst({
              where: {
                workspaceId: context.workspaceId,
                OR: [{ idempotencyKey: input.idempotencyKey }, { dispatchId: input.dispatchId }],
              },
            });
            if (
              existing &&
              (existing.id !== input.capsuleId ||
                existing.dispatchId !== input.dispatchId ||
                existing.idempotencyKey !== input.idempotencyKey)
            ) {
              throw new AcpBridgeAdmissionConflictError(
                'Dispatch authorization idempotency replay drifted',
              );
            }

            await this.assertAdapterIsolation(
              context.workspaceId,
              dispatch.connection.runtime.adapterKind,
              dispatch.connection.environment,
            );
            const brokerEvidence = {
              evidenceId: dispatch.brokerEvidenceId,
              evidenceHash: dispatch.brokerEvidenceHash,
              workspaceId: dispatch.workspaceId,
              taskId: dispatch.taskId,
              runId: dispatch.runId,
              agentId: dispatch.agentId,
              runtimeId: dispatch.runtimeId,
              connectionId: dispatch.connectionId,
            };
            if (
              !(await this.brokerEvidence.verify(brokerEvidence)) ||
              !(await this.capabilityPolicy.verify(
                context.workspaceId,
                dispatch.runtimeId,
                dispatch.connection.runtime.capabilityPolicyHash,
                dispatch.connection.capabilityCodes,
              ))
            ) {
              throw new AcpBridgeAdmissionDeniedError(
                'Dispatch authorization evidence or policy was denied',
              );
            }

            let signingCompleted = false;
            const result = await this.withSecretLease(
              {
                workspaceId: context.workspaceId,
                runtimeId: dispatch.runtimeId,
                connectionId: dispatch.connectionId,
                secretReference: dispatch.connection.runtime.secretReference,
                expectedDigest: dispatch.connection.runtime.secretDigest,
                authGeneration: dispatch.connection.authGeneration,
                purpose: 'SIGN_FRAME',
              },
              async (secret) => {
                dispatch = await loadBoundState();
                await this.assertAdapterIsolation(
                  context.workspaceId,
                  dispatch.connection.runtime.adapterKind,
                  dispatch.connection.environment,
                );
                if (
                  !(await this.brokerEvidence.verify(brokerEvidence)) ||
                  !(await this.capabilityPolicy.verify(
                    context.workspaceId,
                    dispatch.runtimeId,
                    dispatch.connection.runtime.capabilityPolicyHash,
                    dispatch.connection.capabilityCodes,
                  ))
                ) {
                  throw new AcpBridgeAdmissionDeniedError(
                    'Dispatch authorization evidence or policy was denied',
                  );
                }
                const now = await databaseNow(tx);
                dispatch = await loadBoundState();
                const session = dispatch.session;
                const connection = dispatch.connection;
                const run = dispatch.run;
                const expectedDispatchEnvelopeHash = sha256({
                  schemaVersion: 1,
                  dispatchId: dispatch.id,
                  taskId: run.taskId,
                  runId: run.id,
                  runtimeId: session.runtimeId,
                  connectionId: session.connectionId,
                  sessionId: session.id,
                  authorityLevel: run.requiredAuthority,
                  policyHash: run.policyHash,
                });
                if (
                  dispatch.state !== 'PREPARED' ||
                  run.status !== 'PREPARED' ||
                  run.task.status !== 'READY' ||
                  run.requiredAuthority >= 4 ||
                  dispatch.authorityLevel !== run.requiredAuthority ||
                  dispatch.taskId !== run.taskId ||
                  dispatch.runtimeId !== session.runtimeId ||
                  dispatch.connectionId !== session.connectionId ||
                  connection.runtimeId !== session.runtimeId ||
                  session.state !== 'PARTIAL' ||
                  session.expiresAt <= now ||
                  !session.runtimeNonce ||
                  !session.authenticatedAt ||
                  !session.keyDigest ||
                  connection.status !== 'PARTIAL' ||
                  connection.lastHeartbeatHealth !== 'HEALTHY' ||
                  !connection.lastHeartbeatAt ||
                  connection.lastHeartbeatAt.getTime() < now.getTime() - 60_000 ||
                  !connection.capabilityDigest ||
                  connection.capabilityDigest !== sha256(connection.capabilityCodes) ||
                  dispatch.dispatchEnvelopeHash !== expectedDispatchEnvelopeHash
                ) {
                  throw new AcpBridgeAdmissionDeniedError(
                    'Dispatch authorization durable binding mismatch',
                  );
                }
                if (existing && existing.expiresAt <= now) {
                  throw new AcpBridgeAdmissionDeniedError(
                    'Prepared dispatch authorization expired',
                  );
                }
                if (
                  reservation.state !== 'CLAIMED' ||
                  reservation.claimedDispatchId !== dispatch.id
                ) {
                  throw new AcpBridgeAdmissionDeniedError(
                    'Dispatch authorization requires an active claimed reservation',
                  );
                }

                const keyContext = {
                  workspaceId: session.workspaceId,
                  runtimeId: session.runtimeId,
                  connectionId: session.connectionId,
                  sessionId: session.id,
                  principalReference: session.principalReference,
                  parentNonce: session.parentNonce,
                  runtimeNonce: session.runtimeNonce,
                };
                const keys = deriveBridgeKeys(secret, keyContext);
                try {
                  const derivedKeyDigest = createHash('sha256')
                    .update(keys.parentToRuntime)
                    .update(keys.runtimeToParent)
                    .digest('hex');
                  if (derivedKeyDigest !== session.keyDigest) {
                    throw new AcpBridgeAdmissionDeniedError(
                      'Dispatch authorization session key mismatch',
                    );
                  }
                  const outboundSequence =
                    existing?.outboundSequence ??
                    ((
                      await tx.acpBridgeDispatchOutbox.aggregate({
                        where: { workspaceId: context.workspaceId, sessionId: session.id },
                        _max: { outboundSequence: true },
                      })
                    )._max.outboundSequence ?? 0) + 1;
                  const payload = Object.freeze({
                    schemaVersion: 1,
                    dispatchId: dispatch.id,
                    taskId: dispatch.taskId,
                    runId: dispatch.runId,
                    agentId: dispatch.agentId,
                    authorityLevel: dispatch.authorityLevel,
                    brokerEvidenceId: dispatch.brokerEvidenceId,
                    brokerEvidenceHash: dispatch.brokerEvidenceHash,
                    assignmentEvidenceId: dispatch.assignmentEvidenceId,
                    assignmentEvidenceHash: dispatch.assignmentEvidenceHash,
                    dispatchEnvelopeHash: dispatch.dispatchEnvelopeHash,
                    policyHash: run.policyHash,
                    capabilityPolicyHash: connection.runtime.capabilityPolicyHash,
                    capabilityDigest: connection.capabilityDigest,
                  });
                  const issuedAt = existing?.issuedAt ?? now;
                  const expiresAt =
                    existing?.expiresAt ??
                    new Date(Math.min(session.expiresAt.getTime(), now.getTime() + 60_000));
                  if (expiresAt <= now) {
                    throw new AcpBridgeAdmissionDeniedError(
                      'Prepared dispatch authorization expired',
                    );
                  }
                  const unsigned = {
                    protocolVersion: BRIDGE_PROTOCOL_VERSION,
                    workspaceId: context.workspaceId,
                    runtimeId: dispatch.runtimeId,
                    connectionId: dispatch.connectionId,
                    sessionId: dispatch.sessionId,
                    principalReference: session.principalReference,
                    sequence: outboundSequence,
                    messageId: existing?.messageId ?? input.capsuleId,
                    type: 'DISPATCH' as const,
                    issuedAt: issuedAt.toISOString(),
                    expiresAt: expiresAt.toISOString(),
                    payloadDigest: digestBridgePayload(payload),
                    payload,
                  };
                  const frame = signBridgeEnvelope(unsigned, keys.parentToRuntime);
                  const unsignedEnvelopeDigest = sha256(unsigned);
                  const signedEnvelopeDigest = sha256(frame);
                  const authenticationTagDigest = createHash('sha256')
                    .update(frame.mac)
                    .digest('hex');
                  if (
                    existing &&
                    (existing.workspaceId !== context.workspaceId ||
                      existing.runtimeId !== dispatch.runtimeId ||
                      existing.connectionId !== dispatch.connectionId ||
                      existing.sessionId !== dispatch.sessionId ||
                      existing.dispatchId !== dispatch.id ||
                      existing.taskId !== dispatch.taskId ||
                      existing.runId !== dispatch.runId ||
                      existing.agentId !== dispatch.agentId ||
                      existing.authorityLevel !== dispatch.authorityLevel ||
                      existing.outboundSequence !== outboundSequence ||
                      existing.messageId !== input.capsuleId ||
                      existing.messageType !== 'DISPATCH' ||
                      existing.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
                      existing.state !== 'PREPARED' ||
                      existing.brokerEvidenceId !== dispatch.brokerEvidenceId ||
                      !exactDigestMatch(existing.brokerEvidenceHash, dispatch.brokerEvidenceHash) ||
                      existing.assignmentEvidenceId !== dispatch.assignmentEvidenceId ||
                      !exactDigestMatch(
                        existing.assignmentEvidenceHash,
                        dispatch.assignmentEvidenceHash,
                      ) ||
                      !exactDigestMatch(
                        existing.dispatchEnvelopeHash,
                        dispatch.dispatchEnvelopeHash,
                      ) ||
                      !exactDigestMatch(existing.policyHash, run.policyHash) ||
                      !exactDigestMatch(
                        existing.capabilityPolicyHash,
                        connection.runtime.capabilityPolicyHash,
                      ) ||
                      !exactDigestMatch(existing.capabilityDigest, connection.capabilityDigest) ||
                      !exactDigestMatch(existing.payloadDigest, unsigned.payloadDigest) ||
                      !exactDigestMatch(existing.unsignedEnvelopeDigest, unsignedEnvelopeDigest) ||
                      !exactDigestMatch(existing.signedEnvelopeDigest, signedEnvelopeDigest) ||
                      !exactDigestMatch(
                        existing.authenticationTagDigest,
                        authenticationTagDigest,
                      ) ||
                      existing.idempotencyKey !== input.idempotencyKey ||
                      existing.issuedAt.getTime() !== issuedAt.getTime() ||
                      existing.expiresAt.getTime() !== expiresAt.getTime() ||
                      existing.preparedAt.getTime() !== issuedAt.getTime())
                  ) {
                    throw new AcpBridgeAdmissionConflictError(
                      'Dispatch authorization durable replay drifted',
                    );
                  }
                  const outbox =
                    existing ??
                    (await tx.acpBridgeDispatchOutbox.create({
                      data: {
                        id: input.capsuleId,
                        workspaceId: context.workspaceId,
                        runtimeId: dispatch.runtimeId,
                        connectionId: dispatch.connectionId,
                        sessionId: dispatch.sessionId,
                        dispatchId: dispatch.id,
                        taskId: dispatch.taskId,
                        runId: dispatch.runId,
                        agentId: dispatch.agentId,
                        authorityLevel: dispatch.authorityLevel,
                        outboundSequence,
                        messageId: input.capsuleId,
                        messageType: 'DISPATCH',
                        protocolVersion: BRIDGE_PROTOCOL_VERSION,
                        state: 'PREPARED',
                        brokerEvidenceId: dispatch.brokerEvidenceId,
                        brokerEvidenceHash: dispatch.brokerEvidenceHash,
                        assignmentEvidenceId: dispatch.assignmentEvidenceId,
                        assignmentEvidenceHash: dispatch.assignmentEvidenceHash,
                        dispatchEnvelopeHash: dispatch.dispatchEnvelopeHash,
                        policyHash: run.policyHash,
                        capabilityPolicyHash: connection.runtime.capabilityPolicyHash,
                        capabilityDigest: connection.capabilityDigest,
                        payloadDigest: unsigned.payloadDigest,
                        unsignedEnvelopeDigest,
                        signedEnvelopeDigest,
                        authenticationTagDigest,
                        idempotencyKey: input.idempotencyKey,
                        issuedAt,
                        expiresAt,
                        preparedAt: issuedAt,
                      },
                    }));
                  if (!existing) {
                    await this.auditService.recordOperationalEvent(
                      capability,
                      context,
                      {
                        id: randomUUID(),
                        workspaceId: context.workspaceId,
                        type: 'run.progress',
                        source: 'CONTROL_PLANE',
                        actorKind,
                        actorId: context.principalId,
                        subjectType: 'AcpBridgeDispatchOutbox',
                        subjectId: outbox.id,
                        occurredAt: issuedAt.toISOString(),
                        idempotencyKey: `bridge-dispatch-outbox:${input.idempotencyKey}`,
                        correlationId: dispatch.runId,
                        facts: { payloadFieldCount: 0, payloadBytes: 0 },
                      },
                      actorKind === 'HUMAN' ? context.principalId : undefined,
                      tx,
                    );
                  }
                  signingCompleted = true;
                  return Object.freeze({
                    outbox,
                    frame: Object.freeze({ ...frame, payload }),
                    replayed: Boolean(existing),
                  });
                } finally {
                  keys.parentToRuntime.fill(0);
                  keys.runtimeToParent.fill(0);
                }
              },
            );
            if (!signingCompleted || !result) {
              throw new AcpBridgeAdmissionDeniedError('Dispatch authorization signing was denied');
            }
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002')
        ) {
          if (attempt < 2) continue;
          throw new AcpBridgeAdmissionConflictError(
            'Concurrent dispatch authorization conflict; retry with current durable state',
          );
        }
        throw error;
      }
    }
    throw new AcpBridgeAdmissionConflictError('Dispatch authorization retry budget exhausted');
  }

  /**
   * Claims a short, exclusive opportunity to hand one already-prepared frame
   * to an injected egress boundary. The returned frame is ephemeral. This
   * method does not send, enqueue, acknowledge, or change any runtime state.
   */
  async claimDispatchEgressHandoff(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ClaimBridgeEgressHandoffInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    const ownerReference = context.principalId;
    auditSubjectReference(input.attemptId, 'attemptId');
    publicReference(input.outboxId, 'outboxId');
    capabilityOwnerReference(ownerReference);
    publicReference(input.idempotencyKey, 'idempotencyKey');

    for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const referenceRow = await tx.acpBridgeDispatchOutbox.findUnique({
              where: {
                workspaceId_id: { workspaceId: context.workspaceId, id: input.outboxId },
              },
              select: {
                sessionId: true,
                connectionId: true,
                dispatchId: true,
                runId: true,
                taskId: true,
                runtimeId: true,
                brokerEvidenceId: true,
              },
            });
            if (!referenceRow)
              throw new AcpBridgeAdmissionNotFoundError('Egress handoff not found');

            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${referenceRow.sessionId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${referenceRow.connectionId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${referenceRow.dispatchId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${referenceRow.runId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${referenceRow.taskId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runtimes" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${referenceRow.runtimeId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_broker_reservations" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${referenceRow.brokerEvidenceId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_dispatch_outbox" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${input.outboxId} FOR UPDATE`,
            );

            const loadState = () =>
              tx.acpBridgeDispatchOutbox.findUniqueOrThrow({
                where: {
                  workspaceId_id: { workspaceId: context.workspaceId, id: input.outboxId },
                },
                include: {
                  session: true,
                  connection: { include: { runtime: true } },
                  dispatch: { include: { run: { include: { task: true } } } },
                },
              });
            let outbox = await loadState();
            let reservation = await tx.acpBrokerReservation.findUniqueOrThrow({
              where: {
                workspaceId_id: {
                  workspaceId: context.workspaceId,
                  id: outbox.brokerEvidenceId,
                },
              },
            });
            const existing = await tx.acpBridgeEgressHandoffAttempt.findFirst({
              where: {
                workspaceId: context.workspaceId,
                OR: [{ id: input.attemptId }, { claimIdempotencyKey: input.idempotencyKey }],
              },
              include: { release: true },
            });
            if (
              existing &&
              (existing.id !== input.attemptId ||
                existing.outboxId !== input.outboxId ||
                existing.ownerReference !== ownerReference ||
                existing.ownerActorKind !== actorKind ||
                existing.claimIdempotencyKey !== input.idempotencyKey)
            ) {
              throw new AcpBridgeAdmissionConflictError('Egress handoff replay drifted');
            }
            const preflightNow = await databaseNow(tx);
            const preflightActive = await tx.acpBridgeEgressHandoffAttempt.findFirst({
              where: {
                workspaceId: context.workspaceId,
                outboxId: outbox.id,
                expiresAt: { gt: preflightNow },
                release: { is: null },
              },
              orderBy: { generation: 'desc' },
            });
            if (preflightActive && preflightActive.id !== existing?.id) {
              throw new AcpBridgeAdmissionConflictError(
                'Egress handoff is already exclusively claimed',
              );
            }
            if (existing && (existing.expiresAt <= preflightNow || existing.release)) {
              throw new AcpBridgeAdmissionDeniedError('Egress handoff replay is no longer live');
            }

            const brokerSnapshot = {
              evidenceId: outbox.brokerEvidenceId,
              evidenceHash: outbox.brokerEvidenceHash,
              workspaceId: outbox.workspaceId,
              taskId: outbox.taskId,
              runId: outbox.runId,
              agentId: outbox.agentId,
              runtimeId: outbox.runtimeId,
              connectionId: outbox.connectionId,
            };
            await this.assertAdapterIsolation(
              context.workspaceId,
              outbox.connection.runtime.adapterKind,
              outbox.connection.environment,
            );
            if (
              !(await this.brokerEvidence.verify(brokerSnapshot)) ||
              !(await this.capabilityPolicy.verify(
                context.workspaceId,
                outbox.runtimeId,
                outbox.connection.runtime.capabilityPolicyHash,
                outbox.connection.capabilityCodes,
              ))
            ) {
              throw new AcpBridgeAdmissionDeniedError('Egress handoff evidence was denied');
            }

            let handoffCompleted = false;
            const result = await this.withSecretLease(
              {
                workspaceId: context.workspaceId,
                runtimeId: outbox.runtimeId,
                connectionId: outbox.connectionId,
                secretReference: outbox.connection.runtime.secretReference,
                expectedDigest: outbox.connection.runtime.secretDigest,
                authGeneration: outbox.connection.authGeneration,
                purpose: 'SIGN_FRAME',
              },
              async (secret) => {
                outbox = await loadState();
                reservation = await tx.acpBrokerReservation.findUniqueOrThrow({
                  where: {
                    workspaceId_id: {
                      workspaceId: context.workspaceId,
                      id: outbox.brokerEvidenceId,
                    },
                  },
                });
                await this.assertAdapterIsolation(
                  context.workspaceId,
                  outbox.connection.runtime.adapterKind,
                  outbox.connection.environment,
                );
                if (
                  !(await this.brokerEvidence.verify(brokerSnapshot)) ||
                  !(await this.capabilityPolicy.verify(
                    context.workspaceId,
                    outbox.runtimeId,
                    outbox.connection.runtime.capabilityPolicyHash,
                    outbox.connection.capabilityCodes,
                  ))
                ) {
                  throw new AcpBridgeAdmissionDeniedError('Egress handoff evidence was denied');
                }

                const now = await databaseNow(tx);
                outbox = await loadState();
                reservation = await tx.acpBrokerReservation.findUniqueOrThrow({
                  where: {
                    workspaceId_id: {
                      workspaceId: context.workspaceId,
                      id: outbox.brokerEvidenceId,
                    },
                  },
                });
                const session = outbox.session;
                const connection = outbox.connection;
                const dispatch = outbox.dispatch;
                const run = dispatch.run;
                if (
                  outbox.state !== 'PREPARED' ||
                  outbox.expiresAt <= now ||
                  session.state !== 'PARTIAL' ||
                  session.expiresAt <= now ||
                  !session.runtimeNonce ||
                  !session.authenticatedAt ||
                  !session.keyDigest ||
                  connection.status !== 'PARTIAL' ||
                  connection.lastHeartbeatHealth !== 'HEALTHY' ||
                  !connection.lastHeartbeatAt ||
                  connection.lastHeartbeatAt.getTime() < now.getTime() - 60_000 ||
                  !connection.capabilityDigest ||
                  connection.capabilityDigest !== sha256(connection.capabilityCodes) ||
                  dispatch.state !== 'PREPARED' ||
                  run.status !== 'PREPARED' ||
                  run.task.status !== 'READY' ||
                  run.requiredAuthority >= 4 ||
                  run.requiredAuthority !== outbox.authorityLevel ||
                  reservation.state !== 'CLAIMED' ||
                  reservation.claimedDispatchId !== dispatch.id
                ) {
                  throw new AcpBridgeAdmissionDeniedError(
                    'Egress handoff durable authority is not live',
                  );
                }

                const active = await tx.acpBridgeEgressHandoffAttempt.findFirst({
                  where: {
                    workspaceId: context.workspaceId,
                    outboxId: outbox.id,
                    expiresAt: { gt: now },
                    release: { is: null },
                  },
                  orderBy: { generation: 'desc' },
                });
                if (active && active.id !== existing?.id) {
                  throw new AcpBridgeAdmissionConflictError(
                    'Egress handoff is already exclusively claimed',
                  );
                }
                if (existing && existing.expiresAt <= now) {
                  throw new AcpBridgeAdmissionDeniedError('Egress handoff replay expired');
                }

                const keyContext = {
                  workspaceId: session.workspaceId,
                  runtimeId: session.runtimeId,
                  connectionId: session.connectionId,
                  sessionId: session.id,
                  principalReference: session.principalReference,
                  parentNonce: session.parentNonce,
                  runtimeNonce: session.runtimeNonce,
                };
                const keys = deriveBridgeKeys(secret, keyContext);
                try {
                  const keyDigest = createHash('sha256')
                    .update(keys.parentToRuntime)
                    .update(keys.runtimeToParent)
                    .digest('hex');
                  if (!exactDigestMatch(keyDigest, session.keyDigest)) {
                    throw new AcpBridgeAdmissionDeniedError('Egress handoff session key mismatch');
                  }
                  const payload = Object.freeze({
                    schemaVersion: 1,
                    dispatchId: dispatch.id,
                    taskId: dispatch.taskId,
                    runId: dispatch.runId,
                    agentId: dispatch.agentId,
                    authorityLevel: dispatch.authorityLevel,
                    brokerEvidenceId: dispatch.brokerEvidenceId,
                    brokerEvidenceHash: dispatch.brokerEvidenceHash,
                    assignmentEvidenceId: dispatch.assignmentEvidenceId,
                    assignmentEvidenceHash: dispatch.assignmentEvidenceHash,
                    dispatchEnvelopeHash: dispatch.dispatchEnvelopeHash,
                    policyHash: run.policyHash,
                    capabilityPolicyHash: connection.runtime.capabilityPolicyHash,
                    capabilityDigest: connection.capabilityDigest,
                  });
                  const unsigned = {
                    protocolVersion: BRIDGE_PROTOCOL_VERSION,
                    workspaceId: context.workspaceId,
                    runtimeId: outbox.runtimeId,
                    connectionId: outbox.connectionId,
                    sessionId: outbox.sessionId,
                    principalReference: session.principalReference,
                    sequence: outbox.outboundSequence,
                    messageId: outbox.messageId,
                    type: 'DISPATCH' as const,
                    issuedAt: outbox.issuedAt.toISOString(),
                    expiresAt: outbox.expiresAt.toISOString(),
                    payloadDigest: digestBridgePayload(payload),
                    payload,
                  };
                  const frame = signBridgeEnvelope(unsigned, keys.parentToRuntime);
                  const unsignedDigest = sha256(unsigned);
                  const signedDigest = sha256(frame);
                  const tagDigest = createHash('sha256').update(frame.mac).digest('hex');
                  const expectedEnvelopeHash = sha256({
                    schemaVersion: 1,
                    dispatchId: dispatch.id,
                    taskId: run.taskId,
                    runId: run.id,
                    runtimeId: session.runtimeId,
                    connectionId: session.connectionId,
                    sessionId: session.id,
                    authorityLevel: run.requiredAuthority,
                    policyHash: run.policyHash,
                  });
                  if (
                    outbox.workspaceId !== context.workspaceId ||
                    outbox.runtimeId !== dispatch.runtimeId ||
                    outbox.connectionId !== dispatch.connectionId ||
                    outbox.sessionId !== dispatch.sessionId ||
                    outbox.dispatchId !== dispatch.id ||
                    outbox.taskId !== dispatch.taskId ||
                    outbox.runId !== dispatch.runId ||
                    outbox.agentId !== dispatch.agentId ||
                    outbox.authorityLevel !== dispatch.authorityLevel ||
                    outbox.messageId !== outbox.id ||
                    outbox.messageType !== 'DISPATCH' ||
                    outbox.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
                    outbox.preparedAt.getTime() !== outbox.issuedAt.getTime() ||
                    outbox.expiresAt.getTime() > outbox.issuedAt.getTime() + 60_000 ||
                    outbox.brokerEvidenceId !== dispatch.brokerEvidenceId ||
                    !exactDigestMatch(outbox.brokerEvidenceHash, dispatch.brokerEvidenceHash) ||
                    outbox.assignmentEvidenceId !== dispatch.assignmentEvidenceId ||
                    !exactDigestMatch(
                      outbox.assignmentEvidenceHash,
                      dispatch.assignmentEvidenceHash,
                    ) ||
                    !exactDigestMatch(outbox.dispatchEnvelopeHash, expectedEnvelopeHash) ||
                    !exactDigestMatch(outbox.policyHash, run.policyHash) ||
                    !exactDigestMatch(
                      outbox.capabilityPolicyHash,
                      connection.runtime.capabilityPolicyHash,
                    ) ||
                    !connection.capabilityDigest ||
                    !exactDigestMatch(outbox.capabilityDigest, connection.capabilityDigest) ||
                    !exactDigestMatch(outbox.payloadDigest, unsigned.payloadDigest) ||
                    !exactDigestMatch(outbox.unsignedEnvelopeDigest, unsignedDigest) ||
                    !exactDigestMatch(outbox.signedEnvelopeDigest, signedDigest) ||
                    !exactDigestMatch(outbox.authenticationTagDigest, tagDigest)
                  ) {
                    throw new AcpBridgeAdmissionConflictError('Egress handoff outbox drifted');
                  }

                  const claimedAt = existing?.claimedAt ?? now;
                  const expiresAt =
                    existing?.expiresAt ??
                    new Date(
                      Math.min(
                        outbox.expiresAt.getTime(),
                        session.expiresAt.getTime(),
                        now.getTime() + 15_000,
                      ),
                    );
                  if (expiresAt <= now) {
                    throw new AcpBridgeAdmissionDeniedError('Egress handoff authority expired');
                  }
                  const generation =
                    existing?.generation ??
                    ((
                      await tx.acpBridgeEgressHandoffAttempt.aggregate({
                        where: { workspaceId: context.workspaceId, outboxId: outbox.id },
                        _max: { generation: true },
                      })
                    )._max.generation ?? 0) + 1;
                  const attemptData = {
                    id: input.attemptId,
                    workspaceId: context.workspaceId,
                    outboxId: outbox.id,
                    ownerReference,
                    ownerActorKind: actorKind,
                    claimIdempotencyKey: input.idempotencyKey,
                    generation,
                    runtimeId: outbox.runtimeId,
                    connectionId: outbox.connectionId,
                    sessionId: outbox.sessionId,
                    dispatchId: outbox.dispatchId,
                    taskId: outbox.taskId,
                    runId: outbox.runId,
                    agentId: outbox.agentId,
                    authorityLevel: outbox.authorityLevel,
                    outboundSequence: outbox.outboundSequence,
                    messageId: outbox.messageId,
                    messageType: outbox.messageType,
                    protocolVersion: outbox.protocolVersion,
                    outboxState: outbox.state,
                    brokerEvidenceId: outbox.brokerEvidenceId,
                    brokerEvidenceHash: outbox.brokerEvidenceHash,
                    assignmentEvidenceId: outbox.assignmentEvidenceId,
                    assignmentEvidenceHash: outbox.assignmentEvidenceHash,
                    dispatchEnvelopeHash: outbox.dispatchEnvelopeHash,
                    policyHash: outbox.policyHash,
                    capabilityPolicyHash: outbox.capabilityPolicyHash,
                    capabilityDigest: outbox.capabilityDigest,
                    payloadDigest: outbox.payloadDigest,
                    unsignedEnvelopeDigest: outbox.unsignedEnvelopeDigest,
                    signedEnvelopeDigest: outbox.signedEnvelopeDigest,
                    authenticationTagDigest: outbox.authenticationTagDigest,
                    outboxIdempotencyKey: outbox.idempotencyKey,
                    outboxIssuedAt: outbox.issuedAt,
                    outboxExpiresAt: outbox.expiresAt,
                    outboxPreparedAt: outbox.preparedAt,
                    claimedAt,
                    expiresAt,
                  };
                  if (
                    existing &&
                    (existing.id !== attemptData.id ||
                      existing.workspaceId !== attemptData.workspaceId ||
                      existing.outboxId !== attemptData.outboxId ||
                      existing.ownerReference !== attemptData.ownerReference ||
                      existing.ownerActorKind !== attemptData.ownerActorKind ||
                      existing.claimIdempotencyKey !== attemptData.claimIdempotencyKey ||
                      existing.generation !== attemptData.generation ||
                      existing.runtimeId !== attemptData.runtimeId ||
                      existing.connectionId !== attemptData.connectionId ||
                      existing.sessionId !== attemptData.sessionId ||
                      existing.dispatchId !== attemptData.dispatchId ||
                      existing.taskId !== attemptData.taskId ||
                      existing.runId !== attemptData.runId ||
                      existing.agentId !== attemptData.agentId ||
                      existing.authorityLevel !== attemptData.authorityLevel ||
                      existing.outboundSequence !== attemptData.outboundSequence ||
                      existing.messageId !== attemptData.messageId ||
                      existing.messageType !== attemptData.messageType ||
                      existing.protocolVersion !== attemptData.protocolVersion ||
                      existing.outboxState !== attemptData.outboxState ||
                      existing.brokerEvidenceId !== attemptData.brokerEvidenceId ||
                      !exactDigestMatch(
                        existing.brokerEvidenceHash,
                        attemptData.brokerEvidenceHash,
                      ) ||
                      existing.assignmentEvidenceId !== attemptData.assignmentEvidenceId ||
                      !exactDigestMatch(
                        existing.assignmentEvidenceHash,
                        attemptData.assignmentEvidenceHash,
                      ) ||
                      !exactDigestMatch(
                        existing.dispatchEnvelopeHash,
                        attemptData.dispatchEnvelopeHash,
                      ) ||
                      !exactDigestMatch(existing.policyHash, attemptData.policyHash) ||
                      !exactDigestMatch(
                        existing.capabilityPolicyHash,
                        attemptData.capabilityPolicyHash,
                      ) ||
                      !exactDigestMatch(existing.capabilityDigest, attemptData.capabilityDigest) ||
                      !exactDigestMatch(existing.payloadDigest, attemptData.payloadDigest) ||
                      !exactDigestMatch(
                        existing.unsignedEnvelopeDigest,
                        attemptData.unsignedEnvelopeDigest,
                      ) ||
                      !exactDigestMatch(
                        existing.signedEnvelopeDigest,
                        attemptData.signedEnvelopeDigest,
                      ) ||
                      !exactDigestMatch(
                        existing.authenticationTagDigest,
                        attemptData.authenticationTagDigest,
                      ) ||
                      existing.outboxIdempotencyKey !== attemptData.outboxIdempotencyKey ||
                      existing.outboxIssuedAt.getTime() !== attemptData.outboxIssuedAt.getTime() ||
                      existing.outboxExpiresAt.getTime() !==
                        attemptData.outboxExpiresAt.getTime() ||
                      existing.outboxPreparedAt.getTime() !==
                        attemptData.outboxPreparedAt.getTime() ||
                      existing.claimedAt.getTime() !== attemptData.claimedAt.getTime() ||
                      existing.expiresAt.getTime() !== attemptData.expiresAt.getTime())
                  ) {
                    throw new AcpBridgeAdmissionConflictError(
                      'Egress handoff durable replay drifted',
                    );
                  }
                  const attempt =
                    existing ??
                    (await tx.acpBridgeEgressHandoffAttempt.create({ data: attemptData }));
                  if (!existing) {
                    await this.auditService.recordOperationalEvent(
                      capability,
                      context,
                      {
                        id: randomUUID(),
                        workspaceId: context.workspaceId,
                        type: 'run.progress',
                        source: 'CONTROL_PLANE',
                        actorKind,
                        actorId: context.principalId,
                        subjectType: 'AcpBridgeEgressHandoffAttempt',
                        subjectId: attempt.id,
                        occurredAt: claimedAt.toISOString(),
                        idempotencyKey: egressAuditIdempotencyKey('claim', {
                          workspaceId: context.workspaceId,
                          attemptId: attempt.id,
                          outboxId: attempt.outboxId,
                          ownerReference: attempt.ownerReference,
                          ownerActorKind: attempt.ownerActorKind,
                          claimIdempotencyKey: attempt.claimIdempotencyKey,
                        }),
                        correlationId: outbox.runId,
                        facts: { payloadFieldCount: 0, payloadBytes: 0 },
                      },
                      actorKind === 'HUMAN' ? context.principalId : undefined,
                      tx,
                    );
                  }
                  handoffCompleted = true;
                  return Object.freeze({
                    attempt,
                    frame: Object.freeze({ ...frame, payload }),
                    replayed: Boolean(existing),
                  });
                } finally {
                  keys.parentToRuntime.fill(0);
                  keys.runtimeToParent.fill(0);
                }
              },
            );
            if (!handoffCompleted || !result) {
              throw new AcpBridgeAdmissionDeniedError('Egress handoff signing was denied');
            }
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002')
        ) {
          if (transactionAttempt < 2) continue;
          throw new AcpBridgeAdmissionConflictError(
            'Concurrent egress handoff conflict; retry with current durable state',
          );
        }
        throw error;
      }
    }
    throw new AcpBridgeAdmissionConflictError('Egress handoff retry budget exhausted');
  }

  /** Records an immutable early release. Natural expiry is already durable. */
  async releaseDispatchEgressHandoff(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ReleaseBridgeEgressHandoffInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    const ownerReference = context.principalId;
    auditSubjectReference(input.releaseId, 'releaseId');
    auditSubjectReference(input.attemptId, 'attemptId');
    capabilityOwnerReference(ownerReference);
    publicReference(input.idempotencyKey, 'idempotencyKey');

    for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const attemptReference = await tx.acpBridgeEgressHandoffAttempt.findUnique({
              where: {
                workspaceId_id: { workspaceId: context.workspaceId, id: input.attemptId },
              },
            });
            if (!attemptReference)
              throw new AcpBridgeAdmissionNotFoundError('Egress handoff attempt not found');
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_sessions" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${attemptReference.sessionId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${attemptReference.connectionId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${attemptReference.dispatchId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${attemptReference.runId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${attemptReference.taskId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runtimes" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${attemptReference.runtimeId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_broker_reservations" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${attemptReference.brokerEvidenceId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_dispatch_outbox" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${attemptReference.outboxId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_bridge_egress_handoff_attempts" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${input.attemptId} FOR UPDATE`,
            );

            const attempt = await tx.acpBridgeEgressHandoffAttempt.findUniqueOrThrow({
              where: {
                workspaceId_id: { workspaceId: context.workspaceId, id: input.attemptId },
              },
            });
            const existing = await tx.acpBridgeEgressHandoffRelease.findFirst({
              where: {
                workspaceId: context.workspaceId,
                OR: [
                  { attemptId: input.attemptId },
                  { releaseIdempotencyKey: input.idempotencyKey },
                ],
              },
            });
            if (
              attempt.ownerReference !== ownerReference ||
              attempt.ownerActorKind !== actorKind ||
              (existing &&
                (existing.id !== input.releaseId ||
                  existing.attemptId !== input.attemptId ||
                  existing.ownerReference !== ownerReference ||
                  existing.ownerActorKind !== actorKind ||
                  existing.releaseIdempotencyKey !== input.idempotencyKey))
            ) {
              throw new AcpBridgeAdmissionConflictError('Egress handoff release drifted');
            }
            const now = await databaseNow(tx);
            if (!existing && attempt.expiresAt <= now) {
              throw new AcpBridgeAdmissionDeniedError('Expired egress handoff cannot be released');
            }
            const release =
              existing ??
              (await tx.acpBridgeEgressHandoffRelease.create({
                data: {
                  id: input.releaseId,
                  workspaceId: context.workspaceId,
                  attemptId: attempt.id,
                  outboxId: attempt.outboxId,
                  ownerReference: attempt.ownerReference,
                  ownerActorKind: attempt.ownerActorKind,
                  generation: attempt.generation,
                  releaseIdempotencyKey: input.idempotencyKey,
                  releasedAt: now,
                },
              }));
            if (!existing) {
              await this.auditService.recordOperationalEvent(
                capability,
                context,
                {
                  id: randomUUID(),
                  workspaceId: context.workspaceId,
                  type: 'run.progress',
                  source: 'CONTROL_PLANE',
                  actorKind,
                  actorId: context.principalId,
                  subjectType: 'AcpBridgeEgressHandoffRelease',
                  subjectId: release.id,
                  occurredAt: release.releasedAt.toISOString(),
                  idempotencyKey: egressAuditIdempotencyKey('release', {
                    workspaceId: context.workspaceId,
                    releaseId: release.id,
                    attemptId: release.attemptId,
                    outboxId: release.outboxId,
                    ownerReference: release.ownerReference,
                    ownerActorKind: release.ownerActorKind,
                    releaseIdempotencyKey: release.releaseIdempotencyKey,
                  }),
                  correlationId: attempt.runId,
                  facts: { payloadFieldCount: 0, payloadBytes: 0 },
                },
                actorKind === 'HUMAN' ? context.principalId : undefined,
                tx,
              );
            }
            return Object.freeze({ release, replayed: Boolean(existing) });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002')
        ) {
          if (transactionAttempt < 2) continue;
          throw new AcpBridgeAdmissionConflictError(
            'Concurrent egress release conflict; retry with current durable state',
          );
        }
        throw error;
      }
    }
    throw new AcpBridgeAdmissionConflictError('Egress release retry budget exhausted');
  }

  async requestCancellation(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    dispatchId: string,
    idempotencyKey: string,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    reference(dispatchId, 'dispatchId');
    reference(idempotencyKey, 'idempotencyKey');
    return prisma.$transaction(
      async (tx) => {
        const eventKey = `bridge-cancel:${idempotencyKey}`;
        const replay = await tx.auditEvent.findUnique({
          where: {
            workspaceReference_source_idempotencyKey: {
              workspaceReference: context.workspaceId,
              source: 'CONTROL_PLANE',
              idempotencyKey: eventKey,
            },
          },
        });
        if (replay) {
          if (replay.entityId !== dispatchId)
            throw new AcpBridgeAdmissionConflictError('Cancellation idempotency replay drifted');
          return {
            dispatch: await tx.acpBridgeDispatch.findUniqueOrThrow({
              where: { workspaceId_id: { workspaceId: context.workspaceId, id: dispatchId } },
            }),
            replayed: true,
          };
        }
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${dispatchId} FOR UPDATE`,
        );
        const dispatch = await tx.acpBridgeDispatch.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: dispatchId } },
        });
        if (!dispatch) throw new AcpBridgeAdmissionNotFoundError('Bridge dispatch not found');
        if (dispatch.state !== 'ACCEPTED')
          throw new AcpBridgeAdmissionDeniedError(
            'Only an accepted active dispatch can be cancelled',
          );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${dispatch.runId} FOR UPDATE`,
        );
        let run = await tx.acpRun.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: dispatch.runId } },
          include: { task: true },
        });
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${run.taskId} FOR UPDATE`,
        );
        run = await tx.acpRun.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: dispatch.runId } },
          include: { task: true },
        });
        if (
          run.status !== 'RUNNING' ||
          run.task.status !== 'RUNNING' ||
          run.assignedAgentId !== dispatch.agentId ||
          run.assignedRuntimeId !== dispatch.runtimeId ||
          run.assignedConnectionId !== dispatch.connectionId ||
          run.assignmentEvidenceId !== dispatch.assignmentEvidenceId ||
          run.assignmentEvidenceHash !== dispatch.assignmentEvidenceHash ||
          run.task.assignedAgentId !== dispatch.agentId ||
          run.task.assignedRuntimeId !== dispatch.runtimeId ||
          run.task.assignedConnectionId !== dispatch.connectionId
        ) {
          throw new AcpBridgeAdmissionDeniedError(
            'Cancellation requires the exact active durable assignment',
          );
        }
        const now = await databaseNow(tx);
        const updated = await tx.acpBridgeDispatch.update({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: dispatchId } },
          data: { state: 'CANCEL_REQUESTED' },
        });
        await this.auditService.recordOperationalEvent(
          capability,
          context,
          {
            id: randomUUID(),
            workspaceId: context.workspaceId,
            type: 'run.progress',
            source: 'CONTROL_PLANE',
            actorKind,
            actorId: context.principalId,
            subjectType: 'AcpBridgeDispatch',
            subjectId: dispatchId,
            occurredAt: now.toISOString(),
            idempotencyKey: eventKey,
            correlationId: dispatch.runId,
            facts: { payloadFieldCount: 0, payloadBytes: 0 },
          },
          actorKind === 'HUMAN' ? context.principalId : undefined,
          tx,
        );
        return { dispatch: updated, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async verify(
    workspaceId: string,
    evidence: TrustedAssignmentEvidence | TrustedArtifactEvidence,
  ): Promise<boolean> {
    if ('agentId' in evidence) {
      const dispatch = await prisma.acpBridgeDispatch.findFirst({
        where: {
          workspaceId,
          assignmentEvidenceId: evidence.evidenceId,
          assignmentEvidenceHash: evidence.evidenceHash,
          taskId: evidence.taskId,
          runId: evidence.runId,
          agentId: evidence.agentId,
          runtimeId: evidence.runtimeId,
          connectionId: evidence.connectionId,
        },
        include: { run: true, connection: { include: { runtime: true } } },
      });
      if (!dispatch) return false;
      try {
        await this.assertAdapterIsolation(
          workspaceId,
          dispatch.connection.runtime.adapterKind,
          dispatch.connection.environment,
        );
      } catch {
        return false;
      }
      if (dispatch.state === 'ACCEPTED' && dispatch.run.status === 'PREPARED') return true;
      return (
        dispatch.run.assignmentEvidenceId === evidence.evidenceId &&
        dispatch.run.assignmentEvidenceHash === evidence.evidenceHash &&
        dispatch.run.assignedAgentId === evidence.agentId &&
        dispatch.run.assignedRuntimeId === evidence.runtimeId &&
        dispatch.run.assignedConnectionId === evidence.connectionId
      );
    }
    const receipt = await prisma.acpBridgeReceipt.findFirst({
      where: {
        workspaceId,
        evidenceId: evidence.evidenceId,
        evidenceHash: evidence.evidenceHash,
        messageType: 'ARTIFACT',
        taskId: evidence.taskId,
        runId: evidence.runId,
        artifactId: evidence.artifactId,
        criterion: evidence.criterion,
        artifactKind: evidence.kind,
        uriReference: evidence.uriReference,
        contentHash: evidence.contentHash,
      },
      include: { session: { include: { connection: { include: { runtime: true } } } } },
    });
    if (!receipt) return false;
    try {
      await this.assertAdapterIsolation(
        workspaceId,
        receipt.session.connection.runtime.adapterKind,
        receipt.session.connection.environment,
      );
    } catch {
      return false;
    }
    return this.artifactContent.verify({
      workspaceId,
      taskId: evidence.taskId,
      runId: evidence.runId,
      artifactId: evidence.artifactId,
      uriReference: evidence.uriReference,
      contentHash: evidence.contentHash,
    });
  }

  private async createReceipt(tx: Prisma.TransactionClient, envelope: BridgeEnvelope) {
    const payload = envelope.payload;
    const optional = (key: string) =>
      typeof payload[key] === 'string' ? (payload[key] as string) : undefined;
    const receipt = await tx.acpBridgeReceipt.create({
      data: {
        id: randomUUID(),
        workspaceId: envelope.workspaceId,
        runtimeId: envelope.runtimeId,
        connectionId: envelope.connectionId,
        sessionId: envelope.sessionId,
        sequence: envelope.sequence,
        messageId: envelope.messageId,
        messageType: envelope.type,
        payloadDigest: envelope.payloadDigest,
        envelopeDigest: sha256(envelope),
        taskId: optional('taskId'),
        runId: optional('runId'),
        dispatchId: optional('dispatchId'),
        evidenceId: optional('evidenceId'),
        evidenceHash: optional('evidenceHash'),
        artifactId: optional('artifactId'),
        criterion: optional('criterion'),
        artifactKind: optional('kind'),
        uriReference: optional('uriReference'),
        contentHash: optional('contentHash'),
      },
    });
    if (envelope.type !== 'USAGE') return receipt;
    const [persisted] = await tx.$queryRaw<Array<{ receivedAtIso: string }>>(
      Prisma.sql`SELECT to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "receivedAtIso" FROM "acp_bridge_receipts" WHERE "workspaceId" = ${envelope.workspaceId}::uuid AND "id" = ${receipt.id}`,
    );
    if (!persisted) throw new AcpBridgeAdmissionDeniedError('Usage receipt clock unavailable');
    return { ...receipt, receivedAt: new Date(persisted.receivedAtIso) };
  }

  private async applyMessage(
    tx: Prisma.TransactionClient,
    session: {
      workspaceId: string;
      id: string;
      state: string;
      connectionId: string;
      runtimeId: string;
      expiresAt: Date;
      connection: {
        capabilityCodes: string[];
        status: string;
        lastHeartbeatAt: Date | null;
        lastHeartbeatHealth: string | null;
        version: number;
      };
    },
    envelope: BridgeEnvelope,
    receiptId: string,
    receiptReceivedAt: Date,
    now: Date,
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    actorKind: 'HUMAN' | 'AGENT' | 'SYSTEM',
  ): Promise<BridgeUsageAuditTotals | undefined> {
    const payload = envelope.payload;
    if (envelope.type === 'CAPABILITIES') {
      exactPayload(payload, ['capabilityCodes']);
      if (
        session.state !== 'AUTHENTICATED' ||
        !Array.isArray(payload.capabilityCodes) ||
        payload.capabilityCodes.length === 0 ||
        payload.capabilityCodes.length > 64 ||
        payload.capabilityCodes.some((code) => typeof code !== 'string' || !SAFE_CODE.test(code))
      )
        throw new AcpBridgeAdmissionDeniedError('Invalid capability exchange');
      const codes = [...new Set(payload.capabilityCodes as string[])].sort();
      if (codes.length !== payload.capabilityCodes.length)
        throw new AcpBridgeAdmissionDeniedError('Duplicate capabilities denied');
      const runtime = await tx.acpRuntime.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: session.runtimeId } },
      });
      if (
        !(await this.capabilityPolicy.verify(
          session.workspaceId,
          session.runtimeId,
          runtime.capabilityPolicyHash,
          codes,
        ))
      )
        throw new AcpBridgeAdmissionDeniedError('Capability policy rejected exchange');
      await tx.acpRuntimeConnection.update({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: session.connectionId } },
        data: {
          capabilityCodes: codes,
          capabilityDigest: sha256(codes),
          version: { increment: 1 },
        },
      });
      await tx.acpBridgeSession.update({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: session.id } },
        data: { state: 'CAPABILITIES_VERIFIED' },
      });
      return;
    }
    if (envelope.type === 'HEARTBEAT') {
      exactPayload(payload, ['health']);
      if (
        !['CAPABILITIES_VERIFIED', 'PARTIAL'].includes(session.state) ||
        (payload.health !== 'HEALTHY' && payload.health !== 'DEGRADED') ||
        new Date(envelope.issuedAt).getTime() < now.getTime() - 60_000
      )
        throw new AcpBridgeAdmissionDeniedError('Invalid heartbeat state or health');
      await tx.acpRuntimeConnection.update({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: session.connectionId } },
        data: {
          status: payload.health === 'HEALTHY' ? 'PARTIAL' : 'DEGRADED',
          lastHeartbeatAt: now,
          lastHeartbeatHealth: payload.health,
          lastHeartbeatSequence: envelope.sequence,
          version: { increment: 1 },
        },
      });
      if (session.state === 'CAPABILITIES_VERIFIED')
        await tx.acpBridgeSession.update({
          where: { workspaceId_id: { workspaceId: session.workspaceId, id: session.id } },
          data: { state: 'PARTIAL' },
        });
      return;
    }
    if (session.state !== 'PARTIAL')
      throw new AcpBridgeAdmissionDeniedError('Runtime facts require PARTIAL session evidence');
    if (envelope.type === 'DISPATCH_ACCEPTED') {
      exactPayload(payload, [
        'assignmentEvidenceHash',
        'dispatchId',
        'evidenceId',
        'runId',
        'taskId',
      ]);
      for (const field of ['dispatchId', 'evidenceId', 'runId', 'taskId'] as const)
        reference(payload[field], field);
      digest(payload.assignmentEvidenceHash, 'assignmentEvidenceHash');
      const acceptedDispatchId = payload.dispatchId;
      const assignmentEvidenceId = payload.evidenceId;
      reference(acceptedDispatchId, 'dispatchId');
      reference(assignmentEvidenceId, 'evidenceId');
      const dispatch = await tx.acpBridgeDispatch.findUnique({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: acceptedDispatchId } },
      });
      const run = dispatch
        ? await tx.acpRun.findUnique({
            where: {
              workspaceId_id: { workspaceId: session.workspaceId, id: dispatch.runId },
            },
            include: { task: true },
          })
        : null;
      const brokerEvidence = dispatch
        ? {
            evidenceId: dispatch.brokerEvidenceId,
            evidenceHash: dispatch.brokerEvidenceHash,
            workspaceId: dispatch.workspaceId,
            taskId: dispatch.taskId,
            runId: dispatch.runId,
            agentId: dispatch.agentId,
            runtimeId: dispatch.runtimeId,
            connectionId: dispatch.connectionId,
          }
        : null;
      if (
        !dispatch ||
        !run ||
        dispatch.state !== 'PREPARED' ||
        dispatch.sessionId !== session.id ||
        dispatch.runId !== payload.runId ||
        dispatch.taskId !== payload.taskId ||
        dispatch.assignmentEvidenceId !== assignmentEvidenceId ||
        dispatch.assignmentEvidenceHash !== payload.assignmentEvidenceHash ||
        run.status !== 'PREPARED' ||
        run.task.status !== 'READY' ||
        run.requiredAuthority >= 4 ||
        session.state !== 'PARTIAL' ||
        session.connection.status !== 'PARTIAL' ||
        session.connection.lastHeartbeatHealth !== 'HEALTHY' ||
        !session.connection.lastHeartbeatAt ||
        session.connection.lastHeartbeatAt.getTime() < now.getTime() - 60_000 ||
        !brokerEvidence ||
        dispatch.dispatchEnvelopeHash !==
          sha256({
            schemaVersion: 1,
            dispatchId: dispatch.id,
            taskId: run.taskId,
            runId: run.id,
            runtimeId: session.runtimeId,
            connectionId: session.connectionId,
            sessionId: session.id,
            authorityLevel: run.requiredAuthority,
            policyHash: run.policyHash,
          })
      )
        throw new AcpBridgeAdmissionDeniedError('Dispatch acceptance binding mismatch');
      const heartbeatIdentity = {
        at: session.connection.lastHeartbeatAt,
        health: session.connection.lastHeartbeatHealth,
        status: session.connection.status,
        version: session.connection.version,
      };
      if (!(await this.brokerEvidence.verify(brokerEvidence)))
        throw new AcpBridgeAdmissionDeniedError('Dispatch acceptance binding mismatch');
      const acceptanceNow = await databaseNow(tx);
      const currentConnection = await tx.acpRuntimeConnection.findUniqueOrThrow({
        where: {
          workspaceId_id: {
            workspaceId: session.workspaceId,
            id: session.connectionId,
          },
        },
      });
      if (
        session.expiresAt <= acceptanceNow ||
        new Date(envelope.expiresAt) <= acceptanceNow ||
        currentConnection.version !== heartbeatIdentity.version ||
        currentConnection.status !== heartbeatIdentity.status ||
        currentConnection.lastHeartbeatHealth !== heartbeatIdentity.health ||
        currentConnection.lastHeartbeatAt?.getTime() !== heartbeatIdentity.at.getTime() ||
        currentConnection.status !== 'PARTIAL' ||
        currentConnection.lastHeartbeatHealth !== 'HEALTHY' ||
        currentConnection.lastHeartbeatAt.getTime() < acceptanceNow.getTime() - 60_000
      )
        throw new AcpBridgeAdmissionDeniedError('Dispatch acceptance binding mismatch');
      await tx.acpBridgeDispatch.update({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: dispatch.id } },
        data: { state: 'ACCEPTED', acceptedAt: acceptanceNow },
      });
      return;
    }
    const dispatchId = payload.dispatchId;
    reference(dispatchId, 'dispatchId');
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${session.workspaceId}::uuid AND "id" = ${dispatchId} FOR UPDATE`,
    );
    const dispatch = await tx.acpBridgeDispatch.findUnique({
      where: { workspaceId_id: { workspaceId: session.workspaceId, id: dispatchId } },
    });
    if (!dispatch || dispatch.sessionId !== session.id)
      throw new AcpBridgeAdmissionDeniedError('Bound dispatch required');
    const acceptedWorkTypes = ['PROGRESS', 'ARTIFACT', 'USAGE', 'RESULT', 'FAILED'];
    if (acceptedWorkTypes.includes(envelope.type) && dispatch.state !== 'ACCEPTED') {
      throw new AcpBridgeAdmissionDeniedError(
        'Accepted dispatch required for runtime work evidence',
      );
    }
    if (envelope.type === 'CANCELLED' && dispatch.state !== 'CANCEL_REQUESTED') {
      throw new AcpBridgeAdmissionDeniedError('Cancellation was not requested');
    }
    if ([...acceptedWorkTypes, 'CANCELLED'].includes(envelope.type)) {
      const run = await tx.acpRun.findUnique({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: dispatch.runId } },
        include: { task: true },
      });
      if (
        !run ||
        run.status !== 'RUNNING' ||
        run.task.status !== 'RUNNING' ||
        run.assignedAgentId !== dispatch.agentId ||
        run.assignedRuntimeId !== dispatch.runtimeId ||
        run.assignedConnectionId !== dispatch.connectionId ||
        run.assignmentEvidenceId !== dispatch.assignmentEvidenceId ||
        run.assignmentEvidenceHash !== dispatch.assignmentEvidenceHash ||
        run.task.assignedAgentId !== dispatch.agentId ||
        run.task.assignedRuntimeId !== dispatch.runtimeId ||
        run.task.assignedConnectionId !== dispatch.connectionId
      ) {
        throw new AcpBridgeAdmissionDeniedError(
          'Runtime evidence requires the exact active durable assignment',
        );
      }
    }
    if (envelope.type === 'PROGRESS') {
      exactPayload(payload, ['dispatchId', 'progressCode']);
      reference(payload.progressCode, 'progressCode');
      return;
    }
    if (envelope.type === 'ARTIFACT') {
      exactPayload(payload, [
        'artifactId',
        'contentHash',
        'criterion',
        'dispatchId',
        'evidenceHash',
        'evidenceId',
        'kind',
        'runId',
        'taskId',
        'uriReference',
      ]);
      for (const field of [
        'artifactId',
        'criterion',
        'evidenceId',
        'kind',
        'runId',
        'taskId',
        'uriReference',
      ] as const)
        reference(payload[field], field);
      digest(payload.contentHash, 'contentHash');
      digest(payload.evidenceHash, 'evidenceHash');
      if (payload.runId !== dispatch.runId || payload.taskId !== dispatch.taskId)
        throw new AcpBridgeAdmissionDeniedError('Artifact correlation mismatch');
      if (
        !(await this.artifactContent.verify({
          workspaceId: session.workspaceId,
          taskId: payload.taskId,
          runId: payload.runId,
          artifactId: payload.artifactId as string,
          uriReference: payload.uriReference as string,
          contentHash: payload.contentHash,
        }))
      ) {
        throw new AcpBridgeAdmissionDeniedError(
          'Trusted artifact content evidence was not verified',
        );
      }
      return;
    }
    if (envelope.type === 'USAGE') {
      exactPayload(payload, [
        'computeUnits',
        'costMinorUnits',
        'currency',
        'dispatchId',
        'runId',
        'taskId',
      ]);
      validateUsageDelta(
        payload as { computeUnits: number; costMinorUnits: number; currency: string },
      );
      reference(payload.runId, 'runId');
      reference(payload.taskId, 'taskId');
      if (payload.runId !== dispatch.runId || payload.taskId !== dispatch.taskId)
        throw new AcpBridgeAdmissionDeniedError('Usage correlation mismatch');
      const previous = await tx.acpRunUsage.findFirst({
        where: { workspaceId: session.workspaceId, dispatchId },
        orderBy: { sequence: 'desc' },
      });
      const task = await tx.acpTask.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: dispatch.taskId } },
      });
      const compute = BigInt(payload.computeUnits as number);
      const cost = BigInt(payload.costMinorUnits as number);
      const cumulativeCompute = (previous?.cumulativeComputeUnits ?? 0n) + compute;
      const cumulativeCost = (previous?.cumulativeCostMinorUnits ?? 0n) + cost;
      if (
        payload.currency !== task.currency ||
        cumulativeCompute > task.maximumComputeUnits ||
        cumulativeCost > task.maximumCostMinorUnits
      )
        throw new AcpBridgeAdmissionDeniedError('Usage exceeds task budget or currency');
      await tx.acpRunUsage.create({
        data: {
          id: receiptId,
          workspaceId: session.workspaceId,
          dispatchId,
          runId: dispatch.runId,
          sessionId: session.id,
          receiptId,
          sequence: envelope.sequence,
          computeUnits: compute,
          costMinorUnits: cost,
          cumulativeComputeUnits: cumulativeCompute,
          cumulativeCostMinorUnits: cumulativeCost,
          currency: payload.currency as string,
          evidenceHash: envelope.payloadDigest,
          recordedAt: receiptReceivedAt,
        },
      });
      const governed = await this.costGovernance.recordUsage(capability, context, actorKind, tx, {
        usageId: receiptId,
        receiptId,
        dispatchId,
        sessionId: session.id,
        runId: dispatch.runId,
        taskId: dispatch.taskId,
        runtimeId: dispatch.runtimeId,
        connectionId: dispatch.connectionId,
        sequence: envelope.sequence,
        currency: payload.currency as string,
        costMinorUnits: cost,
        computeUnits: compute,
        taskPolicyVersion: task.policyVersion,
        taskLimitMinorUnits: task.maximumCostMinorUnits,
        taskComputeLimit: task.maximumComputeUnits,
      });
      return {
        taskCostUsedMinorUnits: Number(cumulativeCost),
        taskComputeUsed: Number(cumulativeCompute),
        taskCostLimitMinorUnits: Number(governed.taskLimitMinorUnits),
        workspaceCostUsedMinorUnits: Number(governed.workspaceSpendMinorUnits),
        workspaceCostLimitMinorUnits: Number(governed.workspaceLimitMinorUnits),
        workspacePolicyId: governed.workspacePolicyId,
        ledgerEntryId: governed.ledgerEntryId,
      };
    }
    if (envelope.type === 'CANCELLED' || envelope.type === 'RESULT' || envelope.type === 'FAILED') {
      exactPayload(payload, ['dispatchId', 'resultCode']);
      reference(payload.resultCode, 'resultCode');
      const next =
        envelope.type === 'CANCELLED'
          ? 'CANCELLED'
          : envelope.type === 'RESULT'
            ? 'COMPLETED'
            : 'FAILED';
      await tx.acpBridgeDispatch.update({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: dispatch.id } },
        data: { state: next, terminalAt: now },
      });
      return;
    }
    throw new AcpBridgeAdmissionDeniedError('Unsupported bridge message');
  }

  private async assertAdapterIsolation(
    workspaceId: string,
    adapterKind: string,
    environment: string,
  ): Promise<void> {
    if (adapterKind !== 'DETERMINISTIC_FAKE') return;
    if (
      environment !== 'TEST_ONLY' ||
      !(await this.testOnlyGate.allowsDeterministicFixture(workspaceId))
    ) {
      throw new AcpBridgeAdmissionDeniedError(
        'Deterministic fixture admission is restricted to an explicit test-only harness',
      );
    }
  }

  private async withSecretLease<T>(
    request: Readonly<BridgeSecretLeaseRequest>,
    consumer: (secret: Uint8Array) => Promise<T> | T,
  ): Promise<T> {
    try {
      return await this.secrets.withSecret(request, consumer);
    } catch (error) {
      if (error instanceof BridgeSecretLeaseError)
        throw new AcpBridgeAdmissionDeniedError(error.message);
      throw error;
    }
  }

  private auditForMessage(
    envelope: BridgeEnvelope,
    receiptId: string,
    now: Date,
    usageTotals?: BridgeUsageAuditTotals,
  ): Omit<OperationalEvent, 'id' | 'workspaceId' | 'source' | 'actorKind' | 'actorId'> {
    if (envelope.type === 'HEARTBEAT')
      return {
        type: 'runtime.heartbeat.recorded' as const,
        subjectType: 'AcpRuntimeConnection',
        subjectId: envelope.connectionId,
        occurredAt: now.toISOString(),
        idempotencyKey: `bridge-receipt:${receiptId}`,
        correlationId: envelope.sessionId,
        facts: {
          connectionId: envelope.connectionId,
          sequence: envelope.sequence,
          health: envelope.payload.health as string,
        },
      };
    if (envelope.type === 'CAPABILITIES')
      return {
        type: 'runtime.connection.updated' as const,
        subjectType: 'AcpRuntimeConnection',
        subjectId: envelope.connectionId,
        occurredAt: now.toISOString(),
        idempotencyKey: `bridge-receipt:${receiptId}`,
        correlationId: envelope.sessionId,
        facts: { status: 'NOT_CONFIGURED', runtimeId: envelope.runtimeId },
      };
    if (envelope.type === 'ARTIFACT')
      return {
        type: 'artifact.created' as const,
        subjectType: 'AcpBridgeReceipt',
        subjectId: receiptId,
        occurredAt: now.toISOString(),
        idempotencyKey: `bridge-receipt:${receiptId}`,
        correlationId: envelope.payload.runId as string,
        facts: {
          taskId: envelope.payload.taskId as string,
          runId: envelope.payload.runId as string,
          kind: envelope.payload.kind as string,
        },
      };
    if (envelope.type === 'USAGE') {
      if (!usageTotals)
        throw new AcpBridgeAdmissionDeniedError('Durable cumulative usage totals are required');
      return {
        type: 'usage.recorded' as const,
        subjectType: 'AcpRunUsage',
        subjectId: receiptId,
        occurredAt: now.toISOString(),
        idempotencyKey: `bridge-receipt:${receiptId}`,
        correlationId: envelope.payload.runId as string,
        facts: {
          taskId: envelope.payload.taskId as string,
          runId: envelope.payload.runId as string,
          computeUnits: envelope.payload.computeUnits as number,
          costMinorUnits: envelope.payload.costMinorUnits as number,
          currency: envelope.payload.currency as string,
          taskCostUsedMinorUnits: usageTotals.taskCostUsedMinorUnits,
          taskComputeUsed: usageTotals.taskComputeUsed,
        },
      };
    }
    return {
      type: 'run.progress' as const,
      subjectType: 'AcpBridgeReceipt',
      subjectId: receiptId,
      occurredAt: now.toISOString(),
      idempotencyKey: `bridge-receipt:${receiptId}`,
      correlationId: (envelope.payload.dispatchId as string | undefined) ?? envelope.sessionId,
      facts: {
        payloadFieldCount: Object.keys(envelope.payload).length,
        payloadBytes: Buffer.byteLength(JSON.stringify(envelope.payload), 'utf8'),
      },
    };
  }
}
