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
  CODEX_CAPABILITY_EXCHANGE_AUTHORIZATION_SOURCE,
  CODEX_REGISTRATION_AUTHORIZATION_SOURCE,
  CODEX_VALIDATION_CHALLENGE,
  CODEX_VALIDATION_DISPATCH_AUTHORIZATION_SOURCE,
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
  codexCapabilityExchangeAuthorizationRequestHash,
  codexValidationDispatchAuthorizationRequestHash,
  codexValidationDispatchUnsignedEnvelope,
  createCodexCapabilityExchangeAuthorizationRequest,
  createCodexHeartbeatEvidenceCandidate,
  createCodexValidationCancellationCandidate,
  createCodexValidationProcessCleanupEvidence,
  createCodexValidationRoundTripCandidate,
  createCodexRegistrationAuthorizationRequest,
  createCodexValidationDispatchAuthorizationRequest,
  BoundedCodexValidationProcessSessionRecoveryCoordinator,
  DenyCodexValidationProcessSessionRecoveryEvidenceSource,
  DenyCodexCapabilityExchangeAuthorizationSource,
  DenyCodexRegistrationAuthorizationSource,
  DenyCodexValidationDispatchAuthorizationSource,
  validateCodexCapabilityExchangeAuthorizationDecision,
  validateCodexCapabilityExchangeCandidate,
  validateCodexAuthenticatedRegistrationCandidate,
  validateCodexRegistrationAuthorizationDecision,
  validateCodexValidationDispatchAuthorizationDecision,
  validateCodexValidationDispatchCandidate,
  validateCodexHeartbeatEvidenceCandidate,
  validateCodexValidationCancellationCandidate,
  validateCodexValidationProcessCleanupEvidence,
  validateCodexValidationProcessSessionRecoveryWorkItem,
  validateCodexValidationProcessSessionRecoveryExitEvidence,
  validateCodexValidationRoundTripCandidate,
  validateSupervisorProcessBinding,
  type AuthenticatedJsonlSessionContext,
  type BridgeArtifactContentVerifier,
  type BridgeBrokerEvidenceVerifier,
  type BridgeCapabilityPolicyVerifier,
  type BridgeEnvelope,
  type BridgeSecretLeaseRequest,
  type BridgeSecretLeaseResolver,
  type BridgeTestOnlyGate,
  type CodexAuthenticatedRegistrationCandidate,
  type CodexCapabilityExchangeAuthorizationSource,
  type CodexCapabilityExchangeCandidate,
  type CodexRegistrationAuthorizationSource,
  type CodexHeartbeatEvidenceCandidate,
  type CodexCancellationTerminalEvidence,
  type CodexValidationCancellationCandidate,
  type CodexValidationDispatchAuthorizationSource,
  type CodexValidationDispatchCandidate,
  type CodexValidationProcessCleanupEvidence,
  type CodexValidationProcessSessionAuthority,
  type CodexValidationProcessSessionRecoveryCompletionAuthority,
  type CodexValidationProcessSessionRecoveryCompletionRequest,
  type CodexValidationProcessSessionRecoveryCoordinatorResult,
  type CodexValidationProcessSessionRecoveryEvidenceSource,
  type CodexValidationProcessSessionRecoveryWorkItem,
  type CodexValidationProcessSessionRecoveryExitEvidence,
  type CodexTerminalEvidence,
  type CodexValidationRoundTripCandidate,
  type CodexValidationUsageObservationEvidence,
  type SupervisorProcessBinding,
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

interface CodexCapabilityEvidenceRow {
  readonly workspaceId: string;
  readonly capabilityCandidateHash: string;
  readonly registrationCandidateHash: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly adapterKind: string;
  readonly authGeneration: number;
  readonly bridgeIdentityHash: string;
  readonly accountEvidenceHash: string;
  readonly modelCatalogHash: string;
  readonly capabilityCodes: string[];
  readonly capabilityDigest: string;
  readonly modelCount: number;
  readonly observedAt: Date;
  readonly authorizationId: string;
  readonly authorizationRequestHash: string;
  readonly authorizedByReference: string;
  readonly authorizationIssuedAt: Date;
  readonly authorizationExpiresAt: Date;
  readonly capabilityPolicyHash: string;
  readonly capabilityIdempotencyKey: string;
  readonly createdAt: Date;
}

interface CodexHeartbeatEvidenceRow {
  readonly workspaceId: string;
  readonly heartbeatCandidateHash: string;
  readonly registrationCandidateHash: string;
  readonly capabilityCandidateHash: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly adapterKind: string;
  readonly authGeneration: number;
  readonly bridgeIdentityHash: string;
  readonly secretBindingHash: string;
  readonly capabilityDigest: string;
  readonly sequence: number;
  readonly messageId: string;
  readonly health: string;
  readonly payloadDigest: string;
  readonly envelopeDigest: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly heartbeatIdempotencyKey: string;
  readonly createdAt: Date;
}

interface CodexValidationDispatchEvidenceRow {
  readonly workspaceId: string;
  readonly validationDispatchCandidateHash: string;
  readonly heartbeatCandidateHash: string;
  readonly registrationCandidateHash: string;
  readonly capabilityCandidateHash: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly adapterKind: string;
  readonly authGeneration: number;
  readonly bridgeIdentityHash: string;
  readonly secretBindingHash: string;
  readonly capabilityDigest: string;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly authorityLevel: number;
  readonly taskPolicyHash: string;
  readonly maximumCostMinorUnits: number;
  readonly progressEventCount: number;
  readonly progressEvidenceHash: string;
  readonly tokenUsageEventCount: number;
  readonly tokenUsageEvidenceHash: string;
  readonly usageAccountingState: string;
  readonly recognizedCostMinorUnits: number;
  readonly recognizedComputeUnits: number;
  readonly maximumComputeUnits: number;
  readonly maximumDurationMs: number;
  readonly outboundSequence: number;
  readonly messageId: string;
  readonly challengeCode: string;
  readonly payloadDigest: string;
  readonly unsignedEnvelopeDigest: string;
  readonly signedEnvelopeDigest: string;
  readonly authenticationTagDigest: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly authorizationId: string;
  readonly authorizationRequestHash: string;
  readonly authorizedByReference: string;
  readonly authorizationIssuedAt: Date;
  readonly authorizationExpiresAt: Date;
  readonly dispatchIdempotencyKey: string;
  readonly createdAt: Date;
}

