import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  assertBridgeSecretStrength,
  BRIDGE_BROKER_EVIDENCE_VERIFIER,
  BRIDGE_ARTIFACT_CONTENT_VERIFIER,
  BRIDGE_CAPABILITY_POLICY_VERIFIER,
  BRIDGE_SECRET_RESOLVER,
  BRIDGE_TEST_ONLY_GATE,
  BRIDGE_PROTOCOL_VERSION,
  canonicalJson,
  deriveBridgeKeys,
  digestSecretReference,
  validateBridgeEnvelope,
  validateUsageDelta,
  verifyBridgeEnvelope,
  type BridgeArtifactContentVerifier,
  type BridgeBrokerEvidenceVerifier,
  type BridgeCapabilityPolicyVerifier,
  type BridgeEnvelope,
  type BridgeSecretResolver,
  type BridgeTestOnlyGate,
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

export class AcpBridgeAdmissionError extends Error {}
export class AcpBridgeAdmissionDeniedError extends AcpBridgeAdmissionError {}
export class AcpBridgeAdmissionConflictError extends AcpBridgeAdmissionError {}
export class AcpBridgeAdmissionNotFoundError extends AcpBridgeAdmissionError {}

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_CODE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;

function exactPayload(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AcpBridgeAdmissionDeniedError('Bridge message payload does not match its schema');
  }
}

