import { Module } from '@nestjs/common';
import {
  ASSIGNMENT_EVIDENCE_VERIFIER,
  DURABLE_ARTIFACT_EVIDENCE_VERIFIER,
} from '@ventureos/agent-control-plane';
import {
  BRIDGE_BROKER_EVIDENCE_VERIFIER,
  BRIDGE_CAPABILITY_POLICY_VERIFIER,
  BRIDGE_SECRET_RESOLVER,
  type BridgeBrokerEvidenceVerifier,
  type BridgeCapabilityPolicyVerifier,
  type BridgeSecretResolver,
} from '@ventureos/agent-bridge';
import { AuditModule } from '../audit/audit.module';
import { AcpBridgeAdmissionService } from './acp-bridge-admission.service';
import { AcpTaskRunService } from './acp-task-run.service';

const denySecrets: BridgeSecretResolver = {
  async resolve() {
    throw new Error('Bridge secret resolution is not configured');
  },
};
const denyBrokerEvidence: BridgeBrokerEvidenceVerifier = {
  async verify() {
    return false;
  },
};
const denyCapabilityPolicy: BridgeCapabilityPolicyVerifier = {
  async verify() {
    return false;
  },
};

/**
 * Service-only composition root. Evidence ports intentionally fail closed
 * until authenticated broker/runtime adapters are wired in a later change.
 */
@Module({
  imports: [AuditModule],
  providers: [
    AcpTaskRunService,
    AcpBridgeAdmissionService,
    { provide: BRIDGE_SECRET_RESOLVER, useValue: denySecrets },
    { provide: BRIDGE_BROKER_EVIDENCE_VERIFIER, useValue: denyBrokerEvidence },
    { provide: BRIDGE_CAPABILITY_POLICY_VERIFIER, useValue: denyCapabilityPolicy },
    { provide: ASSIGNMENT_EVIDENCE_VERIFIER, useExisting: AcpBridgeAdmissionService },
    { provide: DURABLE_ARTIFACT_EVIDENCE_VERIFIER, useExisting: AcpBridgeAdmissionService },
  ],
  exports: [AcpTaskRunService, AcpBridgeAdmissionService],
})
export class AgentControlPlaneModule {}
