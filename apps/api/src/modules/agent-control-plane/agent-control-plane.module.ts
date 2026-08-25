import { Module } from '@nestjs/common';
import {
  ASSIGNMENT_EVIDENCE_VERIFIER,
  DURABLE_ARTIFACT_EVIDENCE_VERIFIER,
  type AssignmentEvidenceVerifier,
  type DurableArtifactEvidenceVerifier,
} from '@ventureos/agent-control-plane';
import { AuditModule } from '../audit/audit.module';
import { AcpTaskRunService } from './acp-task-run.service';

const denyAssignmentEvidence: AssignmentEvidenceVerifier = {
  async verify() {
    return false;
  },
};
const denyArtifactEvidence: DurableArtifactEvidenceVerifier = {
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
    { provide: ASSIGNMENT_EVIDENCE_VERIFIER, useValue: denyAssignmentEvidence },
    { provide: DURABLE_ARTIFACT_EVIDENCE_VERIFIER, useValue: denyArtifactEvidence },
  ],
  exports: [AcpTaskRunService],
})
export class AgentControlPlaneModule {}