function reference(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') throw new AcpBridgeAdmissionDeniedError(`${field} is required`);
  validateAcpApprovalReference(value, field);
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

export interface PrepareBridgeDispatchInput {
  readonly dispatchId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly brokerEvidence: TrustedBridgeBrokerEvidence;
  readonly idempotencyKey: string;
}

interface BridgeUsageAuditTotals {
  readonly taskCostUsedMinorUnits: number;
  readonly taskComputeUsed: number;
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
    @Inject(BRIDGE_SECRET_RESOLVER) private readonly secrets: BridgeSecretResolver,
    @Inject(BRIDGE_BROKER_EVIDENCE_VERIFIER)
    private readonly brokerEvidence: BridgeBrokerEvidenceVerifier,
    @Inject(BRIDGE_CAPABILITY_POLICY_VERIFIER)
    private readonly capabilityPolicy: BridgeCapabilityPolicyVerifier,
    @Inject(BRIDGE_ARTIFACT_CONTENT_VERIFIER)
    private readonly artifactContent: BridgeArtifactContentVerifier,
    @Inject(BRIDGE_TEST_ONLY_GATE) private readonly testOnlyGate: BridgeTestOnlyGate,
  ) {}

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
    const secret = await this.secrets.resolve(input.secretReference);
    try {
      assertBridgeSecretStrength(secret);
    } catch {
      throw new AcpBridgeAdmissionDeniedError(
        'Bridge secret material does not meet the minimum strength',
      );
    }
    const secretDigest = digestSecretReference(secret);
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
        const secret = await this.secrets.resolve(lockedConnection.runtime.secretReference);
        if (digestSecretReference(secret) !== lockedConnection.runtime.secretDigest) {
          throw new AcpBridgeAdmissionDeniedError(
            'Resolved bridge secret does not match provisioning',
          );
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
        const keys = deriveBridgeKeys(secret, keyContext);
        verifyBridgeEnvelope(envelope, keys.runtimeToParent, keyContext, now);
        if (envelope.sequence !== 1)
          throw new AcpBridgeAdmissionConflictError('Authentication sequence mismatch');
        const receipt = await this.createReceipt(tx, envelope);
        const updated = await tx.acpBridgeSession.update({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: session.id } },
          data: {
            state: 'AUTHENTICATED',
            runtimeNonce,
            keyDigest: sha256({
              parentToRuntime: Buffer.from(keys.parentToRuntime).toString('hex'),
              runtimeToParent: Buffer.from(keys.runtimeToParent).toString('hex'),
            }),
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
    if (envelope.type === 'AUTHENTICATE' || envelope.type === 'CHALLENGE') {
      throw new AcpBridgeAdmissionDeniedError('Use the dedicated authentication boundary');
    }
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
        const claimedDispatchId =
          typeof envelope.payload.dispatchId === 'string' ? envelope.payload.dispatchId : undefined;
        if (claimedDispatchId) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_bridge_dispatches" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${claimedDispatchId} FOR UPDATE`,
          );
          const claimedDispatch = await tx.acpBridgeDispatch.findUnique({
            where: {
              workspaceId_id: { workspaceId: context.workspaceId, id: claimedDispatchId },
            },
          });
          if (claimedDispatch) {
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${claimedDispatch.runId} FOR UPDATE`,
            );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${claimedDispatch.taskId} FOR UPDATE`,
            );
          }
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
        const secret = await this.secrets.resolve(lockedConnection.runtime.secretReference);
        if (digestSecretReference(secret) !== lockedConnection.runtime.secretDigest)
          throw new AcpBridgeAdmissionDeniedError('Bridge secret drift');
        const keyContext = {
          workspaceId: session.workspaceId,
          runtimeId: session.runtimeId,
          connectionId: session.connectionId,
          sessionId: session.id,
          principalReference: session.principalReference,
          parentNonce: session.parentNonce,
          runtimeNonce: session.runtimeNonce,
        };
        verifyBridgeEnvelope(
          envelope,
          deriveBridgeKeys(secret, keyContext).runtimeToParent,
          keyContext,
          now,
        );
        if (envelope.sequence !== session.expectedSequence)
          throw new AcpBridgeAdmissionConflictError('Bridge sequence replay or gap');
        const receipt = await this.createReceipt(tx, envelope);
        const usageTotals = await this.applyMessage(
          tx,
          { ...session, connection: lockedConnection },
          envelope,
          receipt.id,
          now,
        );
        await tx.acpBridgeSession.update({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: session.id } },
          data: { expectedSequence: { increment: 1 } },
        });
        const audit = this.auditForMessage(envelope, receipt.id, now, usageTotals);
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
        return receipt;
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
        const session = await tx.acpBridgeSession.findUnique({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: input.sessionId } },
        });
        if (!session) throw new AcpBridgeAdmissionNotFoundError('Bound session not found');
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${session.connectionId} FOR UPDATE`,
        );
        const connection = await tx.acpRuntimeConnection.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: context.workspaceId, id: session.connectionId } },
          include: { runtime: true },
        });
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${input.brokerEvidence.runId} FOR UPDATE`,
        );
        const runReference = await tx.acpRun.findUnique({
          where: {
            workspaceId_id: { workspaceId: context.workspaceId, id: input.brokerEvidence.runId },
          },
        });
        if (!runReference) throw new AcpBridgeAdmissionNotFoundError('Bound run not found');
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId" = ${context.workspaceId}::uuid AND "id" = ${runReference.taskId} FOR UPDATE`,
        );
        const run = await tx.acpRun.findUniqueOrThrow({
          where: {
            workspaceId_id: { workspaceId: context.workspaceId, id: input.brokerEvidence.runId },
          },
          include: { task: true },
        });
        const now = await databaseNow(tx);
        await this.assertAdapterIsolation(
          context.workspaceId,
          connection.runtime.adapterKind,
          connection.environment,
        );
        if (!(await this.brokerEvidence.verify(input.brokerEvidence))) {
          throw new AcpBridgeAdmissionDeniedError('Broker evidence changed before dispatch claim');
        }
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
          input.brokerEvidence.runtimeId !== session.runtimeId ||
          input.brokerEvidence.connectionId !== session.connectionId
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
    return tx.acpBridgeReceipt.create({
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
  }

  private async applyMessage(
    tx: Prisma.TransactionClient,
    session: {
      workspaceId: string;
      id: string;
      state: string;
      connectionId: string;
      runtimeId: string;
      connection: {
        capabilityCodes: string[];
        status: string;
        lastHeartbeatAt: Date | null;
        lastHeartbeatHealth: string | null;
      };
    },
    envelope: BridgeEnvelope,
    receiptId: string,
    now: Date,
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
        (payload.health !== 'HEALTHY' && payload.health !== 'DEGRADED')
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
        !(await this.brokerEvidence.verify(brokerEvidence)) ||
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
      await tx.acpBridgeDispatch.update({
        where: { workspaceId_id: { workspaceId: session.workspaceId, id: dispatch.id } },
        data: { state: 'ACCEPTED', acceptedAt: now },
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
        },
      });
      return {
        taskCostUsedMinorUnits: Number(cumulativeCost),
        taskComputeUsed: Number(cumulativeCompute),
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