interface CodexValidationEgressHandoffRow {
  readonly workspaceId: string;
  readonly id: string;
  readonly validationDispatchCandidateHash: string;
  readonly heartbeatCandidateHash: string;
  readonly ownerReference: string;
  readonly ownerActorKind: 'HUMAN' | 'AGENT' | 'SYSTEM';
  readonly claimIdempotencyKey: string;
  readonly generation: number;
  readonly state: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly authorityLevel: number;
  readonly taskPolicyHash: string;
  readonly maximumComputeUnits: number;
  readonly maximumCostMinorUnits: number;
  readonly progressEventCount: number;
  readonly progressEvidenceHash: string;
  readonly tokenUsageEventCount: number;
  readonly tokenUsageEvidenceHash: string;
  readonly usageAccountingState: string;
  readonly recognizedCostMinorUnits: number;
  readonly recognizedComputeUnits: number;
  readonly maximumDurationMs: number;
  readonly outboundSequence: number;
  readonly messageId: string;
  readonly challengeCode: string;
  readonly payloadDigest: string;
  readonly unsignedEnvelopeDigest: string;
  readonly signedEnvelopeDigest: string;
  readonly authenticationTagDigest: string;
  readonly validationIssuedAt: Date;
  readonly validationExpiresAt: Date;
  readonly claimedAt: Date;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

interface CodexValidationRoundTripEvidenceRow {
  readonly workspaceId: string;
  readonly roundTripCandidateHash: string;
  readonly handoffAttemptId: string;
  readonly validationDispatchCandidateHash: string;
  readonly heartbeatCandidateHash: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly adapterKind: string;
  readonly authGeneration: number;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly authorityLevel: number;
  readonly taskPolicyHash: string;
  readonly maximumCostMinorUnits: number;
  readonly statusSequence: number;
  readonly statusMessageId: string;
  readonly statusPayloadDigest: string;
  readonly statusEnvelopeDigest: string;
  readonly statusAuthenticationTagDigest: string;
  readonly statusIssuedAt: Date;
  readonly statusExpiresAt: Date;
  readonly terminalSequence: number;
  readonly terminalMessageId: string;
  readonly terminalThreadId: string;
  readonly terminalTurnId: string;
  readonly terminalMessageHash: string;
  readonly terminalPayloadDigest: string;
  readonly terminalEnvelopeDigest: string;
  readonly terminalAuthenticationTagDigest: string;
  readonly terminalIssuedAt: Date;
  readonly terminalExpiresAt: Date;
  readonly resultCode: string;
  readonly statusState: string;
  readonly terminalState: string;
  readonly providerAccess: string;
  readonly runtimeConnection: string;
  readonly connectionTransition: string;
  readonly roundTripIdempotencyKey: string;
  readonly createdAt: Date;
}

interface CodexValidationCancellationEvidenceRow {
  readonly workspaceId: string;
  readonly cancellationCandidateHash: string;
  readonly handoffAttemptId: string;
  readonly validationDispatchCandidateHash: string;
  readonly heartbeatCandidateHash: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly principalReference: string;
  readonly adapterKind: string;
  readonly authGeneration: number;
  readonly dispatchId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly authorityLevel: number;
  readonly taskPolicyHash: string;
  readonly maximumCostMinorUnits: number;
  readonly cancellationSequence: number;
  readonly cancellationMessageId: string;
  readonly interruptRequestId: number;
  readonly interruptResponseHash: string;
  readonly terminalThreadId: string;
  readonly terminalTurnId: string;
  readonly terminalMessageHash: string;
  readonly cancellationPayloadDigest: string;
  readonly cancellationEnvelopeDigest: string;
  readonly cancellationAuthenticationTagDigest: string;
  readonly cancellationIssuedAt: Date;
  readonly cancellationExpiresAt: Date;
  readonly resultCode: string;
  readonly terminalState: string;
  readonly providerAccess: string;
  readonly runtimeConnection: string;
  readonly connectionTransition: string;
  readonly cancellationIdempotencyKey: string;
  readonly createdAt: Date;
}

interface CodexValidationProcessSessionClaimRow {
  readonly workspaceId: string;
  readonly id: string;
  readonly handoffAttemptId: string;
  readonly validationDispatchCandidateHash: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly ownerReference: string;
  readonly ownerActorKind: 'HUMAN' | 'AGENT' | 'SYSTEM';
  readonly supervisionId: string;
  readonly launchNonce: string;
  readonly platform: string;
  readonly manifestHash: string;
  readonly admissionEvidenceHash: string;
  readonly admissionBindingHash: string;
  readonly testOnly: boolean;
  readonly state: string;
  readonly runtimeConnection: string;
  readonly claimIdempotencyKey: string;
  readonly claimedAt: Date;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

interface CodexValidationProcessSessionCompletionRow {
  readonly workspaceId: string;
  readonly cleanupEvidenceHash: string;
  readonly claimId: string;
  readonly handoffAttemptId: string;
  readonly validationDispatchCandidateHash: string;
  readonly runtimeId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly reason: 'COMPLETED' | 'CANCELLED';
  readonly processState: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly closedAt: Date;
  readonly runtimeConnection: string;
  readonly completionIdempotencyKey: string;
  readonly createdAt: Date;
}

interface CodexValidationProcessSessionRecoveryRow extends CodexValidationProcessSessionClaimRow {
  readonly recoveryState: 'ACTIVE' | 'EXPIRED';
}

interface CodexValidationProcessSessionRecoveryClaimRow extends CodexValidationProcessSessionClaimRow {
  readonly runId: string;
}

interface CodexValidationProcessSessionRecoveryLeaseRow {
  readonly workspaceId: string;
  readonly id: string;
  readonly claimId: string;
  readonly ownerReference: string;
  readonly ownerActorKind: 'HUMAN' | 'AGENT' | 'SYSTEM';
  readonly generation: number;
  readonly state: string;
  readonly runtimeConnection: string;
  readonly recoveryIdempotencyKey: string;
  readonly claimExpiresAt: Date;
  readonly claimedAt: Date;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

interface CodexValidationProcessSessionRecoveryExitEvidenceRow {
  readonly workspaceId: string;
  readonly evidenceHash: string;
  readonly evidenceId: string;
  readonly recoveryLeaseId: string;
  readonly recoveryGeneration: number;
  readonly claimId: string;
  readonly cleanupEvidenceHash: string;
  readonly ownerReference: string;
  readonly ownerActorKind: 'HUMAN' | 'AGENT' | 'SYSTEM';
  readonly supervisionId: string;
  readonly launchNonce: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly validationDispatchCandidateHash: string;
  readonly identityEstablishedAt: Date;
  readonly exitedAt: Date;
  readonly verifiedAt: Date;
  readonly processState: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly identityAuthority: string;
  readonly runtimeConnection: string;
  readonly recoveryCompletionIdempotencyKey: string;
  readonly createdAt: Date;
}

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

function recoveryDispatchCandidateFromRow(
  row: Readonly<CodexValidationDispatchEvidenceRow>,
): Readonly<CodexValidationDispatchCandidate> {
  try {
    return validateCodexValidationDispatchCandidate({
      schemaVersion: 1,
      adapterKind: row.adapterKind,
      workspaceId: row.workspaceId,
      runtimeId: row.runtimeId,
      connectionId: row.connectionId,
      sessionId: row.sessionId,
      principalReference: row.principalReference,
      authGeneration: row.authGeneration,
      registrationCandidateHash: row.registrationCandidateHash,
      capabilityCandidateHash: row.capabilityCandidateHash,
      heartbeatCandidateHash: row.heartbeatCandidateHash,
      capabilityDigest: row.capabilityDigest,
      bridgeIdentityHash: row.bridgeIdentityHash,
      secretBindingHash: row.secretBindingHash,
      dispatchId: row.dispatchId,
      taskId: row.taskId,
      runId: row.runId,
      agentId: row.agentId,
      authorityLevel: row.authorityLevel,
      taskPolicyHash: row.taskPolicyHash,
      maximumCostMinorUnits: row.maximumCostMinorUnits,
      maximumComputeUnits: row.maximumComputeUnits,
      maximumDurationMs: row.maximumDurationMs,
      outboundSequence: row.outboundSequence,
      messageId: row.messageId,
      challengeCode: row.challengeCode,
      payloadDigest: row.payloadDigest,
      unsignedEnvelopeDigest: row.unsignedEnvelopeDigest,
      issuedAt: row.issuedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      assignmentState: 'NOT_CONFIGURED',
      deliveryState: 'NOT_SENT',
      providerAccess: 'NOT_CONFIGURED',
      runtimeConnection: 'NOT_CONFIGURED',
      validationDispatchCandidateHash: row.validationDispatchCandidateHash,
    });
  } catch {
    throw new AcpBridgeAdmissionDeniedError(
      'Codex validation process-session recovery dispatch is invalid',
    );
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

export interface AcceptCodexCapabilityExchangeInput {
  readonly candidate: Readonly<CodexCapabilityExchangeCandidate>;
  readonly capabilityPolicyHash: string;
  readonly idempotencyKey: string;
}

export interface AcceptCodexHeartbeatEvidenceInput {
  readonly registration: Readonly<CodexAuthenticatedRegistrationCandidate>;
  readonly capability: Readonly<CodexCapabilityExchangeCandidate>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly envelope: Readonly<BridgeEnvelope>;
  readonly idempotencyKey: string;
}

export interface PrepareCodexValidationDispatchInput {
  readonly candidate: Readonly<CodexValidationDispatchCandidate>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly idempotencyKey: string;
}

export interface ClaimCodexValidationEgressHandoffInput {
  readonly attemptId: string;
  readonly validationDispatchCandidateHash: string;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly idempotencyKey: string;
}

export interface ClaimCodexValidationProcessSessionInput {
  readonly claimId: string;
  readonly handoffAttemptId: string;
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly binding: Readonly<SupervisorProcessBinding>;
  readonly idempotencyKey: string;
}

export interface CompleteCodexValidationProcessSessionInput {
  readonly claimId: string;
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly cleanup: Readonly<CodexValidationProcessCleanupEvidence>;
  readonly idempotencyKey: string;
}

export interface CodexValidationProcessSessionAuthorityIdentity {
  readonly claimId: string;
  readonly handoffAttemptId: string;
  readonly claimIdempotencyKey: string;
  readonly completionIdempotencyKey: string;
}

export interface ListCodexValidationProcessSessionRecoveryInput {
  readonly limit: number;
  readonly afterClaimId?: string;
}

export interface CodexValidationProcessSessionRecoveryItem {
  readonly schemaVersion: 1;
  readonly claimId: string;
  readonly handoffAttemptId: string;
  readonly validationDispatchCandidateHash: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly binding: Readonly<SupervisorProcessBinding>;
  readonly recoveryState: 'ACTIVE' | 'EXPIRED';
  readonly claimedAt: string;
  readonly expiresAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface CodexValidationProcessSessionRecoveryPage {
  readonly schemaVersion: 1;
  readonly items: readonly Readonly<CodexValidationProcessSessionRecoveryItem>[];
  readonly nextCursor: string | null;
  readonly observedAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface ClaimCodexValidationProcessSessionRecoveryLeaseInput {
  readonly recoveryLeaseId: string;
  readonly claimId: string;
  readonly idempotencyKey: string;
}

export interface CodexValidationProcessSessionRecoveryLease {
  readonly schemaVersion: 1;
  readonly recoveryLeaseId: string;
  readonly claimId: string;
  readonly ownerReference: string;
  readonly ownerActorKind: 'HUMAN' | 'AGENT' | 'SYSTEM';
  readonly generation: number;
  readonly leaseState: 'ACTIVE' | 'EXPIRED';
  readonly claimExpiresAt: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
  readonly runtimeConnection: 'NOT_CONFIGURED';
}

export interface CodexValidationProcessSessionRecoveryLeaseBundle {
  readonly lease: Readonly<CodexValidationProcessSessionRecoveryLease>;
  readonly workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem> | null;
  readonly dispatch: Readonly<CodexValidationDispatchCandidate> | null;
  readonly replayed: boolean;
}

export interface CompleteCodexValidationProcessSessionRecoveryInput {
  readonly workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>;
  readonly exitEvidence: Readonly<CodexValidationProcessSessionRecoveryExitEvidence>;
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly idempotencyKey: string;
}

export interface CodexValidationProcessSessionRecoveryCompletionAuthorityIdentity {
  readonly workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>;
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly completionIdempotencyKey: string;
}

export interface CodexValidationProcessSessionRecoveryExecutionAuthorityIdentity extends CodexValidationProcessSessionRecoveryCompletionAuthorityIdentity {
  readonly lease: Readonly<CodexValidationProcessSessionRecoveryLease>;
}

export interface CodexValidationProcessSessionRecoveryExecutionAuthority {
  execute(): Promise<Readonly<CodexValidationProcessSessionRecoveryCoordinatorResult>>;
}

export interface ExecuteCodexValidationProcessSessionRecoveryInput extends ClaimCodexValidationProcessSessionRecoveryLeaseInput {
  readonly completionIdempotencyKey: string;
}

export interface CodexValidationProcessSessionRecoveryExecutionResult {
  readonly lease: Readonly<CodexValidationProcessSessionRecoveryLease>;
  readonly replayed: boolean;
  readonly execution: Readonly<CodexValidationProcessSessionRecoveryCoordinatorResult> | null;
  readonly recoveryState: 'RECORDED' | 'LEASE_EXPIRED';
  readonly runtimeConnection: 'NOT_CONFIGURED';
  readonly connectionTransition: 'NOT_APPLIED';
}

export interface AcceptCodexValidationRoundTripEvidenceInput {
  readonly handoffAttemptId: string;
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly terminal: Readonly<CodexTerminalEvidence & CodexValidationUsageObservationEvidence>;
  readonly statusEnvelope: Readonly<BridgeEnvelope>;
  readonly terminalEnvelope: Readonly<BridgeEnvelope>;
  readonly idempotencyKey: string;
}

export interface AcceptCodexValidationCancellationEvidenceInput {
  readonly handoffAttemptId: string;
  readonly dispatch: Readonly<CodexValidationDispatchCandidate>;
  readonly bridge: Readonly<AuthenticatedJsonlSessionContext>;
  readonly terminal: Readonly<
    CodexCancellationTerminalEvidence & CodexValidationUsageObservationEvidence
  >;
  readonly cancellationEnvelope: Readonly<BridgeEnvelope>;
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
    @Inject(CODEX_CAPABILITY_EXCHANGE_AUTHORIZATION_SOURCE)
    private readonly codexCapabilityAuthorizations: CodexCapabilityExchangeAuthorizationSource = new DenyCodexCapabilityExchangeAuthorizationSource(),
    @Inject(CODEX_VALIDATION_DISPATCH_AUTHORIZATION_SOURCE)
    private readonly codexValidationDispatchAuthorizations: CodexValidationDispatchAuthorizationSource = new DenyCodexValidationDispatchAuthorizationSource(),
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

  async acceptCodexCapabilityExchange(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: AcceptCodexCapabilityExchangeInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    reference(input.idempotencyKey, 'idempotencyKey');
    digest(input.capabilityPolicyHash, 'capabilityPolicyHash');
    let candidate: Readonly<CodexCapabilityExchangeCandidate>;
    try {
      candidate = validateCodexCapabilityExchangeCandidate(input.candidate);
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Invalid Codex capability evidence');
    }
    if (
      candidate.workspaceId !== context.workspaceId ||
      candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
      candidate.authGeneration !== 1
    )
      throw new AcpBridgeAdmissionDeniedError('Codex capability identity is not admissible');
    if (
      !(await this.capabilityPolicy.verify(
        context.workspaceId,
        candidate.runtimeId,
        input.capabilityPolicyHash,
        candidate.capabilityCodes,
      ))
    )
      throw new AcpBridgeAdmissionDeniedError('Codex catalog claims are not policy-authorized');

    const authorizationRequest = createCodexCapabilityExchangeAuthorizationRequest(
      candidate,
      input.capabilityPolicyHash,
      input.idempotencyKey,
    );
    const authorizationRequestHash =
      codexCapabilityExchangeAuthorizationRequestHash(authorizationRequest);
    let authorization: ReturnType<typeof validateCodexCapabilityExchangeAuthorizationDecision>;
    try {
      authorization = validateCodexCapabilityExchangeAuthorizationDecision(
        await this.codexCapabilityAuthorizations.read(authorizationRequest),
        authorizationRequestHash,
      );
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Codex capability authorization denied');
    }

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
            throw new AcpBridgeAdmissionDeniedError('Codex capability evidence expired');

          const [existingRows, registration] = await Promise.all([
            tx.$queryRaw<CodexCapabilityEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_runtime_capability_evidence"
              WHERE "workspaceId" = CAST(${context.workspaceId} AS uuid)
                AND (
                  "capabilityCandidateHash" = ${candidate.capabilityCandidateHash}
                  OR "capabilityIdempotencyKey" = ${input.idempotencyKey}
                  OR "authorizationId" = ${authorization.authorizationId}
                )
              FOR SHARE
            `),
            tx.acpRuntimeRegistrationEvidence.findUnique({
              where: {
                workspaceId_registrationCandidateHash: {
                  workspaceId: context.workspaceId,
                  registrationCandidateHash: candidate.registrationCandidateHash,
                },
              },
              include: { connection: { include: { runtime: true } } },
            }),
          ]);
          const existingByCandidate = existingRows.find(
            (row) => row.capabilityCandidateHash === candidate.capabilityCandidateHash,
          );
          const existingByKey = existingRows.find(
            (row) => row.capabilityIdempotencyKey === input.idempotencyKey,
          );
          const existingAuthorization = existingRows.find(
            (row) => row.authorizationId === authorization.authorizationId,
          );
          const existingEvidence = existingByCandidate ?? existingByKey;
          if (existingEvidence) {
            if (!registration)
              throw new AcpBridgeAdmissionConflictError('Codex capability registration missing');
            const connection = registration.connection;
            const runtime = connection.runtime;
            if (
              existingByCandidate?.capabilityIdempotencyKey !== input.idempotencyKey ||
              existingByKey?.capabilityCandidateHash !== candidate.capabilityCandidateHash ||
              existingEvidence.registrationCandidateHash !== candidate.registrationCandidateHash ||
              existingEvidence.runtimeId !== candidate.runtimeId ||
              existingEvidence.connectionId !== candidate.connectionId ||
              existingEvidence.sessionId !== candidate.sessionId ||
              existingEvidence.principalReference !== candidate.principalReference ||
              existingEvidence.bridgeIdentityHash !== candidate.bridgeIdentityHash ||
              existingEvidence.accountEvidenceHash !== candidate.accountEvidenceHash ||
              existingEvidence.modelCatalogHash !== candidate.modelCatalogHash ||
              JSON.stringify(existingEvidence.capabilityCodes) !==
                JSON.stringify(candidate.capabilityCodes) ||
              existingEvidence.capabilityDigest !== candidate.capabilityDigest ||
              existingEvidence.modelCount !== candidate.modelCount ||
              existingEvidence.observedAt.getTime() !== observedAt.getTime() ||
              existingEvidence.authorizationId !== authorization.authorizationId ||
              existingEvidence.authorizationRequestHash !== authorizationRequestHash ||
              existingEvidence.authorizedByReference !== authorization.authorizedByReference ||
              existingEvidence.authorizationIssuedAt.getTime() !==
                authorizationIssuedAt.getTime() ||
              existingEvidence.authorizationExpiresAt.getTime() !==
                authorizationExpiresAt.getTime() ||
              existingEvidence.capabilityPolicyHash !== input.capabilityPolicyHash ||
              runtime.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
              runtime.status !== 'NOT_CONFIGURED' ||
              runtime.capabilityPolicyHash !== input.capabilityPolicyHash ||
              connection.status !== 'NOT_CONFIGURED' ||
              connection.authGeneration !== candidate.authGeneration ||
              connection.capabilityCodes.length !== 0 ||
              connection.capabilityDigest !== null
            )
              throw new AcpBridgeAdmissionConflictError('Codex capability replay drifted');
            return { runtime, connection, evidence: existingEvidence, replayed: true };
          }
          if (existingAuthorization)
            throw new AcpBridgeAdmissionConflictError(
              'Codex capability authorization already used',
            );
          if (!registration)
            throw new AcpBridgeAdmissionNotFoundError('Codex registration evidence not found');

          const connection = registration.connection;
          const runtime = connection.runtime;
          const registrationObservedAt = registration.observedAt;
          if (
            registration.runtimeId !== candidate.runtimeId ||
            registration.connectionId !== candidate.connectionId ||
            registration.sessionId !== candidate.sessionId ||
            registration.principalReference !== candidate.principalReference ||
            registration.adapterKind !== candidate.adapterKind ||
            registration.authGeneration !== candidate.authGeneration ||
            registration.bridgeIdentityHash !== candidate.bridgeIdentityHash ||
            registration.accountEvidenceHash !== candidate.accountEvidenceHash ||
            observedAt < registrationObservedAt ||
            observedAt.getTime() - registrationObservedAt.getTime() > 5 * 60_000 ||
            runtime.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
            runtime.status !== 'NOT_CONFIGURED' ||
            runtime.capabilityPolicyHash !== input.capabilityPolicyHash ||
            connection.status !== 'NOT_CONFIGURED' ||
            connection.authGeneration !== candidate.authGeneration ||
            connection.capabilityCodes.length !== 0 ||
            connection.capabilityDigest !== null
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex capability evidence does not match durable registration',
            );

          const [evidence] = await tx.$queryRaw<CodexCapabilityEvidenceRow[]>(Prisma.sql`
            INSERT INTO "acp_runtime_capability_evidence" (
              "workspaceId", "capabilityCandidateHash", "registrationCandidateHash",
              "runtimeId", "connectionId", "sessionId", "principalReference", "adapterKind",
              "authGeneration", "bridgeIdentityHash", "accountEvidenceHash", "modelCatalogHash",
              "capabilityCodes", "capabilityDigest", "modelCount", "observedAt",
              "authorizationId", "authorizationRequestHash", "authorizedByReference",
              "authorizationIssuedAt", "authorizationExpiresAt", "capabilityPolicyHash",
              "capabilityIdempotencyKey"
            ) VALUES (
              CAST(${context.workspaceId} AS uuid), ${candidate.capabilityCandidateHash},
              ${candidate.registrationCandidateHash}, ${candidate.runtimeId},
              ${candidate.connectionId}, ${candidate.sessionId}, ${candidate.principalReference},
              ${candidate.adapterKind}, ${candidate.authGeneration}, ${candidate.bridgeIdentityHash},
              ${candidate.accountEvidenceHash}, ${candidate.modelCatalogHash},
              ARRAY[${Prisma.join(candidate.capabilityCodes)}]::text[],
              ${candidate.capabilityDigest}, ${candidate.modelCount}, ${observedAt},
              ${authorization.authorizationId}, ${authorizationRequestHash},
              ${authorization.authorizedByReference}, ${authorizationIssuedAt},
              ${authorizationExpiresAt}, ${input.capabilityPolicyHash}, ${input.idempotencyKey}
            )
            RETURNING *
          `);
          if (!evidence)
            throw new AcpBridgeAdmissionConflictError('Codex capability evidence was not stored');
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
              subjectType: 'AcpRuntimeCapabilityEvidence',
              subjectId: candidate.capabilityCandidateHash,
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
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex capability conflict; retry with current durable state',
        );
      throw error;
    }
  }

  async acceptCodexHeartbeatEvidence(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: AcceptCodexHeartbeatEvidenceInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    reference(input.idempotencyKey, 'idempotencyKey');
    let candidate: Readonly<CodexHeartbeatEvidenceCandidate>;
    try {
      candidate = validateCodexHeartbeatEvidenceCandidate(
        createCodexHeartbeatEvidenceCandidate(input),
      );
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Invalid Codex heartbeat evidence');
    }
    if (
      candidate.workspaceId !== context.workspaceId ||
      candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
      candidate.authGeneration !== 1
    )
      throw new AcpBridgeAdmissionDeniedError('Codex heartbeat identity is not admissible');

    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = await databaseNow(tx);
          const issuedAt = new Date(candidate.issuedAt);
          const expiresAt = new Date(candidate.expiresAt);
          if (issuedAt > now || now.getTime() - issuedAt.getTime() > 60_000 || expiresAt <= now)
            throw new AcpBridgeAdmissionDeniedError('Codex heartbeat evidence expired');

          const [registration, capabilityRows, existingRows] = await Promise.all([
            tx.acpRuntimeRegistrationEvidence.findUnique({
              where: {
                workspaceId_registrationCandidateHash: {
                  workspaceId: context.workspaceId,
                  registrationCandidateHash: candidate.registrationCandidateHash,
                },
              },
              include: { connection: { include: { runtime: true } } },
            }),
            tx.$queryRaw<CodexCapabilityEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_runtime_capability_evidence"
              WHERE "workspaceId" = CAST(${context.workspaceId} AS uuid)
                AND "capabilityCandidateHash" = ${candidate.capabilityCandidateHash}
              FOR SHARE
            `),
            tx.$queryRaw<CodexHeartbeatEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_runtime_heartbeat_evidence"
              WHERE "workspaceId" = CAST(${context.workspaceId} AS uuid)
                AND (
                  "heartbeatCandidateHash" = ${candidate.heartbeatCandidateHash}
                  OR "heartbeatIdempotencyKey" = ${input.idempotencyKey}
                  OR "messageId" = ${candidate.messageId}
                  OR ("connectionId" = ${candidate.connectionId} AND "sequence" = ${candidate.sequence})
                )
              FOR SHARE
            `),
          ]);
          const capabilityEvidence = capabilityRows[0];
          if (!registration || !capabilityEvidence)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex registration or capability evidence not found',
            );
          const connection = registration.connection;
          const runtime = connection.runtime;
          if (
            registration.runtimeId !== candidate.runtimeId ||
            registration.connectionId !== candidate.connectionId ||
            registration.sessionId !== candidate.sessionId ||
            registration.principalReference !== candidate.principalReference ||
            registration.bridgeIdentityHash !== candidate.bridgeIdentityHash ||
            registration.secretBindingHash !== candidate.secretBindingHash ||
            capabilityEvidence.registrationCandidateHash !== candidate.registrationCandidateHash ||
            capabilityEvidence.runtimeId !== candidate.runtimeId ||
            capabilityEvidence.connectionId !== candidate.connectionId ||
            capabilityEvidence.sessionId !== candidate.sessionId ||
            capabilityEvidence.principalReference !== candidate.principalReference ||
            capabilityEvidence.bridgeIdentityHash !== candidate.bridgeIdentityHash ||
            capabilityEvidence.capabilityDigest !== candidate.capabilityDigest ||
            runtime.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
            runtime.status !== 'NOT_CONFIGURED' ||
            runtime.secretReference !== input.bridge.secretReference ||
            runtime.secretDigest !== input.bridge.expectedSecretDigest ||
            connection.status !== 'NOT_CONFIGURED' ||
            connection.authGeneration !== candidate.authGeneration ||
            connection.capabilityCodes.length !== 0 ||
            connection.capabilityDigest !== null ||
            connection.lastHeartbeatAt !== null ||
            connection.lastHeartbeatHealth !== null ||
            connection.lastHeartbeatSequence !== null
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex heartbeat does not match durable precursor evidence',
            );

          await this.withSecretLease(
            {
              workspaceId: context.workspaceId,
              runtimeId: candidate.runtimeId,
              connectionId: candidate.connectionId,
              secretReference: input.bridge.secretReference,
              expectedDigest: input.bridge.expectedSecretDigest,
              authGeneration: candidate.authGeneration,
              purpose: 'VERIFY_FRAME',
            },
            (secret) => {
              const keys = deriveBridgeKeys(secret, input.bridge);
              try {
                verifyBridgeEnvelope(input.envelope, keys.runtimeToParent, input.bridge, now);
              } catch {
                throw new AcpBridgeAdmissionDeniedError(
                  'Codex heartbeat frame authentication failed',
                );
              }
            },
          );

          const existingByCandidate = existingRows.find(
            (row) => row.heartbeatCandidateHash === candidate.heartbeatCandidateHash,
          );
          const existingByKey = existingRows.find(
            (row) => row.heartbeatIdempotencyKey === input.idempotencyKey,
          );
          const existingByMessage = existingRows.find(
            (row) => row.messageId === candidate.messageId,
          );
          const existingBySequence = existingRows.find(
            (row) =>
              row.connectionId === candidate.connectionId && row.sequence === candidate.sequence,
          );
          const existingEvidence = existingByCandidate ?? existingByKey;
          if (existingEvidence) {
            if (
              existingByCandidate?.heartbeatIdempotencyKey !== input.idempotencyKey ||
              existingByKey?.heartbeatCandidateHash !== candidate.heartbeatCandidateHash ||
              existingByMessage?.heartbeatCandidateHash !== candidate.heartbeatCandidateHash ||
              existingBySequence?.heartbeatCandidateHash !== candidate.heartbeatCandidateHash
            )
              throw new AcpBridgeAdmissionConflictError('Codex heartbeat replay drifted');
            return { runtime, connection, evidence: existingEvidence, replayed: true };
          }
          if (existingByMessage || existingBySequence)
            throw new AcpBridgeAdmissionConflictError('Codex heartbeat replay drifted');

          const [evidence] = await tx.$queryRaw<CodexHeartbeatEvidenceRow[]>(Prisma.sql`
            INSERT INTO "acp_runtime_heartbeat_evidence" (
              "workspaceId", "heartbeatCandidateHash", "registrationCandidateHash",
              "capabilityCandidateHash", "runtimeId", "connectionId", "sessionId",
              "principalReference", "adapterKind", "authGeneration", "bridgeIdentityHash",
              "secretBindingHash", "capabilityDigest", "sequence", "messageId", "health",
              "payloadDigest", "envelopeDigest", "issuedAt", "expiresAt",
              "heartbeatIdempotencyKey"
            ) VALUES (
              CAST(${context.workspaceId} AS uuid), ${candidate.heartbeatCandidateHash},
              ${candidate.registrationCandidateHash}, ${candidate.capabilityCandidateHash},
              ${candidate.runtimeId}, ${candidate.connectionId}, ${candidate.sessionId},
              ${candidate.principalReference}, ${candidate.adapterKind},
              ${candidate.authGeneration}, ${candidate.bridgeIdentityHash},
              ${candidate.secretBindingHash}, ${candidate.capabilityDigest},
              ${candidate.sequence}, ${candidate.messageId}, ${candidate.health},
              ${candidate.payloadDigest}, ${candidate.envelopeDigest}, ${issuedAt}, ${expiresAt},
              ${input.idempotencyKey}
            )
            RETURNING *
          `);
          if (!evidence)
            throw new AcpBridgeAdmissionConflictError('Codex heartbeat evidence was not stored');
          await this.auditService.recordOperationalEvent(
            capability,
            context,
            {
              id: randomUUID(),
              workspaceId: context.workspaceId,
              type: 'runtime.heartbeat.recorded',
              source: 'CONTROL_PLANE',
              actorKind,
              actorId: context.principalId,
              subjectType: 'AcpRuntimeHeartbeatEvidence',
              subjectId: candidate.heartbeatCandidateHash,
              occurredAt: now.toISOString(),
              idempotencyKey: `${input.idempotencyKey}:event`,
              correlationId: candidate.sessionId,
              facts: {
                connectionId: candidate.connectionId,
                health: candidate.health,
                sequence: candidate.sequence,
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
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex heartbeat conflict; retry with current durable state',
        );
      throw error;
    }
  }

  async prepareCodexValidationDispatch(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: PrepareCodexValidationDispatchInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    reference(input.idempotencyKey, 'idempotencyKey');
    let candidate: Readonly<CodexValidationDispatchCandidate>;
    try {
      candidate = validateCodexValidationDispatchCandidate(input.candidate);
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Invalid Codex validation dispatch evidence');
    }
    if (
      candidate.workspaceId !== context.workspaceId ||
      candidate.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
      candidate.authGeneration !== 1 ||
      candidate.maximumCostMinorUnits !== 0
    )
      throw new AcpBridgeAdmissionDeniedError('Codex validation dispatch is not admissible');

    for (const [field, value] of Object.entries({
      workspaceId: input.bridge.workspaceId,
      runtimeId: input.bridge.runtimeId,
      connectionId: input.bridge.connectionId,
      sessionId: input.bridge.sessionId,
      principalReference: input.bridge.principalReference,
      parentNonce: input.bridge.parentNonce,
      runtimeNonce: input.bridge.runtimeNonce,
      secretReference: input.bridge.secretReference,
    }))
      reference(value, field);
    digest(input.bridge.expectedSecretDigest, 'expectedSecretDigest');
    if (
      input.bridge.schemaVersion !== 1 ||
      !Number.isSafeInteger(input.bridge.authGeneration) ||
      input.bridge.authGeneration !== candidate.authGeneration
    )
      throw new AcpBridgeAdmissionDeniedError('Codex validation bridge identity is invalid');
    const authenticatedAt = new Date(input.bridge.authenticatedAt);
    const bridgeExpiresAt = new Date(input.bridge.expiresAt);
    if (
      !Number.isFinite(authenticatedAt.getTime()) ||
      authenticatedAt.toISOString() !== input.bridge.authenticatedAt ||
      !Number.isFinite(bridgeExpiresAt.getTime()) ||
      bridgeExpiresAt.toISOString() !== input.bridge.expiresAt
    )
      throw new AcpBridgeAdmissionDeniedError('Codex validation bridge window is invalid');
    const bridgeIdentityHash = sha256({
      authGeneration: input.bridge.authGeneration,
      authenticatedAt: input.bridge.authenticatedAt,
      connectionId: input.bridge.connectionId,
      expectedSecretDigest: input.bridge.expectedSecretDigest,
      expiresAt: input.bridge.expiresAt,
      parentNonce: input.bridge.parentNonce,
      principalReference: input.bridge.principalReference,
      runtimeNonce: input.bridge.runtimeNonce,
      runtimeId: input.bridge.runtimeId,
      secretReference: input.bridge.secretReference,
      sessionId: input.bridge.sessionId,
      workspaceId: input.bridge.workspaceId,
    });
    const secretBindingHash = sha256({
      expectedSecretDigest: input.bridge.expectedSecretDigest,
      secretReference: input.bridge.secretReference,
    });
    if (
      candidate.workspaceId !== input.bridge.workspaceId ||
      candidate.runtimeId !== input.bridge.runtimeId ||
      candidate.connectionId !== input.bridge.connectionId ||
      candidate.sessionId !== input.bridge.sessionId ||
      candidate.principalReference !== input.bridge.principalReference ||
      candidate.bridgeIdentityHash !== bridgeIdentityHash ||
      candidate.secretBindingHash !== secretBindingHash ||
      new Date(candidate.expiresAt) > bridgeExpiresAt
    )
      throw new AcpBridgeAdmissionDeniedError('Codex validation bridge identity drifted');

    const authorizationRequest = createCodexValidationDispatchAuthorizationRequest(
      candidate,
      input.idempotencyKey,
    );
    const authorizationRequestHash =
      codexValidationDispatchAuthorizationRequestHash(authorizationRequest);
    let authorization: ReturnType<typeof validateCodexValidationDispatchAuthorizationDecision>;
    try {
      authorization = validateCodexValidationDispatchAuthorizationDecision(
        await this.codexValidationDispatchAuthorizations.read(authorizationRequest),
        authorizationRequestHash,
      );
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Codex validation dispatch authorization denied');
    }

    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = await databaseNow(tx);
          const issuedAt = new Date(candidate.issuedAt);
          const expiresAt = new Date(candidate.expiresAt);
          const authorizationIssuedAt = new Date(authorization.issuedAt);
          const authorizationExpiresAt = new Date(authorization.expiresAt);
          if (
            issuedAt > now ||
            now.getTime() - issuedAt.getTime() > 60_000 ||
            expiresAt <= now ||
            authorizationIssuedAt < issuedAt ||
            authorizationIssuedAt > now ||
            authorizationExpiresAt <= now
          )
            throw new AcpBridgeAdmissionDeniedError('Codex validation dispatch expired');

          await Promise.all([
            tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runs" WHERE "workspaceId"=${context.workspaceId}::uuid AND "id"=${candidate.runId} FOR UPDATE`,
            ),
            tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_tasks" WHERE "workspaceId"=${context.workspaceId}::uuid AND "id"=${candidate.taskId} FOR UPDATE`,
            ),
            tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "acp_runtime_connections" WHERE "workspaceId"=${context.workspaceId}::uuid AND "id"=${candidate.connectionId} FOR SHARE`,
            ),
          ]);
          const [registration, capabilityRows, heartbeatRows, run, existingRows] =
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
              tx.$queryRaw<CodexCapabilityEvidenceRow[]>(Prisma.sql`
                SELECT * FROM "acp_runtime_capability_evidence"
                WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                  AND "capabilityCandidateHash"=${candidate.capabilityCandidateHash}
                FOR SHARE
              `),
              tx.$queryRaw<CodexHeartbeatEvidenceRow[]>(Prisma.sql`
                SELECT * FROM "acp_runtime_heartbeat_evidence"
                WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                  AND "heartbeatCandidateHash"=${candidate.heartbeatCandidateHash}
                FOR SHARE
              `),
              tx.acpRun.findUnique({
                where: {
                  workspaceId_id: { workspaceId: context.workspaceId, id: candidate.runId },
                },
                include: { task: { include: { objective: true } } },
              }),
              tx.$queryRaw<CodexValidationDispatchEvidenceRow[]>(Prisma.sql`
                SELECT * FROM "acp_codex_validation_dispatch_evidence"
                WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                  AND (
                    "validationDispatchCandidateHash"=${candidate.validationDispatchCandidateHash}
                    OR "dispatchIdempotencyKey"=${input.idempotencyKey}
                    OR "authorizationId"=${authorization.authorizationId}
                    OR "dispatchId"=${candidate.dispatchId}
                    OR "messageId"=${candidate.messageId}
                    OR "heartbeatCandidateHash"=${candidate.heartbeatCandidateHash}
                    OR "runId"=${candidate.runId}
                  )
                FOR SHARE
              `),
            ]);
          const capabilityEvidence = capabilityRows[0];
          const heartbeatEvidence = heartbeatRows[0];
          if (!registration || !capabilityEvidence || !heartbeatEvidence || !run)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation dispatch precursor evidence not found',
            );
          const connection = registration.connection;
          const runtime = connection.runtime;
          const routingPolicy = run.task.routingPolicy as Record<string, unknown>;
          const agentPolicy = run.task.agentPolicy as Record<string, unknown>;
          if (
            !routingPolicy ||
            typeof routingPolicy !== 'object' ||
            Array.isArray(routingPolicy) ||
            JSON.stringify(Object.keys(routingPolicy).sort()) !==
              JSON.stringify(['capabilityId', 'maximumLatencyMs']) ||
            routingPolicy.capabilityId !== CODEX_VALIDATION_CHALLENGE ||
            routingPolicy.maximumLatencyMs !== candidate.maximumDurationMs ||
            !agentPolicy ||
            typeof agentPolicy !== 'object' ||
            Array.isArray(agentPolicy) ||
            JSON.stringify(Object.keys(agentPolicy).sort()) !==
              JSON.stringify(['scopes', 'templateId']) ||
            agentPolicy.templateId !== 'codex-runtime-validator' ||
            !Array.isArray(agentPolicy.scopes) ||
            JSON.stringify(agentPolicy.scopes) !== JSON.stringify([CODEX_VALIDATION_CHALLENGE])
          )
            throw new AcpBridgeAdmissionDeniedError('Codex validation task policy is not exact');
          if (
            run.taskId !== candidate.taskId ||
            run.workspaceId !== context.workspaceId ||
            run.objectiveId !== run.task.objectiveId ||
            run.status !== 'PREPARED' ||
            run.task.status !== 'READY' ||
            run.requiredAuthority !== candidate.authorityLevel ||
            run.task.requiredAuthority !== candidate.authorityLevel ||
            run.requiredAuthority >= 4 ||
            run.policyHash !== candidate.taskPolicyHash ||
            run.task.policyHash !== candidate.taskPolicyHash ||
            run.policyVersion !== run.task.policyVersion ||
            run.task.kind !== 'quality.verify' ||
            run.task.maximumCostMinorUnits !== 0n ||
            run.task.maximumComputeUnits !== BigInt(candidate.maximumComputeUnits) ||
            run.task.estimatedDurationMs !== BigInt(candidate.maximumDurationMs) ||
            run.task.objective.status !== 'ACTIVE' ||
            run.task.objective.maximumAuthority < candidate.authorityLevel ||
            run.task.objective.maximumCostMinorUnits !== 0n ||
            run.task.objective.maximumComputeUnits < BigInt(candidate.maximumComputeUnits) ||
            run.assignedAgentId !== null ||
            run.assignedRuntimeId !== null ||
            run.assignedConnectionId !== null ||
            run.task.assignedAgentId !== null ||
            run.task.assignedRuntimeId !== null ||
            run.task.assignedConnectionId !== null
          )
            throw new AcpBridgeAdmissionDeniedError('Codex validation run is not admissible');
          if (
            registration.runtimeId !== candidate.runtimeId ||
            registration.connectionId !== candidate.connectionId ||
            registration.sessionId !== candidate.sessionId ||
            registration.principalReference !== candidate.principalReference ||
            registration.bridgeIdentityHash !== candidate.bridgeIdentityHash ||
            registration.secretBindingHash !== candidate.secretBindingHash ||
            capabilityEvidence.registrationCandidateHash !== candidate.registrationCandidateHash ||
            capabilityEvidence.runtimeId !== candidate.runtimeId ||
            capabilityEvidence.connectionId !== candidate.connectionId ||
            capabilityEvidence.sessionId !== candidate.sessionId ||
            capabilityEvidence.principalReference !== candidate.principalReference ||
            capabilityEvidence.bridgeIdentityHash !== candidate.bridgeIdentityHash ||
            capabilityEvidence.capabilityDigest !== candidate.capabilityDigest ||
            heartbeatEvidence.registrationCandidateHash !== candidate.registrationCandidateHash ||
            heartbeatEvidence.capabilityCandidateHash !== candidate.capabilityCandidateHash ||
            heartbeatEvidence.runtimeId !== candidate.runtimeId ||
            heartbeatEvidence.connectionId !== candidate.connectionId ||
            heartbeatEvidence.sessionId !== candidate.sessionId ||
            heartbeatEvidence.principalReference !== candidate.principalReference ||
            heartbeatEvidence.bridgeIdentityHash !== candidate.bridgeIdentityHash ||
            heartbeatEvidence.secretBindingHash !== candidate.secretBindingHash ||
            heartbeatEvidence.capabilityDigest !== candidate.capabilityDigest ||
            issuedAt < heartbeatEvidence.issuedAt ||
            issuedAt.getTime() - heartbeatEvidence.issuedAt.getTime() > 60_000 ||
            expiresAt > heartbeatEvidence.expiresAt ||
            runtime.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
            runtime.status !== 'NOT_CONFIGURED' ||
            runtime.secretReference !== input.bridge.secretReference ||
            runtime.secretDigest !== input.bridge.expectedSecretDigest ||
            connection.status !== 'NOT_CONFIGURED' ||
            connection.authGeneration !== candidate.authGeneration ||
            connection.capabilityCodes.length !== 0 ||
            connection.capabilityDigest !== null ||
            connection.lastHeartbeatAt !== null ||
            connection.lastHeartbeatHealth !== null ||
            connection.lastHeartbeatSequence !== null
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation dispatch does not match durable precursor evidence',
            );

          return this.withSecretLease(
            {
              workspaceId: context.workspaceId,
              runtimeId: candidate.runtimeId,
              connectionId: candidate.connectionId,
              secretReference: input.bridge.secretReference,
              expectedDigest: input.bridge.expectedSecretDigest,
              authGeneration: candidate.authGeneration,
              purpose: 'SIGN_FRAME',
            },
            async (secret) => {
              const keys = deriveBridgeKeys(secret, input.bridge);
              try {
                const unsigned = codexValidationDispatchUnsignedEnvelope(candidate);
                const frame = signBridgeEnvelope(unsigned, keys.parentToRuntime);
                const signedEnvelopeDigest = sha256(frame);
                const authenticationTagDigest = createHash('sha256')
                  .update(frame.mac)
                  .digest('hex');
                const existingByCandidate = existingRows.find(
                  (row) =>
                    row.validationDispatchCandidateHash ===
                    candidate.validationDispatchCandidateHash,
                );
                const existingByKey = existingRows.find(
                  (row) => row.dispatchIdempotencyKey === input.idempotencyKey,
                );
                const existingAuthorization = existingRows.find(
                  (row) => row.authorizationId === authorization.authorizationId,
                );
                const existingDispatch = existingRows.find(
                  (row) => row.dispatchId === candidate.dispatchId,
                );
                const existingHeartbeat = existingRows.find(
                  (row) => row.heartbeatCandidateHash === candidate.heartbeatCandidateHash,
                );
                const existingRun = existingRows.find((row) => row.runId === candidate.runId);
                const existingEvidence = existingByCandidate ?? existingByKey;
                if (existingEvidence) {
                  if (
                    existingByCandidate?.dispatchIdempotencyKey !== input.idempotencyKey ||
                    existingByKey?.validationDispatchCandidateHash !==
                      candidate.validationDispatchCandidateHash ||
                    existingAuthorization?.validationDispatchCandidateHash !==
                      candidate.validationDispatchCandidateHash ||
                    existingDispatch?.validationDispatchCandidateHash !==
                      candidate.validationDispatchCandidateHash ||
                    existingHeartbeat?.validationDispatchCandidateHash !==
                      candidate.validationDispatchCandidateHash ||
                    existingRun?.validationDispatchCandidateHash !==
                      candidate.validationDispatchCandidateHash ||
                    existingEvidence.authorizationRequestHash !== authorizationRequestHash ||
                    existingEvidence.authorizedByReference !==
                      authorization.authorizedByReference ||
                    existingEvidence.authorizationIssuedAt.getTime() !==
                      authorizationIssuedAt.getTime() ||
                    existingEvidence.authorizationExpiresAt.getTime() !==
                      authorizationExpiresAt.getTime() ||
                    existingEvidence.signedEnvelopeDigest !== signedEnvelopeDigest ||
                    existingEvidence.authenticationTagDigest !== authenticationTagDigest
                  )
                    throw new AcpBridgeAdmissionConflictError(
                      'Codex validation dispatch replay drifted',
                    );
                  return {
                    runtime,
                    connection,
                    run,
                    evidence: existingEvidence,
                    frame: Object.freeze(frame),
                    replayed: true,
                  };
                }
                if (existingAuthorization || existingDispatch || existingHeartbeat || existingRun)
                  throw new AcpBridgeAdmissionConflictError(
                    'Codex validation dispatch identity already used',
                  );
                const [evidence] = await tx.$queryRaw<CodexValidationDispatchEvidenceRow[]>(
                  Prisma.sql`
                    INSERT INTO "acp_codex_validation_dispatch_evidence" (
                      "workspaceId", "validationDispatchCandidateHash", "heartbeatCandidateHash",
                      "registrationCandidateHash", "capabilityCandidateHash", "runtimeId",
                      "connectionId", "sessionId", "principalReference", "adapterKind",
                      "authGeneration", "bridgeIdentityHash", "secretBindingHash",
                      "capabilityDigest", "dispatchId", "taskId", "runId", "agentId",
                      "authorityLevel", "taskPolicyHash", "maximumComputeUnits",
                      "maximumCostMinorUnits", "maximumDurationMs", "outboundSequence",
                      "messageId", "challengeCode",
                      "payloadDigest", "unsignedEnvelopeDigest", "signedEnvelopeDigest",
                      "authenticationTagDigest", "issuedAt", "expiresAt", "authorizationId",
                      "authorizationRequestHash", "authorizedByReference",
                      "authorizationIssuedAt", "authorizationExpiresAt", "dispatchIdempotencyKey"
                    ) VALUES (
                      CAST(${context.workspaceId} AS uuid),
                      ${candidate.validationDispatchCandidateHash},
                      ${candidate.heartbeatCandidateHash}, ${candidate.registrationCandidateHash},
                      ${candidate.capabilityCandidateHash}, ${candidate.runtimeId},
                      ${candidate.connectionId}, ${candidate.sessionId},
                      ${candidate.principalReference}, ${candidate.adapterKind},
                      ${candidate.authGeneration}, ${candidate.bridgeIdentityHash},
                      ${candidate.secretBindingHash}, ${candidate.capabilityDigest},
                      ${candidate.dispatchId}, ${candidate.taskId}, ${candidate.runId},
                      ${candidate.agentId}, ${candidate.authorityLevel},
                      ${candidate.taskPolicyHash}, ${candidate.maximumComputeUnits},
                      ${candidate.maximumCostMinorUnits},
                      ${candidate.maximumDurationMs}, ${candidate.outboundSequence},
                      ${candidate.messageId}, ${candidate.challengeCode},
                      ${candidate.payloadDigest}, ${candidate.unsignedEnvelopeDigest},
                      ${signedEnvelopeDigest}, ${authenticationTagDigest}, ${issuedAt}, ${expiresAt},
                      ${authorization.authorizationId}, ${authorizationRequestHash},
                      ${authorization.authorizedByReference}, ${authorizationIssuedAt},
                      ${authorizationExpiresAt}, ${input.idempotencyKey}
                    ) RETURNING *
                  `,
                );
                if (!evidence)
                  throw new AcpBridgeAdmissionConflictError(
                    'Codex validation dispatch evidence was not stored',
                  );
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
                    subjectType: 'AcpCodexValidationDispatchEvidence',
                    subjectId: candidate.validationDispatchCandidateHash,
                    occurredAt: now.toISOString(),
                    idempotencyKey: `${input.idempotencyKey}:event`,
                    correlationId: candidate.runId,
                    facts: { payloadFieldCount: 0, payloadBytes: 0 },
                  },
                  actorKind === 'HUMAN' ? context.principalId : undefined,
                  tx,
                );
                return {
                  runtime,
                  connection,
                  run,
                  evidence,
                  frame: Object.freeze(frame),
                  replayed: false,
                };
              } finally {
                keys.parentToRuntime.fill(0);
                keys.runtimeToParent.fill(0);
              }
            },
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex validation dispatch conflict; retry with current durable state',
        );
      throw error;
    }
  }

  /**
   * Claims the only local-write opportunity for one prepared Codex validation
   * frame. The claim is one-shot because a failed or timed-out local write can
   * be ambiguous; callers must prepare a new validation run instead of retrying.
   */
  async claimCodexValidationEgressHandoff(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ClaimCodexValidationEgressHandoffInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    auditSubjectReference(input.attemptId, 'attemptId');
    digest(input.validationDispatchCandidateHash, 'validationDispatchCandidateHash');
    publicReference(input.idempotencyKey, 'idempotencyKey');
    for (const [field, value] of Object.entries({
      workspaceId: input.bridge.workspaceId,
      runtimeId: input.bridge.runtimeId,
      connectionId: input.bridge.connectionId,
      sessionId: input.bridge.sessionId,
      principalReference: input.bridge.principalReference,
      parentNonce: input.bridge.parentNonce,
      runtimeNonce: input.bridge.runtimeNonce,
      secretReference: input.bridge.secretReference,
    }))
      reference(value, field);
    digest(input.bridge.expectedSecretDigest, 'expectedSecretDigest');
    if (input.bridge.schemaVersion !== 1 || input.bridge.authGeneration !== 1)
      throw new AcpBridgeAdmissionDeniedError('Codex validation egress bridge is invalid');
    const authenticatedAt = new Date(input.bridge.authenticatedAt);
    const bridgeExpiresAt = new Date(input.bridge.expiresAt);
    if (
      !Number.isFinite(authenticatedAt.getTime()) ||
      authenticatedAt.toISOString() !== input.bridge.authenticatedAt ||
      !Number.isFinite(bridgeExpiresAt.getTime()) ||
      bridgeExpiresAt.toISOString() !== input.bridge.expiresAt
    )
      throw new AcpBridgeAdmissionDeniedError('Codex validation egress bridge window is invalid');
    const bridgeIdentityHash = sha256({
      authGeneration: input.bridge.authGeneration,
      authenticatedAt: input.bridge.authenticatedAt,
      connectionId: input.bridge.connectionId,
      expectedSecretDigest: input.bridge.expectedSecretDigest,
      expiresAt: input.bridge.expiresAt,
      parentNonce: input.bridge.parentNonce,
      principalReference: input.bridge.principalReference,
      runtimeNonce: input.bridge.runtimeNonce,
      runtimeId: input.bridge.runtimeId,
      secretReference: input.bridge.secretReference,
      sessionId: input.bridge.sessionId,
      workspaceId: input.bridge.workspaceId,
    });
    const secretBindingHash = sha256({
      expectedSecretDigest: input.bridge.expectedSecretDigest,
      secretReference: input.bridge.secretReference,
    });

    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "validationDispatchCandidateHash" FROM "acp_codex_validation_dispatch_evidence" WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "validationDispatchCandidateHash"=${input.validationDispatchCandidateHash} FOR UPDATE`,
          );
          const [evidenceRows, existingRows] = await Promise.all([
            tx.$queryRaw<CodexValidationDispatchEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_dispatch_evidence"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "validationDispatchCandidateHash"=${input.validationDispatchCandidateHash}
              FOR SHARE
            `),
            tx.$queryRaw<CodexValidationEgressHandoffRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_egress_handoff_attempts"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND (
                  "id"=${input.attemptId}
                  OR "validationDispatchCandidateHash"=${input.validationDispatchCandidateHash}
                  OR "claimIdempotencyKey"=${input.idempotencyKey}
                )
              FOR SHARE
            `),
          ]);
          const evidence = evidenceRows[0];
          if (!evidence)
            throw new AcpBridgeAdmissionNotFoundError('Codex validation dispatch not found');
          const [connection, run, now] = await Promise.all([
            tx.acpRuntimeConnection.findUnique({
              where: {
                workspaceId_id: { workspaceId: context.workspaceId, id: evidence.connectionId },
              },
              include: { runtime: true },
            }),
            tx.acpRun.findUnique({
              where: { workspaceId_id: { workspaceId: context.workspaceId, id: evidence.runId } },
              include: { task: { include: { objective: true } } },
            }),
            databaseNow(tx),
          ]);
          if (!connection || !run)
            throw new AcpBridgeAdmissionNotFoundError('Codex validation egress state not found');
          const existingById = existingRows.find((row) => row.id === input.attemptId);
          const existingByCandidate = existingRows.find(
            (row) => row.validationDispatchCandidateHash === input.validationDispatchCandidateHash,
          );
          const existingByKey = existingRows.find(
            (row) => row.claimIdempotencyKey === input.idempotencyKey,
          );
          const existing = existingById ?? existingByCandidate ?? existingByKey;
          if (
            existing &&
            (existing.id !== input.attemptId ||
              existing.validationDispatchCandidateHash !== input.validationDispatchCandidateHash ||
              existing.claimIdempotencyKey !== input.idempotencyKey ||
              existing.ownerReference !== context.principalId ||
              existing.ownerActorKind !== actorKind)
          )
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation egress handoff replay drifted',
            );
          if (existing)
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation egress handoff is one-shot and cannot be replayed',
            );
          const routingPolicy = run.task.routingPolicy as Record<string, unknown>;
          const agentPolicy = run.task.agentPolicy as Record<string, unknown>;
          if (
            !routingPolicy ||
            typeof routingPolicy !== 'object' ||
            Array.isArray(routingPolicy) ||
            JSON.stringify(Object.keys(routingPolicy).sort()) !==
              JSON.stringify(['capabilityId', 'maximumLatencyMs']) ||
            !agentPolicy ||
            typeof agentPolicy !== 'object' ||
            Array.isArray(agentPolicy) ||
            JSON.stringify(Object.keys(agentPolicy).sort()) !==
              JSON.stringify(['scopes', 'templateId']) ||
            evidence.workspaceId !== context.workspaceId ||
            evidence.runtimeId !== input.bridge.runtimeId ||
            evidence.connectionId !== input.bridge.connectionId ||
            evidence.sessionId !== input.bridge.sessionId ||
            evidence.principalReference !== input.bridge.principalReference ||
            evidence.authGeneration !== input.bridge.authGeneration ||
            evidence.bridgeIdentityHash !== bridgeIdentityHash ||
            evidence.secretBindingHash !== secretBindingHash ||
            evidence.expiresAt <= now ||
            evidence.authorizationExpiresAt <= now ||
            evidence.maximumCostMinorUnits !== 0 ||
            evidence.authorityLevel >= 4 ||
            evidence.outboundSequence !== 1 ||
            evidence.messageId !== evidence.dispatchId ||
            evidence.challengeCode !== CODEX_VALIDATION_CHALLENGE ||
            connection.runtimeId !== evidence.runtimeId ||
            connection.runtime.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
            connection.runtime.status !== 'NOT_CONFIGURED' ||
            connection.runtime.secretReference !== input.bridge.secretReference ||
            connection.runtime.secretDigest !== input.bridge.expectedSecretDigest ||
            connection.status !== 'NOT_CONFIGURED' ||
            connection.authGeneration !== 1 ||
            connection.capabilityCodes.length !== 0 ||
            connection.capabilityDigest !== null ||
            connection.lastHeartbeatAt !== null ||
            connection.lastHeartbeatHealth !== null ||
            connection.lastHeartbeatSequence !== null ||
            run.id !== evidence.runId ||
            run.workspaceId !== context.workspaceId ||
            run.taskId !== evidence.taskId ||
            run.objectiveId !== run.task.objectiveId ||
            run.status !== 'PREPARED' ||
            run.task.status !== 'READY' ||
            run.task.kind !== 'quality.verify' ||
            run.requiredAuthority !== evidence.authorityLevel ||
            run.task.requiredAuthority !== evidence.authorityLevel ||
            run.policyHash !== evidence.taskPolicyHash ||
            run.task.policyHash !== evidence.taskPolicyHash ||
            run.policyVersion !== run.task.policyVersion ||
            run.task.maximumCostMinorUnits !== 0n ||
            run.task.maximumComputeUnits !== BigInt(evidence.maximumComputeUnits) ||
            run.task.estimatedDurationMs !== BigInt(evidence.maximumDurationMs) ||
            run.task.objective.status !== 'ACTIVE' ||
            run.task.objective.maximumAuthority < evidence.authorityLevel ||
            run.task.objective.maximumCostMinorUnits !== 0n ||
            run.task.objective.maximumComputeUnits < BigInt(evidence.maximumComputeUnits) ||
            run.assignedAgentId !== null ||
            run.assignedRuntimeId !== null ||
            run.assignedConnectionId !== null ||
            run.task.assignedAgentId !== null ||
            run.task.assignedRuntimeId !== null ||
            run.task.assignedConnectionId !== null ||
            routingPolicy.capabilityId !== CODEX_VALIDATION_CHALLENGE ||
            routingPolicy.maximumLatencyMs !== evidence.maximumDurationMs ||
            agentPolicy.templateId !== 'codex-runtime-validator' ||
            !Array.isArray(agentPolicy.scopes) ||
            JSON.stringify(agentPolicy.scopes) !== JSON.stringify([CODEX_VALIDATION_CHALLENGE])
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation egress durable authority is not live',
            );
          const candidate = validateCodexValidationDispatchCandidate({
            schemaVersion: 1,
            adapterKind: evidence.adapterKind,
            workspaceId: evidence.workspaceId,
            runtimeId: evidence.runtimeId,
            connectionId: evidence.connectionId,
            sessionId: evidence.sessionId,
            principalReference: evidence.principalReference,
            authGeneration: evidence.authGeneration,
            registrationCandidateHash: evidence.registrationCandidateHash,
            capabilityCandidateHash: evidence.capabilityCandidateHash,
            heartbeatCandidateHash: evidence.heartbeatCandidateHash,
            capabilityDigest: evidence.capabilityDigest,
            bridgeIdentityHash: evidence.bridgeIdentityHash,
            secretBindingHash: evidence.secretBindingHash,
            dispatchId: evidence.dispatchId,
            taskId: evidence.taskId,
            runId: evidence.runId,
            agentId: evidence.agentId,
            authorityLevel: evidence.authorityLevel,
            taskPolicyHash: evidence.taskPolicyHash,
            maximumCostMinorUnits: evidence.maximumCostMinorUnits,
            maximumComputeUnits: evidence.maximumComputeUnits,
            maximumDurationMs: evidence.maximumDurationMs,
            outboundSequence: evidence.outboundSequence,
            messageId: evidence.messageId,
            challengeCode: evidence.challengeCode,
            payloadDigest: evidence.payloadDigest,
            unsignedEnvelopeDigest: evidence.unsignedEnvelopeDigest,
            issuedAt: evidence.issuedAt.toISOString(),
            expiresAt: evidence.expiresAt.toISOString(),
            assignmentState: 'NOT_CONFIGURED',
            deliveryState: 'NOT_SENT',
            providerAccess: 'NOT_CONFIGURED',
            runtimeConnection: 'NOT_CONFIGURED',
            validationDispatchCandidateHash: evidence.validationDispatchCandidateHash,
          });
          return this.withSecretLease(
            {
              workspaceId: context.workspaceId,
              runtimeId: evidence.runtimeId,
              connectionId: evidence.connectionId,
              secretReference: input.bridge.secretReference,
              expectedDigest: input.bridge.expectedSecretDigest,
              authGeneration: 1,
              purpose: 'SIGN_FRAME',
            },
            async (secret) => {
              const keys = deriveBridgeKeys(secret, input.bridge);
              try {
                const frame = signBridgeEnvelope(
                  codexValidationDispatchUnsignedEnvelope(candidate),
                  keys.parentToRuntime,
                );
                const signedEnvelopeDigest = sha256(frame);
                const authenticationTagDigest = createHash('sha256')
                  .update(frame.mac)
                  .digest('hex');
                if (
                  signedEnvelopeDigest !== evidence.signedEnvelopeDigest ||
                  authenticationTagDigest !== evidence.authenticationTagDigest
                )
                  throw new AcpBridgeAdmissionConflictError(
                    'Codex validation egress frame drifted',
                  );
                const claimedAt = now;
                const expiresAt = new Date(
                  Math.min(evidence.expiresAt.getTime(), now.getTime() + 15_000),
                );
                if (expiresAt <= now)
                  throw new AcpBridgeAdmissionDeniedError(
                    'Codex validation egress authority expired',
                  );
                const values = {
                  id: input.attemptId,
                  validationDispatchCandidateHash: evidence.validationDispatchCandidateHash,
                  heartbeatCandidateHash: evidence.heartbeatCandidateHash,
                  ownerReference: context.principalId,
                  ownerActorKind: actorKind,
                  claimIdempotencyKey: input.idempotencyKey,
                  generation: 1,
                  state: 'CLAIMED',
                  runtimeId: evidence.runtimeId,
                  connectionId: evidence.connectionId,
                  sessionId: evidence.sessionId,
                  dispatchId: evidence.dispatchId,
                  taskId: evidence.taskId,
                  runId: evidence.runId,
                  agentId: evidence.agentId,
                  authorityLevel: evidence.authorityLevel,
                  taskPolicyHash: evidence.taskPolicyHash,
                  maximumComputeUnits: evidence.maximumComputeUnits,
                  maximumCostMinorUnits: evidence.maximumCostMinorUnits,
                  maximumDurationMs: evidence.maximumDurationMs,
                  outboundSequence: evidence.outboundSequence,
                  messageId: evidence.messageId,
                  challengeCode: evidence.challengeCode,
                  payloadDigest: evidence.payloadDigest,
                  unsignedEnvelopeDigest: evidence.unsignedEnvelopeDigest,
                  signedEnvelopeDigest,
                  authenticationTagDigest,
                  validationIssuedAt: evidence.issuedAt,
                  validationExpiresAt: evidence.expiresAt,
                  claimedAt,
                  expiresAt,
                };
                const [attempt] = await tx.$queryRaw<CodexValidationEgressHandoffRow[]>(Prisma.sql`
                    INSERT INTO "acp_codex_validation_egress_handoff_attempts" (
                      "workspaceId", "id", "validationDispatchCandidateHash",
                      "heartbeatCandidateHash", "ownerReference", "ownerActorKind",
                      "claimIdempotencyKey", "generation", "state", "runtimeId",
                      "connectionId", "sessionId", "dispatchId", "taskId", "runId", "agentId",
                      "authorityLevel", "taskPolicyHash", "maximumComputeUnits",
                      "maximumCostMinorUnits", "maximumDurationMs", "outboundSequence",
                      "messageId", "challengeCode", "payloadDigest", "unsignedEnvelopeDigest",
                      "signedEnvelopeDigest", "authenticationTagDigest", "validationIssuedAt",
                      "validationExpiresAt", "claimedAt", "expiresAt"
                    ) VALUES (
                      CAST(${context.workspaceId} AS uuid), ${values.id},
                      ${values.validationDispatchCandidateHash}, ${values.heartbeatCandidateHash},
                      ${values.ownerReference}, ${values.ownerActorKind},
                      ${values.claimIdempotencyKey}, ${values.generation}, ${values.state},
                      ${values.runtimeId}, ${values.connectionId}, ${values.sessionId},
                      ${values.dispatchId}, ${values.taskId}, ${values.runId}, ${values.agentId},
                      ${values.authorityLevel}, ${values.taskPolicyHash},
                      ${values.maximumComputeUnits}, ${values.maximumCostMinorUnits},
                      ${values.maximumDurationMs}, ${values.outboundSequence},
                      ${values.messageId}, ${values.challengeCode}, ${values.payloadDigest},
                      ${values.unsignedEnvelopeDigest}, ${values.signedEnvelopeDigest},
                      ${values.authenticationTagDigest}, ${values.validationIssuedAt},
                      ${values.validationExpiresAt}, ${values.claimedAt}, ${values.expiresAt}
                    ) RETURNING *
                  `);
                if (!attempt)
                  throw new AcpBridgeAdmissionConflictError(
                    'Codex validation egress handoff was not stored',
                  );
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
                    subjectType: 'AcpCodexValidationEgressHandoffAttempt',
                    subjectId: attempt.id,
                    occurredAt: claimedAt.toISOString(),
                    idempotencyKey: `${input.idempotencyKey}:event`,
                    correlationId: evidence.runId,
                    facts: { payloadFieldCount: 0, payloadBytes: 0 },
                  },
                  actorKind === 'HUMAN' ? context.principalId : undefined,
                  tx,
                );
                return Object.freeze({
                  attempt: Object.freeze({ ...attempt, schemaVersion: 1 as const }),
                  frame: Object.freeze(frame),
                  replayed: false,
                });
              } finally {
                keys.parentToRuntime.fill(0);
                keys.runtimeToParent.fill(0);
              }
            },
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex validation egress handoff conflict',
        );
      throw error;
    }
  }

  /**
   * Binds the runtime-side fail-closed authority port to the exact durable
   * Level-3 claim/completion operations. This grants no owner, stream, secret,
   * transport, provider, or runtime-status authority.
   */
  createCodexValidationProcessSessionAuthority(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    identity: CodexValidationProcessSessionAuthorityIdentity,
  ): Readonly<CodexValidationProcessSessionAuthority> {
    assertControlPlane(capability, context, 3);
    auditSubjectReference(identity.claimId, 'claimId');
    auditSubjectReference(identity.handoffAttemptId, 'handoffAttemptId');
    publicReference(identity.claimIdempotencyKey, 'claimIdempotencyKey');
    publicReference(identity.completionIdempotencyKey, 'completionIdempotencyKey');
    const boundContext = Object.freeze({
      workspaceId: context.workspaceId,
      principalId: context.principalId,
    });
    const boundIdentity = Object.freeze({
      claimId: identity.claimId,
      handoffAttemptId: identity.handoffAttemptId,
      claimIdempotencyKey: identity.claimIdempotencyKey,
      completionIdempotencyKey: identity.completionIdempotencyKey,
    });
    const authority: CodexValidationProcessSessionAuthority = {
      claim: async ({ binding, dispatch }) => {
        await this.claimCodexValidationProcessSession(capability, boundContext, {
          claimId: boundIdentity.claimId,
          handoffAttemptId: boundIdentity.handoffAttemptId,
          dispatch,
          binding,
          idempotencyKey: boundIdentity.claimIdempotencyKey,
        });
      },
      complete: async ({ binding, dispatch, cleanup }) => {
        let validatedBinding: Readonly<SupervisorProcessBinding>;
        try {
          validatedBinding = validateSupervisorProcessBinding(binding);
        } catch {
          throw new AcpBridgeAdmissionDeniedError(
            'Codex validation process-session authority binding is invalid',
          );
        }
        if (canonicalJson(validatedBinding) !== canonicalJson(cleanup.binding))
          throw new AcpBridgeAdmissionDeniedError(
            'Codex validation process-session authority binding drifted',
          );
        await this.completeCodexValidationProcessSession(capability, boundContext, {
          claimId: boundIdentity.claimId,
          dispatch,
          cleanup,
          idempotencyKey: boundIdentity.completionIdempotencyKey,
        });
      },
    };
    return Object.freeze(authority);
  }

  /**
   * Snapshots one active recovery work item and its exact durable dispatch for
   * the coordinator completion port. This grants no evidence or process authority.
   */
  createCodexValidationProcessSessionRecoveryCompletionAuthority(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    identity: CodexValidationProcessSessionRecoveryCompletionAuthorityIdentity,
  ): Readonly<CodexValidationProcessSessionRecoveryCompletionAuthority> {
    assertControlPlane(capability, context, 3);
    publicReference(identity.completionIdempotencyKey, 'completionIdempotencyKey');
    let workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>;
    let dispatch: Readonly<CodexValidationDispatchCandidate>;
    try {
      workItem = validateCodexValidationProcessSessionRecoveryWorkItem(identity.workItem);
      dispatch = validateCodexValidationDispatchCandidate(identity.dispatch);
    } catch {
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session recovery authority identity is invalid',
      );
    }
    if (
      workItem.binding.workspaceId !== context.workspaceId ||
      dispatch.workspaceId !== context.workspaceId ||
      workItem.binding.runtimeId !== dispatch.runtimeId ||
      workItem.binding.connectionId !== dispatch.connectionId ||
      workItem.sessionId !== dispatch.sessionId ||
      workItem.dispatchId !== dispatch.dispatchId ||
      workItem.runId !== dispatch.runId ||
      workItem.validationDispatchCandidateHash !== dispatch.validationDispatchCandidateHash
    )
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session recovery authority crossed its durable binding',
      );
    const boundContext = Object.freeze({
      workspaceId: context.workspaceId,
      principalId: context.principalId,
    });
    const boundWorkItem = workItem;
    const boundDispatch = dispatch;
    const boundIdempotencyKey = identity.completionIdempotencyKey;
    return Object.freeze({
      complete: async (
        request: Readonly<CodexValidationProcessSessionRecoveryCompletionRequest>,
      ) => {
        if (request.runtimeConnection !== 'NOT_CONFIGURED')
          throw new AcpBridgeAdmissionDeniedError(
            'Codex validation process-session recovery authority cannot promote runtime truth',
          );
        let requestedWorkItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>;
        let exitEvidence: Readonly<CodexValidationProcessSessionRecoveryExitEvidence>;
        try {
          requestedWorkItem = validateCodexValidationProcessSessionRecoveryWorkItem(
            request.workItem,
          );
          exitEvidence = validateCodexValidationProcessSessionRecoveryExitEvidence(
            request.exitEvidence,
            requestedWorkItem,
          );
        } catch {
          throw new AcpBridgeAdmissionDeniedError(
            'Codex validation process-session recovery authority evidence is invalid',
          );
        }
        if (canonicalJson(requestedWorkItem) !== canonicalJson(boundWorkItem))
          throw new AcpBridgeAdmissionDeniedError(
            'Codex validation process-session recovery authority identity drifted',
          );
        await this.completeCodexValidationProcessSessionRecovery(capability, boundContext, {
          workItem: boundWorkItem,
          exitEvidence,
          dispatch: boundDispatch,
          idempotencyKey: boundIdempotencyKey,
        });
      },
    });
  }

  /**
   * Binds one active durable lease bundle to one coordinator attempt. The
   * default evidence source denies, and the returned port accepts no caller input.
   */
  createCodexValidationProcessSessionRecoveryExecutionAuthority(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    identity: CodexValidationProcessSessionRecoveryExecutionAuthorityIdentity,
    evidenceSource: CodexValidationProcessSessionRecoveryEvidenceSource = new DenyCodexValidationProcessSessionRecoveryEvidenceSource(),
    clock: () => Date = () => new Date(),
  ): Readonly<CodexValidationProcessSessionRecoveryExecutionAuthority> {
    const actorKind = assertControlPlane(capability, context, 3);
    const completionAuthority = this.createCodexValidationProcessSessionRecoveryCompletionAuthority(
      capability,
      context,
      identity,
    );
    const workItem = validateCodexValidationProcessSessionRecoveryWorkItem(identity.workItem);
    const lease = identity.lease;
    if (
      lease.schemaVersion !== 1 ||
      lease.recoveryLeaseId !== workItem.recoveryLeaseId ||
      lease.claimId !== workItem.claimId ||
      lease.ownerReference !== context.principalId ||
      lease.ownerActorKind !== actorKind ||
      lease.generation !== workItem.recoveryGeneration ||
      lease.leaseState !== 'ACTIVE' ||
      lease.claimExpiresAt !== workItem.processExpiresAt ||
      lease.claimedAt !== workItem.leaseClaimedAt ||
      lease.expiresAt !== workItem.leaseExpiresAt ||
      lease.runtimeConnection !== 'NOT_CONFIGURED'
    )
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session recovery execution crossed its lease bundle',
      );
    const coordinator = new BoundedCodexValidationProcessSessionRecoveryCoordinator(
      evidenceSource,
      completionAuthority,
      clock,
    );
    let started = false;
    return Object.freeze({
      execute: async () => {
        if (started)
          throw new AcpBridgeAdmissionConflictError(
            'Codex validation process-session recovery execution was already attempted',
          );
        started = true;
        return coordinator.execute(workItem);
      },
    });
  }

  /**
   * Claims one exact durable recovery bundle and immediately consumes that
   * bundle through the bounded execution authority. No caller-selected work
   * item can be introduced between the durable claim and observation.
   */
  async executeCodexValidationProcessSessionRecovery(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ExecuteCodexValidationProcessSessionRecoveryInput,
    evidenceSource: CodexValidationProcessSessionRecoveryEvidenceSource = new DenyCodexValidationProcessSessionRecoveryEvidenceSource(),
    clock: () => Date = () => new Date(),
  ): Promise<Readonly<CodexValidationProcessSessionRecoveryExecutionResult>> {
    assertControlPlane(capability, context, 3);
    publicReference(input.completionIdempotencyKey, 'completionIdempotencyKey');
    const bundle = await this.claimCodexValidationProcessSessionRecoveryLease(
      capability,
      context,
      Object.freeze({
        recoveryLeaseId: input.recoveryLeaseId,
        claimId: input.claimId,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    if (bundle.lease.leaseState === 'EXPIRED') {
      if (bundle.workItem !== null || bundle.dispatch !== null)
        throw new AcpBridgeAdmissionDeniedError(
          'Expired Codex validation process-session recovery returned executable authority',
        );
      return Object.freeze({
        lease: bundle.lease,
        replayed: bundle.replayed,
        execution: null,
        recoveryState: 'LEASE_EXPIRED' as const,
        runtimeConnection: 'NOT_CONFIGURED' as const,
        connectionTransition: 'NOT_APPLIED' as const,
      });
    }
    if (bundle.workItem === null || bundle.dispatch === null)
      throw new AcpBridgeAdmissionDeniedError(
        'Active Codex validation process-session recovery omitted executable authority',
      );
    const authority = this.createCodexValidationProcessSessionRecoveryExecutionAuthority(
      capability,
      context,
      {
        lease: bundle.lease,
        workItem: bundle.workItem,
        dispatch: bundle.dispatch,
        completionIdempotencyKey: input.completionIdempotencyKey,
      },
      evidenceSource,
      clock,
    );
    const execution = await authority.execute();
    return Object.freeze({
      lease: bundle.lease,
      replayed: bundle.replayed,
      execution,
      recoveryState: 'RECORDED' as const,
      runtimeConnection: 'NOT_CONFIGURED' as const,
      connectionTransition: 'NOT_APPLIED' as const,
    });
  }

  /**
   * Lists a bounded owner-scoped snapshot of durable claims that have no
   * matching cleanup completion. This is recovery discovery only: it cannot
   * open, signal, terminate, retry, or promote a runtime.
   */
  async listCodexValidationProcessSessionRecoveryInventory(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ListCodexValidationProcessSessionRecoveryInput,
  ): Promise<Readonly<CodexValidationProcessSessionRecoveryPage>> {
    const actorKind = assertControlPlane(capability, context, 3);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session recovery limit is invalid',
      );
    if (input.afterClaimId !== undefined) auditSubjectReference(input.afterClaimId, 'afterClaimId');
    const afterClaimId = input.afterClaimId ?? '';
    const [rows, observedAt] = await prisma.$transaction(async (tx) =>
      Promise.all([
        tx.$queryRaw<CodexValidationProcessSessionRecoveryRow[]>(Prisma.sql`
          SELECT claim.*,
            CASE WHEN claim."expiresAt" <= CURRENT_TIMESTAMP THEN 'EXPIRED' ELSE 'ACTIVE' END
              AS "recoveryState"
          FROM "acp_codex_validation_process_session_claims" claim
          LEFT JOIN "acp_codex_validation_process_session_completions" completion
            ON completion."workspaceId" = claim."workspaceId"
            AND completion."claimId" = claim."id"
          WHERE claim."workspaceId" = CAST(${context.workspaceId} AS uuid)
            AND claim."ownerReference" = ${context.principalId}
            AND claim."ownerActorKind" = ${actorKind}
            AND claim."id" > ${afterClaimId}
            AND completion."claimId" IS NULL
          ORDER BY claim."id" ASC
          LIMIT ${input.limit + 1}
        `),
        databaseNow(tx),
      ]),
    );
    const selected = rows.slice(0, input.limit);
    const items = selected.map((row) =>
      Object.freeze({
        schemaVersion: 1 as const,
        claimId: row.id,
        handoffAttemptId: row.handoffAttemptId,
        validationDispatchCandidateHash: row.validationDispatchCandidateHash,
        sessionId: row.sessionId,
        dispatchId: row.dispatchId,
        binding: Object.freeze({
          schemaVersion: 1 as const,
          supervisionId: row.supervisionId,
          launchNonce: row.launchNonce,
          workspaceId: row.workspaceId,
          runtimeId: row.runtimeId,
          connectionId: row.connectionId,
          platform: row.platform as SupervisorProcessBinding['platform'],
          manifestHash: row.manifestHash,
          admissionEvidenceHash: row.admissionEvidenceHash,
          admissionBindingHash: row.admissionBindingHash,
          testOnly: row.testOnly,
        }),
        recoveryState: row.recoveryState,
        claimedAt: row.claimedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        runtimeConnection: 'NOT_CONFIGURED' as const,
      }),
    );
    return Object.freeze({
      schemaVersion: 1 as const,
      items: Object.freeze(items),
      nextCursor: rows.length > input.limit ? (items.at(-1)?.claimId ?? null) : null,
      observedAt: observedAt.toISOString(),
      runtimeConnection: 'NOT_CONFIGURED' as const,
    });
  }

  /**
   * Claims one short, append-only recovery lease for an expired unfinished
   * process session. This serializes a future recovery owner but cannot open,
   * signal, terminate, retry, launch, or promote a runtime.
   */
  async claimCodexValidationProcessSessionRecoveryLease(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ClaimCodexValidationProcessSessionRecoveryLeaseInput,
  ): Promise<Readonly<CodexValidationProcessSessionRecoveryLeaseBundle>> {
    const actorKind = assertControlPlane(capability, context, 3);
    auditSubjectReference(input.recoveryLeaseId, 'recoveryLeaseId');
    auditSubjectReference(input.claimId, 'claimId');
    publicReference(input.idempotencyKey, 'idempotencyKey');

    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_codex_validation_process_session_claims" WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "id"=${input.claimId} FOR UPDATE`,
          );
          const [claimRows, dispatchRows, completionRows, existingRows, latestRows, now] =
            await Promise.all([
              tx.$queryRaw<CodexValidationProcessSessionRecoveryClaimRow[]>(Prisma.sql`
              SELECT claim.*, dispatch."runId"
              FROM "acp_codex_validation_process_session_claims" claim
              JOIN "acp_codex_validation_dispatch_evidence" dispatch
                ON dispatch."workspaceId" = claim."workspaceId"
                AND dispatch."validationDispatchCandidateHash" =
                  claim."validationDispatchCandidateHash"
              WHERE claim."workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND claim."id"=${input.claimId}
              FOR SHARE OF claim, dispatch
            `),
              tx.$queryRaw<CodexValidationDispatchEvidenceRow[]>(Prisma.sql`
              SELECT dispatch.*
              FROM "acp_codex_validation_dispatch_evidence" dispatch
              JOIN "acp_codex_validation_process_session_claims" claim
                ON claim."workspaceId" = dispatch."workspaceId"
                AND claim."validationDispatchCandidateHash" =
                  dispatch."validationDispatchCandidateHash"
              WHERE claim."workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND claim."id"=${input.claimId}
              FOR SHARE OF dispatch
            `),
              tx.$queryRaw<CodexValidationProcessSessionCompletionRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_completions"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "claimId"=${input.claimId}
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationProcessSessionRecoveryLeaseRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_recovery_leases"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND ("id"=${input.recoveryLeaseId} OR
                  "recoveryIdempotencyKey"=${input.idempotencyKey})
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationProcessSessionRecoveryLeaseRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_recovery_leases"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "claimId"=${input.claimId}
              ORDER BY "generation" DESC
              LIMIT 1
              FOR SHARE
            `),
              databaseNow(tx),
            ]);
          const claim = claimRows[0];
          const durableDispatch = dispatchRows[0];
          if (!claim || !durableDispatch)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation process-session recovery claim or dispatch not found',
            );
          if (
            claim.ownerReference !== context.principalId ||
            claim.ownerActorKind !== actorKind ||
            claim.state !== 'CLAIMED' ||
            claim.runtimeConnection !== 'NOT_CONFIGURED'
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session recovery crossed owner authority',
            );
          const recoveryDispatch = recoveryDispatchCandidateFromRow(durableDispatch);
          if (
            recoveryDispatch.workspaceId !== context.workspaceId ||
            recoveryDispatch.validationDispatchCandidateHash !==
              claim.validationDispatchCandidateHash ||
            recoveryDispatch.runtimeId !== claim.runtimeId ||
            recoveryDispatch.connectionId !== claim.connectionId ||
            recoveryDispatch.sessionId !== claim.sessionId ||
            recoveryDispatch.dispatchId !== claim.dispatchId ||
            recoveryDispatch.runId !== claim.runId
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session recovery dispatch crossed durable authority',
            );
          let recoveryBinding: Readonly<SupervisorProcessBinding>;
          try {
            recoveryBinding = validateSupervisorProcessBinding({
              schemaVersion: 1,
              supervisionId: claim.supervisionId,
              launchNonce: claim.launchNonce,
              workspaceId: claim.workspaceId,
              runtimeId: claim.runtimeId,
              connectionId: claim.connectionId,
              platform: claim.platform,
              manifestHash: claim.manifestHash,
              admissionEvidenceHash: claim.admissionEvidenceHash,
              admissionBindingHash: claim.admissionBindingHash,
              testOnly: claim.testOnly,
            });
          } catch {
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session recovery binding is invalid',
            );
          }
          const workItemFor = (
            lease: Readonly<CodexValidationProcessSessionRecoveryLeaseRow>,
          ): Readonly<CodexValidationProcessSessionRecoveryWorkItem> => {
            const candidate = Object.freeze({
              schemaVersion: 1 as const,
              recoveryLeaseId: lease.id,
              recoveryGeneration: lease.generation,
              claimId: claim.id,
              handoffAttemptId: claim.handoffAttemptId,
              validationDispatchCandidateHash: claim.validationDispatchCandidateHash,
              sessionId: claim.sessionId,
              dispatchId: claim.dispatchId,
              runId: claim.runId,
              binding: recoveryBinding,
              processClaimedAt: claim.claimedAt.toISOString(),
              processExpiresAt: claim.expiresAt.toISOString(),
              leaseClaimedAt: lease.claimedAt.toISOString(),
              leaseExpiresAt: lease.expiresAt.toISOString(),
              runtimeConnection: 'NOT_CONFIGURED' as const,
            });
            try {
              return validateCodexValidationProcessSessionRecoveryWorkItem(candidate, now);
            } catch {
              throw new AcpBridgeAdmissionDeniedError(
                'Codex validation process-session recovery work item is invalid',
              );
            }
          };

          const existingById = existingRows.find((row) => row.id === input.recoveryLeaseId);
          const existingByKey = existingRows.find(
            (row) => row.recoveryIdempotencyKey === input.idempotencyKey,
          );
          const existing = existingById ?? existingByKey;
          if (existing) {
            if (
              existingById?.recoveryIdempotencyKey !== input.idempotencyKey ||
              existingByKey?.id !== input.recoveryLeaseId ||
              existing.claimId !== input.claimId ||
              existing.ownerReference !== context.principalId ||
              existing.ownerActorKind !== actorKind ||
              existing.state !== 'CLAIMED' ||
              existing.runtimeConnection !== 'NOT_CONFIGURED' ||
              existing.claimExpiresAt.getTime() !== claim.expiresAt.getTime() ||
              existing.claimedAt < claim.expiresAt ||
              existing.claimedAt > now ||
              existing.expiresAt.getTime() !== existing.claimedAt.getTime() + 15_000
            )
              throw new AcpBridgeAdmissionConflictError(
                'Codex validation process-session recovery lease replay drifted',
              );
            const workItem =
              completionRows.length === 0 && existing.expiresAt > now
                ? workItemFor(existing)
                : null;
            return Object.freeze({
              lease: Object.freeze({
                schemaVersion: 1 as const,
                recoveryLeaseId: existing.id,
                claimId: existing.claimId,
                ownerReference: existing.ownerReference,
                ownerActorKind: existing.ownerActorKind,
                generation: existing.generation,
                leaseState: existing.expiresAt > now ? ('ACTIVE' as const) : ('EXPIRED' as const),
                claimExpiresAt: existing.claimExpiresAt.toISOString(),
                claimedAt: existing.claimedAt.toISOString(),
                expiresAt: existing.expiresAt.toISOString(),
                runtimeConnection: 'NOT_CONFIGURED' as const,
              }),
              workItem,
              dispatch: workItem ? recoveryDispatch : null,
              replayed: true,
            });
          }
          if (existingRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session recovery lease identity was already used',
            );
          if (completionRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session recovery claim is already complete',
            );
          if (claim.expiresAt > now)
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session recovery claim is still active',
            );
          const latest = latestRows[0];
          if (latest && latest.expiresAt > now)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session recovery lease is already active',
            );
          const generation = (latest?.generation ?? 0) + 1;

          const [lease] = await tx.$queryRaw<CodexValidationProcessSessionRecoveryLeaseRow[]>(
            Prisma.sql`
              INSERT INTO "acp_codex_validation_process_session_recovery_leases" (
                "workspaceId", "id", "claimId", "ownerReference", "ownerActorKind",
                "generation", "state", "runtimeConnection", "recoveryIdempotencyKey",
                "claimExpiresAt"
              ) VALUES (
                CAST(${context.workspaceId} AS uuid), ${input.recoveryLeaseId}, ${claim.id},
                ${context.principalId}, ${actorKind}, ${generation}, 'CLAIMED',
                'NOT_CONFIGURED', ${input.idempotencyKey}, ${claim.expiresAt}
              ) RETURNING *
            `,
          );
          if (!lease)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session recovery lease was not stored',
            );
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
              subjectType: 'AcpCodexValidationProcessSessionRecoveryLease',
              subjectId: lease.id,
              occurredAt: lease.claimedAt.toISOString(),
              idempotencyKey: `${input.idempotencyKey}:event`,
              correlationId: claim.runId,
              facts: { payloadFieldCount: 0, payloadBytes: 0 },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
          return Object.freeze({
            lease: Object.freeze({
              schemaVersion: 1 as const,
              recoveryLeaseId: lease.id,
              claimId: lease.claimId,
              ownerReference: lease.ownerReference,
              ownerActorKind: lease.ownerActorKind,
              generation: lease.generation,
              leaseState: 'ACTIVE' as const,
              claimExpiresAt: lease.claimExpiresAt.toISOString(),
              claimedAt: lease.claimedAt.toISOString(),
              expiresAt: lease.expiresAt.toISOString(),
              runtimeConnection: 'NOT_CONFIGURED' as const,
            }),
            workItem: workItemFor(lease),
            dispatch: recoveryDispatch,
            replayed: false,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex validation process-session recovery lease conflict',
        );
      throw error;
    }
  }

  /**
   * Durably claims one process-session identity before an injected owner may
   * open runtime streams. This records no launch authority and cannot promote
   * runtime truth.
   */
  async claimCodexValidationProcessSession(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: ClaimCodexValidationProcessSessionInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    auditSubjectReference(input.claimId, 'claimId');
    auditSubjectReference(input.handoffAttemptId, 'handoffAttemptId');
    publicReference(input.idempotencyKey, 'idempotencyKey');
    let dispatch: Readonly<CodexValidationDispatchCandidate>;
    let binding: Readonly<SupervisorProcessBinding>;
    try {
      dispatch = validateCodexValidationDispatchCandidate(input.dispatch);
      binding = validateSupervisorProcessBinding(input.binding);
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Codex validation process-session claim is invalid');
    }
    if (
      dispatch.workspaceId !== context.workspaceId ||
      binding.workspaceId !== context.workspaceId ||
      binding.runtimeId !== dispatch.runtimeId ||
      binding.connectionId !== dispatch.connectionId
    )
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session claim crossed its durable binding',
      );

    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_codex_validation_egress_handoff_attempts" WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "id"=${input.handoffAttemptId} FOR UPDATE`,
          );
          const [handoffRows, dispatchRows, existingRows, now] = await Promise.all([
            tx.$queryRaw<CodexValidationEgressHandoffRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_egress_handoff_attempts"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "id"=${input.handoffAttemptId}
              FOR SHARE
            `),
            tx.$queryRaw<CodexValidationDispatchEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_dispatch_evidence"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "validationDispatchCandidateHash"=${dispatch.validationDispatchCandidateHash}
              FOR SHARE
            `),
            tx.$queryRaw<CodexValidationProcessSessionClaimRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_claims"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND (
                  "id"=${input.claimId} OR
                  "handoffAttemptId"=${input.handoffAttemptId} OR
                  "claimIdempotencyKey"=${input.idempotencyKey} OR
                  "supervisionId"=${binding.supervisionId}
                )
              FOR SHARE
            `),
            databaseNow(tx),
          ]);
          const handoff = handoffRows[0];
          const durableDispatch = dispatchRows[0];
          if (!handoff || !durableDispatch)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation handoff or dispatch evidence not found',
            );
          if (
            handoff.validationDispatchCandidateHash !== dispatch.validationDispatchCandidateHash ||
            handoff.ownerReference !== context.principalId ||
            handoff.ownerActorKind !== actorKind ||
            handoff.state !== 'CLAIMED' ||
            handoff.runtimeId !== dispatch.runtimeId ||
            handoff.connectionId !== dispatch.connectionId ||
            handoff.sessionId !== dispatch.sessionId ||
            handoff.dispatchId !== dispatch.dispatchId ||
            handoff.expiresAt <= now ||
            handoff.validationExpiresAt.toISOString() !== dispatch.expiresAt ||
            durableDispatch.validationDispatchCandidateHash !==
              dispatch.validationDispatchCandidateHash ||
            durableDispatch.runtimeId !== dispatch.runtimeId ||
            durableDispatch.connectionId !== dispatch.connectionId ||
            durableDispatch.sessionId !== dispatch.sessionId ||
            durableDispatch.dispatchId !== dispatch.dispatchId ||
            durableDispatch.expiresAt <= now
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session claim authority is not live',
            );

          const existingById = existingRows.find((row) => row.id === input.claimId);
          const existingByHandoff = existingRows.find(
            (row) => row.handoffAttemptId === input.handoffAttemptId,
          );
          const existingByKey = existingRows.find(
            (row) => row.claimIdempotencyKey === input.idempotencyKey,
          );
          const existingBySupervision = existingRows.find(
            (row) => row.supervisionId === binding.supervisionId,
          );
          const existing =
            existingById ?? existingByHandoff ?? existingByKey ?? existingBySupervision;
          if (existing) {
            if (
              existing.id !== input.claimId ||
              existing.claimIdempotencyKey !== input.idempotencyKey ||
              existingById?.claimIdempotencyKey !== input.idempotencyKey ||
              existingByHandoff?.id !== input.claimId ||
              existingByKey?.id !== input.claimId ||
              existingBySupervision?.id !== input.claimId ||
              existing.workspaceId !== context.workspaceId ||
              existing.handoffAttemptId !== input.handoffAttemptId ||
              existing.validationDispatchCandidateHash !==
                dispatch.validationDispatchCandidateHash ||
              existing.runtimeId !== dispatch.runtimeId ||
              existing.connectionId !== dispatch.connectionId ||
              existing.sessionId !== dispatch.sessionId ||
              existing.dispatchId !== dispatch.dispatchId ||
              existing.ownerReference !== context.principalId ||
              existing.ownerActorKind !== actorKind ||
              existing.supervisionId !== binding.supervisionId ||
              existing.launchNonce !== binding.launchNonce ||
              existing.platform !== binding.platform ||
              existing.manifestHash !== binding.manifestHash ||
              existing.admissionEvidenceHash !== binding.admissionEvidenceHash ||
              existing.admissionBindingHash !== binding.admissionBindingHash ||
              existing.testOnly !== binding.testOnly ||
              existing.state !== 'CLAIMED' ||
              existing.runtimeConnection !== 'NOT_CONFIGURED' ||
              existing.claimedAt < handoff.claimedAt ||
              existing.claimedAt > now ||
              existing.claimedAt >= existing.expiresAt ||
              existing.expiresAt.getTime() !== handoff.expiresAt.getTime()
            )
              throw new AcpBridgeAdmissionConflictError(
                'Codex validation process-session claim replay drifted',
              );
            return Object.freeze({
              claim: Object.freeze({ ...existing, schemaVersion: 1 as const }),
              replayed: true,
            });
          }
          if (existingRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session identity was already claimed',
            );

          const [claim] = await tx.$queryRaw<CodexValidationProcessSessionClaimRow[]>(Prisma.sql`
            INSERT INTO "acp_codex_validation_process_session_claims" (
              "workspaceId", "id", "handoffAttemptId", "validationDispatchCandidateHash",
              "runtimeId", "connectionId", "sessionId", "dispatchId", "ownerReference",
              "ownerActorKind", "supervisionId", "launchNonce", "platform", "manifestHash",
              "admissionEvidenceHash", "admissionBindingHash", "testOnly", "state",
              "runtimeConnection", "claimIdempotencyKey", "expiresAt"
            ) VALUES (
              CAST(${context.workspaceId} AS uuid), ${input.claimId}, ${input.handoffAttemptId},
              ${dispatch.validationDispatchCandidateHash}, ${dispatch.runtimeId},
              ${dispatch.connectionId}, ${dispatch.sessionId}, ${dispatch.dispatchId},
              ${context.principalId}, ${actorKind}, ${binding.supervisionId},
              ${binding.launchNonce}, ${binding.platform}, ${binding.manifestHash},
              ${binding.admissionEvidenceHash}, ${binding.admissionBindingHash},
              ${binding.testOnly}, 'CLAIMED', 'NOT_CONFIGURED', ${input.idempotencyKey},
              ${handoff.expiresAt}
            ) RETURNING *
          `);
          if (!claim)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session claim was not stored',
            );
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
              subjectType: 'AcpCodexValidationProcessSessionClaim',
              subjectId: claim.id,
              occurredAt: now.toISOString(),
              idempotencyKey: `${input.idempotencyKey}:event`,
              correlationId: dispatch.runId,
              facts: { payloadFieldCount: 0, payloadBytes: 0 },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
          return Object.freeze({
            claim: Object.freeze({ ...claim, schemaVersion: 1 as const }),
            replayed: false,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex validation process-session claim conflict',
        );
      throw error;
    }
  }

  /**
   * Persists independently observed exit evidence and one cancellation cleanup
   * while the exact recovery lease remains active. Performs no process action.
   */
  async completeCodexValidationProcessSessionRecovery(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: CompleteCodexValidationProcessSessionRecoveryInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    publicReference(input.idempotencyKey, 'idempotencyKey');
    let dispatch: Readonly<CodexValidationDispatchCandidate>;
    try {
      dispatch = validateCodexValidationDispatchCandidate(input.dispatch);
    } catch {
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session recovery completion is invalid',
      );
    }
    if (dispatch.workspaceId !== context.workspaceId)
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session recovery completion crossed its workspace',
      );

    try {
      return await prisma.$transaction(
        async (tx) => {
          const untrustedWorkItem = input.workItem as unknown as Record<string, unknown>;
          const claimId = untrustedWorkItem?.claimId;
          const recoveryLeaseId = untrustedWorkItem?.recoveryLeaseId;
          if (typeof claimId !== 'string' || typeof recoveryLeaseId !== 'string')
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session recovery completion lacks authority',
            );
          auditSubjectReference(claimId, 'claimId');
          auditSubjectReference(recoveryLeaseId, 'recoveryLeaseId');
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_codex_validation_process_session_claims" WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "id"=${claimId} FOR UPDATE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_codex_validation_process_session_recovery_leases" WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "id"=${recoveryLeaseId} AND "claimId"=${claimId} FOR UPDATE`,
          );
          const [claimRows, leaseRows, existingEvidenceRows, existingCompletionRows, now] =
            await Promise.all([
              tx.$queryRaw<CodexValidationProcessSessionRecoveryClaimRow[]>(Prisma.sql`
                SELECT claim.*, dispatch."runId"
                FROM "acp_codex_validation_process_session_claims" claim
                JOIN "acp_codex_validation_dispatch_evidence" dispatch
                  ON dispatch."workspaceId"=claim."workspaceId"
                  AND dispatch."validationDispatchCandidateHash"=claim."validationDispatchCandidateHash"
                WHERE claim."workspaceId"=CAST(${context.workspaceId} AS uuid)
                  AND claim."id"=${claimId}
                FOR SHARE OF claim
              `),
              tx.$queryRaw<CodexValidationProcessSessionRecoveryLeaseRow[]>(Prisma.sql`
                SELECT * FROM "acp_codex_validation_process_session_recovery_leases"
                WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                  AND "id"=${recoveryLeaseId} AND "claimId"=${claimId}
                FOR SHARE
              `),
              tx.$queryRaw<CodexValidationProcessSessionRecoveryExitEvidenceRow[]>(Prisma.sql`
                SELECT * FROM "acp_codex_validation_process_session_recovery_exit_evidence"
                WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                  AND (
                    "claimId"=${claimId} OR
                    "recoveryLeaseId"=${recoveryLeaseId} OR
                    "recoveryCompletionIdempotencyKey"=${input.idempotencyKey}
                  )
                FOR SHARE
              `),
              tx.$queryRaw<CodexValidationProcessSessionCompletionRow[]>(Prisma.sql`
                SELECT * FROM "acp_codex_validation_process_session_completions"
                WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "claimId"=${claimId}
                FOR SHARE
              `),
              databaseNow(tx),
            ]);
          const claim = claimRows[0];
          const lease = leaseRows[0];
          if (!claim || !lease)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation process-session recovery authority not found',
            );
          let workItem: Readonly<CodexValidationProcessSessionRecoveryWorkItem>;
          let exitEvidence: Readonly<CodexValidationProcessSessionRecoveryExitEvidence>;
          try {
            workItem = validateCodexValidationProcessSessionRecoveryWorkItem(input.workItem, now);
            exitEvidence = validateCodexValidationProcessSessionRecoveryExitEvidence(
              input.exitEvidence,
              workItem,
              now,
            );
          } catch {
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session recovery evidence is invalid',
            );
          }
          const binding = workItem.binding;
          if (
            workItem.claimId !== claim.id ||
            workItem.recoveryLeaseId !== lease.id ||
            workItem.recoveryGeneration !== lease.generation ||
            workItem.handoffAttemptId !== claim.handoffAttemptId ||
            workItem.validationDispatchCandidateHash !== claim.validationDispatchCandidateHash ||
            workItem.sessionId !== claim.sessionId ||
            workItem.dispatchId !== claim.dispatchId ||
            workItem.runId !== claim.runId ||
            workItem.processClaimedAt !== claim.claimedAt.toISOString() ||
            workItem.processExpiresAt !== claim.expiresAt.toISOString() ||
            workItem.leaseClaimedAt !== lease.claimedAt.toISOString() ||
            workItem.leaseExpiresAt !== lease.expiresAt.toISOString() ||
            claim.ownerReference !== context.principalId ||
            claim.ownerActorKind !== actorKind ||
            lease.ownerReference !== context.principalId ||
            lease.ownerActorKind !== actorKind ||
            lease.claimExpiresAt.toISOString() !== workItem.processExpiresAt ||
            lease.runtimeConnection !== 'NOT_CONFIGURED' ||
            claim.supervisionId !== binding.supervisionId ||
            claim.launchNonce !== binding.launchNonce ||
            claim.platform !== binding.platform ||
            claim.manifestHash !== binding.manifestHash ||
            claim.admissionEvidenceHash !== binding.admissionEvidenceHash ||
            claim.admissionBindingHash !== binding.admissionBindingHash ||
            claim.testOnly !== binding.testOnly ||
            dispatch.validationDispatchCandidateHash !== workItem.validationDispatchCandidateHash ||
            dispatch.runtimeId !== binding.runtimeId ||
            dispatch.connectionId !== binding.connectionId ||
            dispatch.sessionId !== workItem.sessionId ||
            dispatch.dispatchId !== workItem.dispatchId ||
            dispatch.runId !== workItem.runId
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session recovery completion crossed durable authority',
            );
          const cleanup = createCodexValidationProcessCleanupEvidence(
            {
              schemaVersion: 1,
              binding,
              dispatchId: workItem.dispatchId,
              validationDispatchCandidateHash: workItem.validationDispatchCandidateHash,
              sessionId: workItem.sessionId,
              processState: 'EXITED',
              exitCode: exitEvidence.exitCode,
              signal: exitEvidence.signal,
              closedAt: exitEvidence.exitedAt,
              runtimeConnection: 'NOT_CONFIGURED',
            },
            {
              schemaVersion: 1,
              binding,
              dispatchId: workItem.dispatchId,
              validationDispatchCandidateHash: workItem.validationDispatchCandidateHash,
              sessionId: workItem.sessionId,
              issuedAt: dispatch.issuedAt,
              expiresAt: dispatch.expiresAt,
              runtimeConnection: 'NOT_CONFIGURED',
              reason: 'CANCELLED',
            },
            now,
          );

          const existingEvidence = existingEvidenceRows[0];
          const existingCompletion = existingCompletionRows[0];
          if (existingEvidence || existingCompletion) {
            if (
              existingEvidenceRows.length !== 1 ||
              !existingEvidence ||
              !existingCompletion ||
              existingEvidence.workspaceId !== context.workspaceId ||
              existingEvidence.evidenceHash !== exitEvidence.evidenceHash ||
              existingEvidence.evidenceId !== exitEvidence.evidenceId ||
              existingEvidence.recoveryLeaseId !== workItem.recoveryLeaseId ||
              existingEvidence.recoveryGeneration !== workItem.recoveryGeneration ||
              existingEvidence.claimId !== workItem.claimId ||
              existingEvidence.cleanupEvidenceHash !== cleanup.cleanupEvidenceHash ||
              existingEvidence.ownerReference !== context.principalId ||
              existingEvidence.ownerActorKind !== actorKind ||
              existingEvidence.supervisionId !== binding.supervisionId ||
              existingEvidence.launchNonce !== binding.launchNonce ||
              existingEvidence.sessionId !== workItem.sessionId ||
              existingEvidence.dispatchId !== workItem.dispatchId ||
              existingEvidence.validationDispatchCandidateHash !==
                workItem.validationDispatchCandidateHash ||
              existingEvidence.identityEstablishedAt.toISOString() !==
                exitEvidence.identityEstablishedAt ||
              existingEvidence.exitedAt.toISOString() !== exitEvidence.exitedAt ||
              existingEvidence.verifiedAt.toISOString() !== exitEvidence.verifiedAt ||
              existingEvidence.processState !== 'EXITED' ||
              existingEvidence.exitCode !== exitEvidence.exitCode ||
              existingEvidence.signal !== exitEvidence.signal ||
              existingEvidence.identityAuthority !== 'RETAINED_NATIVE_IDENTITY' ||
              existingEvidence.runtimeConnection !== 'NOT_CONFIGURED' ||
              existingEvidence.recoveryCompletionIdempotencyKey !== input.idempotencyKey ||
              existingCompletion.cleanupEvidenceHash !== cleanup.cleanupEvidenceHash ||
              existingCompletion.workspaceId !== context.workspaceId ||
              existingCompletion.claimId !== workItem.claimId ||
              existingCompletion.handoffAttemptId !== workItem.handoffAttemptId ||
              existingCompletion.validationDispatchCandidateHash !==
                workItem.validationDispatchCandidateHash ||
              existingCompletion.runtimeId !== binding.runtimeId ||
              existingCompletion.connectionId !== binding.connectionId ||
              existingCompletion.sessionId !== workItem.sessionId ||
              existingCompletion.dispatchId !== workItem.dispatchId ||
              existingCompletion.reason !== 'CANCELLED' ||
              existingCompletion.processState !== 'EXITED' ||
              existingCompletion.exitCode !== exitEvidence.exitCode ||
              existingCompletion.signal !== exitEvidence.signal ||
              existingCompletion.closedAt.toISOString() !== exitEvidence.exitedAt ||
              existingCompletion.runtimeConnection !== 'NOT_CONFIGURED' ||
              existingCompletion.completionIdempotencyKey !== input.idempotencyKey
            )
              throw new AcpBridgeAdmissionConflictError(
                'Codex validation process-session recovery completion replay drifted',
              );
            return Object.freeze({
              evidence: Object.freeze({ ...existingEvidence, schemaVersion: 1 as const }),
              completion: Object.freeze({ ...existingCompletion, schemaVersion: 1 as const }),
              replayed: true,
            });
          }

          const [storedEvidence] = await tx.$queryRaw<
            CodexValidationProcessSessionRecoveryExitEvidenceRow[]
          >(Prisma.sql`
            INSERT INTO "acp_codex_validation_process_session_recovery_exit_evidence" (
              "workspaceId", "evidenceHash", "evidenceId", "recoveryLeaseId",
              "recoveryGeneration", "claimId", "cleanupEvidenceHash", "ownerReference",
              "ownerActorKind", "supervisionId", "launchNonce", "sessionId", "dispatchId",
              "validationDispatchCandidateHash", "identityEstablishedAt", "exitedAt",
              "verifiedAt", "processState", "exitCode", "signal", "identityAuthority",
              "runtimeConnection", "recoveryCompletionIdempotencyKey"
            ) VALUES (
              CAST(${context.workspaceId} AS uuid), ${exitEvidence.evidenceHash},
              ${exitEvidence.evidenceId}, ${workItem.recoveryLeaseId},
              ${workItem.recoveryGeneration}, ${workItem.claimId}, ${cleanup.cleanupEvidenceHash},
              ${context.principalId}, ${actorKind}, ${binding.supervisionId},
              ${binding.launchNonce}, ${workItem.sessionId}, ${workItem.dispatchId},
              ${workItem.validationDispatchCandidateHash},
              ${new Date(exitEvidence.identityEstablishedAt)}, ${new Date(exitEvidence.exitedAt)},
              ${new Date(exitEvidence.verifiedAt)}, 'EXITED', ${exitEvidence.exitCode},
              ${exitEvidence.signal}, 'RETAINED_NATIVE_IDENTITY', 'NOT_CONFIGURED',
              ${input.idempotencyKey}
            ) RETURNING *
          `);
          const [completion] = await tx.$queryRaw<
            CodexValidationProcessSessionCompletionRow[]
          >(Prisma.sql`
            INSERT INTO "acp_codex_validation_process_session_completions" (
              "workspaceId", "cleanupEvidenceHash", "claimId", "handoffAttemptId",
              "validationDispatchCandidateHash", "runtimeId", "connectionId", "sessionId",
              "dispatchId", "reason", "processState", "exitCode", "signal", "closedAt",
              "runtimeConnection", "completionIdempotencyKey"
            ) VALUES (
              CAST(${context.workspaceId} AS uuid), ${cleanup.cleanupEvidenceHash}, ${claim.id},
              ${claim.handoffAttemptId}, ${workItem.validationDispatchCandidateHash},
              ${claim.runtimeId}, ${claim.connectionId}, ${workItem.sessionId},
              ${workItem.dispatchId}, 'CANCELLED', 'EXITED', ${exitEvidence.exitCode},
              ${exitEvidence.signal}, ${new Date(exitEvidence.exitedAt)}, 'NOT_CONFIGURED',
              ${input.idempotencyKey}
            ) RETURNING *
          `);
          if (!storedEvidence || !completion)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session recovery completion was not stored',
            );
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
              subjectType: 'AcpCodexValidationProcessSessionRecoveryCompletion',
              subjectId: storedEvidence.evidenceHash,
              occurredAt: now.toISOString(),
              idempotencyKey: `${input.idempotencyKey}:event`,
              correlationId: workItem.runId,
              facts: { payloadFieldCount: 0, payloadBytes: 0 },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
          return Object.freeze({
            evidence: Object.freeze({ ...storedEvidence, schemaVersion: 1 as const }),
            completion: Object.freeze({ ...completion, schemaVersion: 1 as const }),
            replayed: false,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' &&
            (error.meta?.code === '23505' || error.meta?.code === '23514')))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex validation process-session recovery completion conflict',
        );
      throw error;
    }
  }

  /** Records exact owner-reported exit evidence before terminal admission. */
  async completeCodexValidationProcessSession(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: CompleteCodexValidationProcessSessionInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    auditSubjectReference(input.claimId, 'claimId');
    publicReference(input.idempotencyKey, 'idempotencyKey');
    let dispatch: Readonly<CodexValidationDispatchCandidate>;
    let binding: Readonly<SupervisorProcessBinding>;
    let reason: 'COMPLETED' | 'CANCELLED';
    let cleanupEvidenceHash: string;
    try {
      dispatch = validateCodexValidationDispatchCandidate(input.dispatch);
      const untrusted = input.cleanup as unknown as Record<string, unknown>;
      binding = validateSupervisorProcessBinding(untrusted?.binding);
      digest(untrusted?.cleanupEvidenceHash, 'cleanupEvidenceHash');
      cleanupEvidenceHash = untrusted.cleanupEvidenceHash;
      if (untrusted?.reason !== 'COMPLETED' && untrusted?.reason !== 'CANCELLED') throw new Error();
      reason = untrusted.reason;
    } catch {
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session completion is invalid',
      );
    }
    if (
      dispatch.workspaceId !== context.workspaceId ||
      binding.workspaceId !== context.workspaceId ||
      binding.runtimeId !== dispatch.runtimeId ||
      binding.connectionId !== dispatch.connectionId
    )
      throw new AcpBridgeAdmissionDeniedError(
        'Codex validation process-session completion crossed its durable binding',
      );

    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_codex_validation_process_session_claims" WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "id"=${input.claimId} FOR UPDATE`,
          );
          const [claimRows, existingRows, activeRecoveryRows, now] = await Promise.all([
            tx.$queryRaw<CodexValidationProcessSessionClaimRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_claims"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "id"=${input.claimId}
              FOR SHARE
            `),
            tx.$queryRaw<CodexValidationProcessSessionCompletionRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_completions"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND (
                  "claimId"=${input.claimId} OR
                  "cleanupEvidenceHash"=${cleanupEvidenceHash} OR
                  "completionIdempotencyKey"=${input.idempotencyKey}
                )
              FOR SHARE
            `),
            tx.$queryRaw<CodexValidationProcessSessionRecoveryLeaseRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_recovery_leases"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "claimId"=${input.claimId}
                AND "expiresAt" > LOCALTIMESTAMP(3)
              LIMIT 1
              FOR SHARE
            `),
            databaseNow(tx),
          ]);
          const claim = claimRows[0];
          if (!claim)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation process-session claim not found',
            );
          let cleanup: Readonly<CodexValidationProcessCleanupEvidence>;
          try {
            cleanup = validateCodexValidationProcessCleanupEvidence(
              input.cleanup,
              {
                schemaVersion: 1,
                binding,
                dispatchId: dispatch.dispatchId,
                validationDispatchCandidateHash: dispatch.validationDispatchCandidateHash,
                sessionId: dispatch.sessionId,
                issuedAt: dispatch.issuedAt,
                expiresAt: dispatch.expiresAt,
                runtimeConnection: 'NOT_CONFIGURED',
                reason,
              },
              now,
            );
          } catch {
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process cleanup evidence is invalid',
            );
          }
          if (
            claim.ownerReference !== context.principalId ||
            claim.ownerActorKind !== actorKind ||
            claim.validationDispatchCandidateHash !== dispatch.validationDispatchCandidateHash ||
            claim.runtimeId !== dispatch.runtimeId ||
            claim.connectionId !== dispatch.connectionId ||
            claim.sessionId !== dispatch.sessionId ||
            claim.dispatchId !== dispatch.dispatchId ||
            claim.supervisionId !== binding.supervisionId ||
            claim.launchNonce !== binding.launchNonce ||
            claim.platform !== binding.platform ||
            claim.manifestHash !== binding.manifestHash ||
            claim.admissionEvidenceHash !== binding.admissionEvidenceHash ||
            claim.admissionBindingHash !== binding.admissionBindingHash ||
            claim.testOnly !== binding.testOnly ||
            cleanup.closedAt < claim.claimedAt.toISOString() ||
            cleanup.closedAt > claim.expiresAt.toISOString()
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation process-session completion does not match its claim',
            );
          if (activeRecoveryRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session completion conflicts with active recovery lease',
            );

          const existingByClaim = existingRows.find((row) => row.claimId === input.claimId);
          const existingByHash = existingRows.find(
            (row) => row.cleanupEvidenceHash === cleanup.cleanupEvidenceHash,
          );
          const existingByKey = existingRows.find(
            (row) => row.completionIdempotencyKey === input.idempotencyKey,
          );
          const existing = existingByClaim ?? existingByHash ?? existingByKey;
          if (existing) {
            if (
              existingByClaim?.completionIdempotencyKey !== input.idempotencyKey ||
              existingByHash?.claimId !== input.claimId ||
              existingByKey?.cleanupEvidenceHash !== cleanup.cleanupEvidenceHash ||
              existing.workspaceId !== context.workspaceId ||
              existing.cleanupEvidenceHash !== cleanup.cleanupEvidenceHash ||
              existing.claimId !== input.claimId ||
              existing.handoffAttemptId !== claim.handoffAttemptId ||
              existing.validationDispatchCandidateHash !==
                cleanup.validationDispatchCandidateHash ||
              existing.runtimeId !== claim.runtimeId ||
              existing.connectionId !== claim.connectionId ||
              existing.sessionId !== cleanup.sessionId ||
              existing.dispatchId !== cleanup.dispatchId ||
              existing.reason !== cleanup.reason ||
              existing.processState !== cleanup.processState ||
              existing.exitCode !== cleanup.exitCode ||
              existing.signal !== cleanup.signal ||
              existing.closedAt.toISOString() !== cleanup.closedAt ||
              existing.runtimeConnection !== cleanup.runtimeConnection ||
              existing.completionIdempotencyKey !== input.idempotencyKey
            )
              throw new AcpBridgeAdmissionConflictError(
                'Codex validation process-session completion replay drifted',
              );
            return Object.freeze({
              completion: Object.freeze({ ...existing, schemaVersion: 1 as const }),
              replayed: true,
            });
          }
          if (existingRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session completion identity was already used',
            );

          const [completion] = await tx.$queryRaw<
            CodexValidationProcessSessionCompletionRow[]
          >(Prisma.sql`
            INSERT INTO "acp_codex_validation_process_session_completions" (
              "workspaceId", "cleanupEvidenceHash", "claimId", "handoffAttemptId",
              "validationDispatchCandidateHash", "runtimeId", "connectionId", "sessionId",
              "dispatchId", "reason", "processState", "exitCode", "signal", "closedAt",
              "runtimeConnection", "completionIdempotencyKey"
            ) VALUES (
              CAST(${context.workspaceId} AS uuid), ${cleanup.cleanupEvidenceHash}, ${claim.id},
              ${claim.handoffAttemptId}, ${cleanup.validationDispatchCandidateHash},
              ${claim.runtimeId}, ${claim.connectionId}, ${cleanup.sessionId},
              ${cleanup.dispatchId}, ${cleanup.reason}, ${cleanup.processState},
              ${cleanup.exitCode}, ${cleanup.signal}, ${new Date(cleanup.closedAt)},
              ${cleanup.runtimeConnection}, ${input.idempotencyKey}
            ) RETURNING *
          `);
          if (!completion)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation process-session completion was not stored',
            );
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
              subjectType: 'AcpCodexValidationProcessSessionCompletion',
              subjectId: completion.cleanupEvidenceHash,
              occurredAt: now.toISOString(),
              idempotencyKey: `${input.idempotencyKey}:event`,
              correlationId: dispatch.runId,
              facts: { payloadFieldCount: 0, payloadBytes: 0 },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
          return Object.freeze({
            completion: Object.freeze({ ...completion, schemaVersion: 1 as const }),
            replayed: false,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex validation process-session completion conflict',
        );
      throw error;
    }
  }

  /**
   * Admits one authenticated interrupt acknowledgement and interrupted terminal
   * for a claimed validation handoff. This burns no new authority, assigns no
   * run, and cannot transition runtime or connection truth.
   */
  async acceptCodexValidationCancellationEvidence(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: AcceptCodexValidationCancellationEvidenceInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    auditSubjectReference(input.handoffAttemptId, 'handoffAttemptId');
    publicReference(input.idempotencyKey, 'idempotencyKey');
    let candidate: Readonly<CodexValidationCancellationCandidate>;
    try {
      candidate = validateCodexValidationCancellationCandidate(
        createCodexValidationCancellationCandidate({
          dispatch: input.dispatch,
          bridge: input.bridge,
          terminal: input.terminal,
          cancellationEnvelope: input.cancellationEnvelope,
        }),
      );
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Codex validation cancellation evidence is invalid');
    }
    if (candidate.workspaceId !== context.workspaceId)
      throw new AcpBridgeAdmissionDeniedError('Codex validation cancellation crossed workspace');

    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_codex_validation_egress_handoff_attempts" WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "id"=${input.handoffAttemptId} FOR UPDATE`,
          );
          const [handoffRows, dispatchRows, existingRows, completedRows, cleanupRows] =
            await Promise.all([
              tx.$queryRaw<CodexValidationEgressHandoffRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_egress_handoff_attempts"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "id"=${input.handoffAttemptId}
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationDispatchEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_dispatch_evidence"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "validationDispatchCandidateHash"=${candidate.validationDispatchCandidateHash}
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationCancellationEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_cancellation_evidence"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND (
                  "cancellationCandidateHash"=${candidate.cancellationCandidateHash}
                  OR "handoffAttemptId"=${input.handoffAttemptId}
                  OR "cancellationIdempotencyKey"=${input.idempotencyKey}
                  OR ("sessionId"=${candidate.sessionId}
                    AND "cancellationMessageId"=${candidate.cancellationMessageId})
                )
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationRoundTripEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_round_trip_evidence"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND (
                  "handoffAttemptId"=${input.handoffAttemptId}
                  OR ("sessionId"=${candidate.sessionId}
                    AND (
                      "statusMessageId"=${candidate.cancellationMessageId}
                      OR "terminalMessageId"=${candidate.cancellationMessageId}
                    ))
                )
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationProcessSessionCompletionRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_completions"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "handoffAttemptId"=${input.handoffAttemptId}
              FOR SHARE
            `),
            ]);
          const handoff = handoffRows[0];
          const dispatch = dispatchRows[0];
          if (!handoff || !dispatch)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation handoff or dispatch evidence not found',
            );
          if (completedRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation handoff or message already has completed evidence',
            );
          const [connection, run, now] = await Promise.all([
            tx.acpRuntimeConnection.findUnique({
              where: {
                workspaceId_id: { workspaceId: context.workspaceId, id: candidate.connectionId },
              },
              include: { runtime: true },
            }),
            tx.acpRun.findUnique({
              where: { workspaceId_id: { workspaceId: context.workspaceId, id: candidate.runId } },
              include: { task: { include: { objective: true } } },
            }),
            databaseNow(tx),
          ]);
          if (!connection || !run)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation cancellation durable state not found',
            );
          const routingPolicy = run.task.routingPolicy as Record<string, unknown>;
          const agentPolicy = run.task.agentPolicy as Record<string, unknown>;
          if (
            !routingPolicy ||
            typeof routingPolicy !== 'object' ||
            Array.isArray(routingPolicy) ||
            JSON.stringify(Object.keys(routingPolicy).sort()) !==
              JSON.stringify(['capabilityId', 'maximumLatencyMs']) ||
            !agentPolicy ||
            typeof agentPolicy !== 'object' ||
            Array.isArray(agentPolicy) ||
            JSON.stringify(Object.keys(agentPolicy).sort()) !==
              JSON.stringify(['scopes', 'templateId']) ||
            handoff.validationDispatchCandidateHash !== candidate.validationDispatchCandidateHash ||
            handoff.heartbeatCandidateHash !== candidate.heartbeatCandidateHash ||
            handoff.ownerReference !== context.principalId ||
            handoff.ownerActorKind !== actorKind ||
            handoff.generation !== 1 ||
            handoff.state !== 'CLAIMED' ||
            handoff.runtimeId !== candidate.runtimeId ||
            handoff.connectionId !== candidate.connectionId ||
            handoff.sessionId !== candidate.sessionId ||
            handoff.dispatchId !== candidate.dispatchId ||
            handoff.taskId !== candidate.taskId ||
            handoff.runId !== candidate.runId ||
            handoff.agentId !== candidate.agentId ||
            handoff.authorityLevel !== candidate.authorityLevel ||
            handoff.taskPolicyHash !== candidate.taskPolicyHash ||
            handoff.maximumCostMinorUnits !== 0 ||
            handoff.outboundSequence !== 1 ||
            handoff.validationIssuedAt.toISOString() !== input.dispatch.issuedAt ||
            handoff.validationExpiresAt.toISOString() !== input.dispatch.expiresAt ||
            candidate.cancellationIssuedAt < handoff.claimedAt.toISOString() ||
            candidate.cancellationIssuedAt > handoff.expiresAt.toISOString() ||
            candidate.cancellationExpiresAt > handoff.validationExpiresAt.toISOString() ||
            dispatch.validationDispatchCandidateHash !==
              candidate.validationDispatchCandidateHash ||
            dispatch.heartbeatCandidateHash !== candidate.heartbeatCandidateHash ||
            dispatch.runtimeId !== candidate.runtimeId ||
            dispatch.connectionId !== candidate.connectionId ||
            dispatch.sessionId !== candidate.sessionId ||
            dispatch.principalReference !== candidate.principalReference ||
            dispatch.authGeneration !== candidate.authGeneration ||
            dispatch.dispatchId !== candidate.dispatchId ||
            dispatch.taskId !== candidate.taskId ||
            dispatch.runId !== candidate.runId ||
            dispatch.agentId !== candidate.agentId ||
            dispatch.authorityLevel !== candidate.authorityLevel ||
            dispatch.taskPolicyHash !== candidate.taskPolicyHash ||
            dispatch.maximumCostMinorUnits !== 0 ||
            dispatch.challengeCode !== CODEX_VALIDATION_CHALLENGE ||
            dispatch.expiresAt <= now ||
            connection.runtimeId !== candidate.runtimeId ||
            connection.runtime.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
            connection.runtime.status !== 'NOT_CONFIGURED' ||
            connection.runtime.secretReference !== input.bridge.secretReference ||
            connection.runtime.secretDigest !== input.bridge.expectedSecretDigest ||
            connection.status !== 'NOT_CONFIGURED' ||
            connection.authGeneration !== 1 ||
            connection.capabilityCodes.length !== 0 ||
            connection.capabilityDigest !== null ||
            connection.lastHeartbeatAt !== null ||
            connection.lastHeartbeatHealth !== null ||
            connection.lastHeartbeatSequence !== null ||
            run.taskId !== candidate.taskId ||
            run.objectiveId !== run.task.objectiveId ||
            run.status !== 'PREPARED' ||
            run.task.status !== 'READY' ||
            run.task.kind !== 'quality.verify' ||
            run.requiredAuthority !== candidate.authorityLevel ||
            run.task.requiredAuthority !== candidate.authorityLevel ||
            run.policyHash !== candidate.taskPolicyHash ||
            run.task.policyHash !== candidate.taskPolicyHash ||
            run.policyVersion !== run.task.policyVersion ||
            run.task.maximumCostMinorUnits !== 0n ||
            run.task.maximumComputeUnits !== BigInt(dispatch.maximumComputeUnits) ||
            run.task.estimatedDurationMs !== BigInt(dispatch.maximumDurationMs) ||
            run.task.objective.status !== 'ACTIVE' ||
            run.task.objective.maximumAuthority < candidate.authorityLevel ||
            run.task.objective.maximumCostMinorUnits !== 0n ||
            run.task.objective.maximumComputeUnits < BigInt(dispatch.maximumComputeUnits) ||
            run.assignedAgentId !== null ||
            run.assignedRuntimeId !== null ||
            run.assignedConnectionId !== null ||
            run.task.assignedAgentId !== null ||
            run.task.assignedRuntimeId !== null ||
            run.task.assignedConnectionId !== null ||
            routingPolicy.capabilityId !== CODEX_VALIDATION_CHALLENGE ||
            routingPolicy.maximumLatencyMs !== dispatch.maximumDurationMs ||
            agentPolicy.templateId !== 'codex-runtime-validator' ||
            !Array.isArray(agentPolicy.scopes) ||
            JSON.stringify(agentPolicy.scopes) !== JSON.stringify([CODEX_VALIDATION_CHALLENGE])
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation cancellation durable authority is not live',
            );

          await this.withSecretLease(
            {
              workspaceId: context.workspaceId,
              runtimeId: candidate.runtimeId,
              connectionId: candidate.connectionId,
              secretReference: input.bridge.secretReference,
              expectedDigest: input.bridge.expectedSecretDigest,
              authGeneration: 1,
              purpose: 'VERIFY_FRAME',
            },
            (secret) => {
              const keys = deriveBridgeKeys(secret, input.bridge);
              try {
                verifyBridgeEnvelope(
                  input.cancellationEnvelope,
                  keys.runtimeToParent,
                  input.bridge,
                  now,
                );
              } catch {
                throw new AcpBridgeAdmissionDeniedError(
                  'Codex validation cancellation frame authentication failed',
                );
              } finally {
                keys.parentToRuntime.fill(0);
                keys.runtimeToParent.fill(0);
              }
            },
          );

          const existingByCandidate = existingRows.find(
            (row) => row.cancellationCandidateHash === candidate.cancellationCandidateHash,
          );
          const existingByHandoff = existingRows.find(
            (row) => row.handoffAttemptId === input.handoffAttemptId,
          );
          const existingByKey = existingRows.find(
            (row) => row.cancellationIdempotencyKey === input.idempotencyKey,
          );
          const existing = existingByCandidate ?? existingByHandoff ?? existingByKey;
          if (existing) {
            if (
              existingByCandidate?.cancellationIdempotencyKey !== input.idempotencyKey ||
              existingByHandoff?.cancellationCandidateHash !==
                candidate.cancellationCandidateHash ||
              existingByKey?.cancellationCandidateHash !== candidate.cancellationCandidateHash ||
              existing.handoffAttemptId !== input.handoffAttemptId
            )
              throw new AcpBridgeAdmissionConflictError(
                'Codex validation cancellation replay drifted',
              );
            return Object.freeze({
              runtime: connection.runtime,
              connection,
              run,
              evidence: Object.freeze({ ...existing, schemaVersion: 1 as const }),
              replayed: true,
            });
          }
          if (existingRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation cancellation message identity was already used',
            );
          const cleanup = cleanupRows[0];
          if (
            !cleanup ||
            cleanup.validationDispatchCandidateHash !== candidate.validationDispatchCandidateHash ||
            cleanup.runtimeId !== candidate.runtimeId ||
            cleanup.connectionId !== candidate.connectionId ||
            cleanup.sessionId !== candidate.sessionId ||
            cleanup.dispatchId !== candidate.dispatchId ||
            cleanup.reason !== 'CANCELLED'
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation cancellation requires exact process cleanup evidence',
            );

          const [evidence] = await tx.$queryRaw<
            CodexValidationCancellationEvidenceRow[]
          >(Prisma.sql`
              INSERT INTO "acp_codex_validation_cancellation_evidence" (
                "workspaceId", "cancellationCandidateHash", "handoffAttemptId",
                "validationDispatchCandidateHash", "heartbeatCandidateHash", "runtimeId",
                "connectionId", "sessionId", "principalReference", "adapterKind",
                "authGeneration", "dispatchId", "taskId", "runId", "agentId",
                "authorityLevel", "taskPolicyHash", "maximumCostMinorUnits",
                "progressEventCount", "progressEvidenceHash", "tokenUsageEventCount",
                "tokenUsageEvidenceHash", "usageAccountingState",
                "recognizedCostMinorUnits", "recognizedComputeUnits",
                "cancellationSequence", "cancellationMessageId", "interruptRequestId",
                "interruptResponseHash", "terminalThreadId", "terminalTurnId",
                "terminalMessageHash", "cancellationPayloadDigest",
                "cancellationEnvelopeDigest", "cancellationAuthenticationTagDigest",
                "cancellationIssuedAt", "cancellationExpiresAt", "resultCode",
                "terminalState", "providerAccess", "runtimeConnection",
                "connectionTransition", "cancellationIdempotencyKey"
              ) VALUES (
                CAST(${context.workspaceId} AS uuid), ${candidate.cancellationCandidateHash},
                ${input.handoffAttemptId}, ${candidate.validationDispatchCandidateHash},
                ${candidate.heartbeatCandidateHash}, ${candidate.runtimeId},
                ${candidate.connectionId}, ${candidate.sessionId},
                ${candidate.principalReference}, ${candidate.adapterKind},
                ${candidate.authGeneration}, ${candidate.dispatchId}, ${candidate.taskId},
                ${candidate.runId}, ${candidate.agentId}, ${candidate.authorityLevel},
                ${candidate.taskPolicyHash}, ${candidate.maximumCostMinorUnits},
                ${candidate.progressEventCount}, ${candidate.progressEvidenceHash},
                ${candidate.tokenUsageEventCount}, ${candidate.tokenUsageEvidenceHash},
                ${candidate.usageAccountingState}, ${candidate.recognizedCostMinorUnits},
                ${candidate.recognizedComputeUnits},
                ${candidate.cancellationSequence}, ${candidate.cancellationMessageId},
                ${candidate.interruptRequestId}, ${candidate.interruptResponseHash},
                ${candidate.terminalThreadId}, ${candidate.terminalTurnId},
                ${candidate.terminalMessageHash}, ${candidate.cancellationPayloadDigest},
                ${candidate.cancellationEnvelopeDigest},
                ${candidate.cancellationAuthenticationTagDigest},
                ${new Date(candidate.cancellationIssuedAt)},
                ${new Date(candidate.cancellationExpiresAt)}, ${candidate.resultCode},
                ${candidate.terminalState}, ${candidate.providerAccess},
                ${candidate.runtimeConnection}, ${candidate.connectionTransition},
                ${input.idempotencyKey}
              ) RETURNING *
            `);
          if (!evidence)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation cancellation evidence was not stored',
            );
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
              subjectType: 'AcpCodexValidationCancellationEvidence',
              subjectId: evidence.cancellationCandidateHash,
              occurredAt: now.toISOString(),
              idempotencyKey: `${input.idempotencyKey}:event`,
              correlationId: candidate.runId,
              facts: { payloadFieldCount: 0, payloadBytes: 0 },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
          return Object.freeze({
            runtime: connection.runtime,
            connection,
            run,
            evidence: Object.freeze({ ...evidence, schemaVersion: 1 as const }),
            replayed: false,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex validation cancellation conflict',
        );
      throw error;
    }
  }

  /**
   * Admits the authenticated status/result pair for a claimed validation handoff.
   * This is evidence only: it deliberately does not assign the prepared run or
   * transition runtime/connection truth.
   */
  async acceptCodexValidationRoundTripEvidence(
    capability: OperationalEventCapability,
    context: WorkspaceContext,
    input: AcceptCodexValidationRoundTripEvidenceInput,
  ) {
    const actorKind = assertControlPlane(capability, context, 3);
    auditSubjectReference(input.handoffAttemptId, 'handoffAttemptId');
    publicReference(input.idempotencyKey, 'idempotencyKey');
    let candidate: Readonly<CodexValidationRoundTripCandidate>;
    try {
      candidate = validateCodexValidationRoundTripCandidate(
        createCodexValidationRoundTripCandidate({
          dispatch: input.dispatch,
          bridge: input.bridge,
          terminal: input.terminal,
          statusEnvelope: input.statusEnvelope,
          terminalEnvelope: input.terminalEnvelope,
        }),
      );
    } catch {
      throw new AcpBridgeAdmissionDeniedError('Codex validation round-trip evidence is invalid');
    }
    if (candidate.workspaceId !== context.workspaceId)
      throw new AcpBridgeAdmissionDeniedError('Codex validation round trip crossed workspace');

    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "acp_codex_validation_egress_handoff_attempts" WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid) AND "id"=${input.handoffAttemptId} FOR UPDATE`,
          );
          const [handoffRows, dispatchRows, existingRows, cancellationRows, cleanupRows] =
            await Promise.all([
              tx.$queryRaw<CodexValidationEgressHandoffRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_egress_handoff_attempts"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "id"=${input.handoffAttemptId}
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationDispatchEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_dispatch_evidence"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "validationDispatchCandidateHash"=${candidate.validationDispatchCandidateHash}
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationRoundTripEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_round_trip_evidence"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND (
                  "roundTripCandidateHash"=${candidate.roundTripCandidateHash}
                  OR "handoffAttemptId"=${input.handoffAttemptId}
                  OR "roundTripIdempotencyKey"=${input.idempotencyKey}
                  OR "statusMessageId" IN (${candidate.statusMessageId}, ${candidate.terminalMessageId})
                  OR "terminalMessageId" IN (${candidate.statusMessageId}, ${candidate.terminalMessageId})
                )
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationCancellationEvidenceRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_cancellation_evidence"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND (
                  "handoffAttemptId"=${input.handoffAttemptId}
                  OR ("sessionId"=${candidate.sessionId}
                    AND "cancellationMessageId" IN (
                      ${candidate.statusMessageId}, ${candidate.terminalMessageId}
                    ))
                )
              FOR SHARE
            `),
              tx.$queryRaw<CodexValidationProcessSessionCompletionRow[]>(Prisma.sql`
              SELECT * FROM "acp_codex_validation_process_session_completions"
              WHERE "workspaceId"=CAST(${context.workspaceId} AS uuid)
                AND "handoffAttemptId"=${input.handoffAttemptId}
              FOR SHARE
            `),
            ]);
          const handoff = handoffRows[0];
          const dispatch = dispatchRows[0];
          if (!handoff || !dispatch)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation handoff or dispatch evidence not found',
            );
          if (cancellationRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation handoff or message already has cancellation evidence',
            );
          const [connection, run, now] = await Promise.all([
            tx.acpRuntimeConnection.findUnique({
              where: {
                workspaceId_id: { workspaceId: context.workspaceId, id: candidate.connectionId },
              },
              include: { runtime: true },
            }),
            tx.acpRun.findUnique({
              where: { workspaceId_id: { workspaceId: context.workspaceId, id: candidate.runId } },
              include: { task: { include: { objective: true } } },
            }),
            databaseNow(tx),
          ]);
          if (!connection || !run)
            throw new AcpBridgeAdmissionNotFoundError(
              'Codex validation round-trip durable state not found',
            );
          const routingPolicy = run.task.routingPolicy as Record<string, unknown>;
          const agentPolicy = run.task.agentPolicy as Record<string, unknown>;
          if (
            !routingPolicy ||
            typeof routingPolicy !== 'object' ||
            Array.isArray(routingPolicy) ||
            JSON.stringify(Object.keys(routingPolicy).sort()) !==
              JSON.stringify(['capabilityId', 'maximumLatencyMs']) ||
            !agentPolicy ||
            typeof agentPolicy !== 'object' ||
            Array.isArray(agentPolicy) ||
            JSON.stringify(Object.keys(agentPolicy).sort()) !==
              JSON.stringify(['scopes', 'templateId']) ||
            handoff.validationDispatchCandidateHash !== candidate.validationDispatchCandidateHash ||
            handoff.heartbeatCandidateHash !== candidate.heartbeatCandidateHash ||
            handoff.ownerReference !== context.principalId ||
            handoff.ownerActorKind !== actorKind ||
            handoff.generation !== 1 ||
            handoff.state !== 'CLAIMED' ||
            handoff.runtimeId !== candidate.runtimeId ||
            handoff.connectionId !== candidate.connectionId ||
            handoff.sessionId !== candidate.sessionId ||
            handoff.dispatchId !== candidate.dispatchId ||
            handoff.taskId !== candidate.taskId ||
            handoff.runId !== candidate.runId ||
            handoff.agentId !== candidate.agentId ||
            handoff.authorityLevel !== candidate.authorityLevel ||
            handoff.taskPolicyHash !== candidate.taskPolicyHash ||
            handoff.maximumCostMinorUnits !== 0 ||
            handoff.outboundSequence !== 1 ||
            handoff.validationIssuedAt.toISOString() !== input.dispatch.issuedAt ||
            handoff.validationExpiresAt.toISOString() !== input.dispatch.expiresAt ||
            candidate.statusIssuedAt < handoff.claimedAt.toISOString() ||
            candidate.statusIssuedAt > handoff.expiresAt.toISOString() ||
            candidate.terminalExpiresAt > handoff.validationExpiresAt.toISOString() ||
            dispatch.validationDispatchCandidateHash !==
              candidate.validationDispatchCandidateHash ||
            dispatch.heartbeatCandidateHash !== candidate.heartbeatCandidateHash ||
            dispatch.runtimeId !== candidate.runtimeId ||
            dispatch.connectionId !== candidate.connectionId ||
            dispatch.sessionId !== candidate.sessionId ||
            dispatch.principalReference !== candidate.principalReference ||
            dispatch.authGeneration !== candidate.authGeneration ||
            dispatch.dispatchId !== candidate.dispatchId ||
            dispatch.taskId !== candidate.taskId ||
            dispatch.runId !== candidate.runId ||
            dispatch.agentId !== candidate.agentId ||
            dispatch.authorityLevel !== candidate.authorityLevel ||
            dispatch.taskPolicyHash !== candidate.taskPolicyHash ||
            dispatch.maximumCostMinorUnits !== 0 ||
            dispatch.challengeCode !== CODEX_VALIDATION_CHALLENGE ||
            dispatch.expiresAt <= now ||
            connection.runtimeId !== candidate.runtimeId ||
            connection.runtime.adapterKind !== CODEX_APP_SERVER_ADAPTER_KIND ||
            connection.runtime.status !== 'NOT_CONFIGURED' ||
            connection.runtime.secretReference !== input.bridge.secretReference ||
            connection.runtime.secretDigest !== input.bridge.expectedSecretDigest ||
            connection.status !== 'NOT_CONFIGURED' ||
            connection.authGeneration !== 1 ||
            connection.capabilityCodes.length !== 0 ||
            connection.capabilityDigest !== null ||
            connection.lastHeartbeatAt !== null ||
            connection.lastHeartbeatHealth !== null ||
            connection.lastHeartbeatSequence !== null ||
            run.taskId !== candidate.taskId ||
            run.objectiveId !== run.task.objectiveId ||
            run.status !== 'PREPARED' ||
            run.task.status !== 'READY' ||
            run.task.kind !== 'quality.verify' ||
            run.requiredAuthority !== candidate.authorityLevel ||
            run.task.requiredAuthority !== candidate.authorityLevel ||
            run.policyHash !== candidate.taskPolicyHash ||
            run.task.policyHash !== candidate.taskPolicyHash ||
            run.policyVersion !== run.task.policyVersion ||
            run.task.maximumCostMinorUnits !== 0n ||
            run.task.maximumComputeUnits !== BigInt(dispatch.maximumComputeUnits) ||
            run.task.estimatedDurationMs !== BigInt(dispatch.maximumDurationMs) ||
            run.task.objective.status !== 'ACTIVE' ||
            run.task.objective.maximumAuthority < candidate.authorityLevel ||
            run.task.objective.maximumCostMinorUnits !== 0n ||
            run.task.objective.maximumComputeUnits < BigInt(dispatch.maximumComputeUnits) ||
            run.assignedAgentId !== null ||
            run.assignedRuntimeId !== null ||
            run.assignedConnectionId !== null ||
            run.task.assignedAgentId !== null ||
            run.task.assignedRuntimeId !== null ||
            run.task.assignedConnectionId !== null ||
            routingPolicy.capabilityId !== CODEX_VALIDATION_CHALLENGE ||
            routingPolicy.maximumLatencyMs !== dispatch.maximumDurationMs ||
            agentPolicy.templateId !== 'codex-runtime-validator' ||
            !Array.isArray(agentPolicy.scopes) ||
            JSON.stringify(agentPolicy.scopes) !== JSON.stringify([CODEX_VALIDATION_CHALLENGE])
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation round-trip durable authority is not live',
            );

          await this.withSecretLease(
            {
              workspaceId: context.workspaceId,
              runtimeId: candidate.runtimeId,
              connectionId: candidate.connectionId,
              secretReference: input.bridge.secretReference,
              expectedDigest: input.bridge.expectedSecretDigest,
              authGeneration: 1,
              purpose: 'VERIFY_FRAME',
            },
            (secret) => {
              const keys = deriveBridgeKeys(secret, input.bridge);
              try {
                verifyBridgeEnvelope(input.statusEnvelope, keys.runtimeToParent, input.bridge, now);
                verifyBridgeEnvelope(
                  input.terminalEnvelope,
                  keys.runtimeToParent,
                  input.bridge,
                  now,
                );
              } catch {
                throw new AcpBridgeAdmissionDeniedError(
                  'Codex validation round-trip frame authentication failed',
                );
              } finally {
                keys.parentToRuntime.fill(0);
                keys.runtimeToParent.fill(0);
              }
            },
          );

          const existingByCandidate = existingRows.find(
            (row) => row.roundTripCandidateHash === candidate.roundTripCandidateHash,
          );
          const existingByHandoff = existingRows.find(
            (row) => row.handoffAttemptId === input.handoffAttemptId,
          );
          const existingByKey = existingRows.find(
            (row) => row.roundTripIdempotencyKey === input.idempotencyKey,
          );
          const existing = existingByCandidate ?? existingByHandoff ?? existingByKey;
          if (existing) {
            if (
              existingByCandidate?.roundTripIdempotencyKey !== input.idempotencyKey ||
              existingByHandoff?.roundTripCandidateHash !== candidate.roundTripCandidateHash ||
              existingByKey?.roundTripCandidateHash !== candidate.roundTripCandidateHash ||
              existing.handoffAttemptId !== input.handoffAttemptId
            )
              throw new AcpBridgeAdmissionConflictError(
                'Codex validation round-trip replay drifted',
              );
            return Object.freeze({
              runtime: connection.runtime,
              connection,
              run,
              evidence: Object.freeze({ ...existing, schemaVersion: 1 as const }),
              replayed: true,
            });
          }
          if (existingRows.length > 0)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation round-trip message identity was already used',
            );
          const cleanup = cleanupRows[0];
          if (
            !cleanup ||
            cleanup.validationDispatchCandidateHash !== candidate.validationDispatchCandidateHash ||
            cleanup.runtimeId !== candidate.runtimeId ||
            cleanup.connectionId !== candidate.connectionId ||
            cleanup.sessionId !== candidate.sessionId ||
            cleanup.dispatchId !== candidate.dispatchId ||
            cleanup.reason !== 'COMPLETED'
          )
            throw new AcpBridgeAdmissionDeniedError(
              'Codex validation round trip requires exact process cleanup evidence',
            );

          const [evidence] = await tx.$queryRaw<CodexValidationRoundTripEvidenceRow[]>(Prisma.sql`
            INSERT INTO "acp_codex_validation_round_trip_evidence" (
              "workspaceId", "roundTripCandidateHash", "handoffAttemptId",
              "validationDispatchCandidateHash", "heartbeatCandidateHash", "runtimeId",
              "connectionId", "sessionId", "principalReference", "adapterKind",
              "authGeneration", "dispatchId", "taskId", "runId", "agentId",
              "authorityLevel", "taskPolicyHash", "maximumCostMinorUnits",
              "progressEventCount", "progressEvidenceHash", "tokenUsageEventCount",
              "tokenUsageEvidenceHash", "usageAccountingState",
              "recognizedCostMinorUnits", "recognizedComputeUnits",
              "statusSequence", "statusMessageId", "statusPayloadDigest",
              "statusEnvelopeDigest", "statusAuthenticationTagDigest", "statusIssuedAt",
              "statusExpiresAt", "terminalSequence", "terminalMessageId",
              "terminalThreadId", "terminalTurnId", "terminalMessageHash",
              "terminalPayloadDigest", "terminalEnvelopeDigest",
              "terminalAuthenticationTagDigest", "terminalIssuedAt", "terminalExpiresAt",
              "resultCode", "statusState", "terminalState", "providerAccess",
              "runtimeConnection", "connectionTransition", "roundTripIdempotencyKey"
            ) VALUES (
              CAST(${context.workspaceId} AS uuid), ${candidate.roundTripCandidateHash},
              ${input.handoffAttemptId}, ${candidate.validationDispatchCandidateHash},
              ${candidate.heartbeatCandidateHash}, ${candidate.runtimeId},
              ${candidate.connectionId}, ${candidate.sessionId}, ${candidate.principalReference},
              ${candidate.adapterKind}, ${candidate.authGeneration}, ${candidate.dispatchId},
              ${candidate.taskId}, ${candidate.runId}, ${candidate.agentId},
              ${candidate.authorityLevel}, ${candidate.taskPolicyHash},
              ${candidate.maximumCostMinorUnits},
              ${candidate.progressEventCount}, ${candidate.progressEvidenceHash},
              ${candidate.tokenUsageEventCount}, ${candidate.tokenUsageEvidenceHash},
              ${candidate.usageAccountingState}, ${candidate.recognizedCostMinorUnits},
              ${candidate.recognizedComputeUnits}, ${candidate.statusSequence},
              ${candidate.statusMessageId}, ${candidate.statusPayloadDigest},
              ${candidate.statusEnvelopeDigest}, ${candidate.statusAuthenticationTagDigest},
              ${new Date(candidate.statusIssuedAt)}, ${new Date(candidate.statusExpiresAt)},
              ${candidate.terminalSequence}, ${candidate.terminalMessageId},
              ${candidate.terminalThreadId}, ${candidate.terminalTurnId},
              ${candidate.terminalMessageHash}, ${candidate.terminalPayloadDigest},
              ${candidate.terminalEnvelopeDigest},
              ${candidate.terminalAuthenticationTagDigest},
              ${new Date(candidate.terminalIssuedAt)}, ${new Date(candidate.terminalExpiresAt)},
              ${candidate.resultCode}, ${candidate.statusState}, ${candidate.terminalState},
              ${candidate.providerAccess}, ${candidate.runtimeConnection},
              ${candidate.connectionTransition}, ${input.idempotencyKey}
            ) RETURNING *
          `);
          if (!evidence)
            throw new AcpBridgeAdmissionConflictError(
              'Codex validation round-trip evidence was not stored',
            );
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "acp_codex_validation_round_trip_messages" (
              "workspaceId", "sessionId", "messageId", "roundTripCandidateHash", "messageRole"
            ) VALUES
              (CAST(${context.workspaceId} AS uuid), ${candidate.sessionId},
                ${candidate.statusMessageId}, ${candidate.roundTripCandidateHash}, 'STATUS'),
              (CAST(${context.workspaceId} AS uuid), ${candidate.sessionId},
                ${candidate.terminalMessageId}, ${candidate.roundTripCandidateHash}, 'TERMINAL')
          `);
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
              subjectType: 'AcpCodexValidationRoundTripEvidence',
              subjectId: evidence.roundTripCandidateHash,
              occurredAt: now.toISOString(),
              idempotencyKey: `${input.idempotencyKey}:event`,
              correlationId: candidate.runId,
              facts: { payloadFieldCount: 0, payloadBytes: 0 },
            },
            actorKind === 'HUMAN' ? context.principalId : undefined,
            tx,
          );
          return Object.freeze({
            runtime: connection.runtime,
            connection,
            run,
            evidence: Object.freeze({ ...evidence, schemaVersion: 1 as const }),
            replayed: false,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '23505'))
      )
        throw new AcpBridgeAdmissionConflictError(
          'Concurrent Codex validation round-trip conflict',
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
