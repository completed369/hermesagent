import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { prisma } from '@ventureos/database';
import {
  evaluateOpportunityCompliance,
  type OpportunityCompliancePolicyPack,
} from '@ventureos/policy-engine';
import { hashContent } from '@ventureos/security';
import type { AuditService } from '../audit/audit.service';
import type { OpportunityComplianceAssessmentInput } from './opportunities.dto';

const COMPLIANCE_AUDIT_ACTION = 'OPPORTUNITY_COMPLIANCE_ASSESSED';
const COMPLIANCE_POLICY_ID = 'GATE1-OPPORTUNITY-COMPLIANCE';

interface ComplianceOpportunityState {
  id: string;
  title: string;
  description: string;
  status: string;
  suggestedMarketplace: string | null;
  suggestedProductType: string | null;
  risks: string[];
}

interface ComplianceEvidenceClaimState {
  id: string;
  claimType: string;
  statement: string;
  evidenceArtifact: {
    id: string;
    contentHash: string;
  };
}

interface CompliancePolicyPackState {
  id: string;
  marketplace: string;
}

interface CompliancePolicyPackVersionState {
  id: string;
  version: string;
  isActive: boolean;
  reviewDueAt: Date;
  supportedProductTypes: string[];
  restrictedCategories: string[];
  ipChecks: string[];
}

interface ComplianceStateWithoutHash {
  opportunity: ComplianceOpportunityState;
  evidenceClaims: ComplianceEvidenceClaimState[];
  policyPack: CompliancePolicyPackState | null;
  policyPackVersion: CompliancePolicyPackVersionState | null;
}

interface ComplianceState extends ComplianceStateWithoutHash {
  stateHash: string;
}

interface StoredAssessment {
  formulaVersion: string;
  result: 'PASS' | 'BLOCKED';
  hasCriticalBlocker: boolean;
  blockers: Array<{ code: string; reason: string }>;
  normalizedProductType: string | null;
  evaluatedAt: string;
  stateHash: string;
  declarations: {
    declaredCategories: string[];
    thirdPartyTrademarksPresent: boolean;
    copyrightedStockWithoutLicence: boolean;
  };
  evidenceClaimIds: string[];
  policyPackId: string | null;
  policyPackVersion: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBlockerArray(value: unknown): value is Array<{ code: string; reason: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => isRecord(item) && typeof item.code === 'string' && typeof item.reason === 'string',
    )
  );
}

function parseStoredAssessment(value: unknown): StoredAssessment | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.formulaVersion !== 'string' ||
    (value.result !== 'PASS' && value.result !== 'BLOCKED') ||
    typeof value.hasCriticalBlocker !== 'boolean' ||
    !isBlockerArray(value.blockers) ||
    (value.normalizedProductType !== null && typeof value.normalizedProductType !== 'string') ||
    typeof value.evaluatedAt !== 'string' ||
    typeof value.stateHash !== 'string' ||
    !isRecord(value.declarations) ||
    !isStringArray(value.evidenceClaimIds) ||
    (value.policyPackId !== null && typeof value.policyPackId !== 'string') ||
    (value.policyPackVersion !== null && typeof value.policyPackVersion !== 'string')
  ) {
    return null;
  }
  const declarations = value.declarations;
  if (
    !isStringArray(declarations.declaredCategories) ||
    typeof declarations.thirdPartyTrademarksPresent !== 'boolean' ||
    typeof declarations.copyrightedStockWithoutLicence !== 'boolean'
  ) {
    return null;
  }
  return value as unknown as StoredAssessment;
}

function packForPolicy(state: ComplianceState): OpportunityCompliancePolicyPack | null {
  if (!state.policyPack || !state.policyPackVersion) return null;
  return {
    marketplace: state.policyPack.marketplace,
    version: state.policyPackVersion.version,
    isActive: state.policyPackVersion.isActive,
    reviewDueAt: state.policyPackVersion.reviewDueAt,
    supportedProductTypes: state.policyPackVersion.supportedProductTypes,
    restrictedCategories: state.policyPackVersion.restrictedCategories,
    ipChecks: state.policyPackVersion.ipChecks,
  };
}

function buildStateHash(state: ComplianceStateWithoutHash): string {
  const canonical = {
    opportunity: {
      id: state.opportunity.id,
      title: state.opportunity.title,
      description: state.opportunity.description,
      suggestedMarketplace: state.opportunity.suggestedMarketplace,
      suggestedProductType: state.opportunity.suggestedProductType,
      risks: [...state.opportunity.risks].sort(),
    },
    policyPack: state.policyPack
      ? {
          id: state.policyPack.id,
          marketplace: state.policyPack.marketplace,
          version: state.policyPackVersion
            ? {
                id: state.policyPackVersion.id,
                version: state.policyPackVersion.version,
                isActive: state.policyPackVersion.isActive,
                reviewDueAt: state.policyPackVersion.reviewDueAt.toISOString(),
                supportedProductTypes: [...state.policyPackVersion.supportedProductTypes].sort(),
                restrictedCategories: [...state.policyPackVersion.restrictedCategories].sort(),
                ipChecks: [...state.policyPackVersion.ipChecks].sort(),
              }
            : null,
        }
      : null,
    evidence: state.evidenceClaims
      .map((claim) => ({
        id: claim.id,
        claimType: claim.claimType,
        statement: claim.statement,
        artifactId: claim.evidenceArtifact.id,
        contentHash: claim.evidenceArtifact.contentHash,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return hashContent(JSON.stringify(canonical));
}

async function loadComplianceState(
  workspaceId: string,
  opportunityId: string,
): Promise<ComplianceState> {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, workspaceId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      suggestedMarketplace: true,
      suggestedProductType: true,
      risks: true,
    },
  });
  if (!opportunity) throw new NotFoundException('Opportunity not found');

  const evidenceClaims = await prisma.evidenceClaim.findMany({
    where: { workspaceId, opportunityId },
    select: {
      id: true,
      claimType: true,
      statement: true,
      evidenceArtifact: { select: { id: true, contentHash: true } },
    },
    orderBy: { id: 'asc' },
  });

  const marketplace = opportunity.suggestedMarketplace?.trim().toLowerCase() ?? null;
  const policyPackRecord = marketplace
    ? await prisma.marketplacePolicyPack.findUnique({
        where: { marketplace },
        select: {
          id: true,
          marketplace: true,
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              version: true,
              isActive: true,
              reviewDueAt: true,
              supportedProductTypes: true,
              restrictedCategories: true,
              ipChecks: true,
            },
          },
        },
      })
    : null;
  const policyPack: CompliancePolicyPackState | null = policyPackRecord
    ? { id: policyPackRecord.id, marketplace: policyPackRecord.marketplace }
    : null;
  const policyPackVersion: CompliancePolicyPackVersionState | null =
    policyPackRecord?.versions[0] ?? null;
  const stateWithoutHash: ComplianceStateWithoutHash = {
    opportunity,
    evidenceClaims,
    policyPack,
    policyPackVersion,
  };
  return { ...stateWithoutHash, stateHash: buildStateHash(stateWithoutHash) };
}

function validateEvidenceSelection(state: ComplianceState, evidenceClaimIds: string[]): string[] {
  const selected = [...new Set(evidenceClaimIds)].sort();
  if (selected.length !== evidenceClaimIds.length) {
    throw new BadRequestException('Compliance evidence claim IDs must be unique');
  }
  const available = new Set(state.evidenceClaims.map((claim) => claim.id));
  if (selected.some((id) => !available.has(id))) {
    throw new BadRequestException('Compliance evidence must belong to this opportunity');
  }
  return selected;
}

export async function assessOpportunityCompliance(
  workspaceId: string,
  opportunityId: string,
  input: OpportunityComplianceAssessmentInput,
  actorId: string,
  auditService: AuditService,
) {
  const state = await loadComplianceState(workspaceId, opportunityId);
  if (!['NEW', 'UNDER_REVIEW'].includes(state.opportunity.status)) {
    throw new ConflictException('Compliance can only be assessed before opportunity promotion');
  }
  const evidenceClaimIds = validateEvidenceSelection(state, input.evidenceClaimIds);
  const result = evaluateOpportunityCompliance({
    marketplace: state.opportunity.suggestedMarketplace,
    productType: state.opportunity.suggestedProductType,
    declaredCategories: input.declaredCategories,
    thirdPartyTrademarksPresent: input.thirdPartyTrademarksPresent,
    copyrightedStockWithoutLicence: input.copyrightedStockWithoutLicence,
    evidenceClaimIds,
    policyPack: packForPolicy(state),
  });

  const stored: StoredAssessment = {
    ...result,
    stateHash: state.stateHash,
    declarations: {
      declaredCategories: [...input.declaredCategories],
      thirdPartyTrademarksPresent: input.thirdPartyTrademarksPresent,
      copyrightedStockWithoutLicence: input.copyrightedStockWithoutLicence,
    },
    evidenceClaimIds,
    policyPackId: state.policyPack?.id ?? null,
    policyPackVersion: state.policyPackVersion?.version ?? null,
  };
  const correlationId = randomUUID();

  await auditService.record(workspaceId, {
    actorId,
    action: COMPLIANCE_AUDIT_ACTION,
    entityType: 'Opportunity',
    entityId: opportunityId,
    correlationId,
    after: stored as unknown as Record<string, unknown>,
    policyResult: {
      policyId: COMPLIANCE_POLICY_ID,
      policyVersion: result.formulaVersion,
      result: result.result === 'PASS' ? 'PASS' : 'FAIL',
      blocking: result.hasCriticalBlocker,
      explanation:
        result.result === 'PASS'
          ? 'Gate 1 opportunity compliance assessment passed.'
          : result.blockers.map((blocker) => blocker.reason).join(' | '),
      inputs: {
        stateHash: state.stateHash,
        policyPackVersion: state.policyPackVersion?.version ?? null,
        evidenceClaimIds,
      },
      evaluatedAt: result.evaluatedAt,
    },
  });

  const event = await prisma.auditEvent.findFirst({
    where: {
      workspaceId,
      action: COMPLIANCE_AUDIT_ACTION,
      entityType: 'Opportunity',
      entityId: opportunityId,
      actorId,
      correlationId,
    },
    select: { id: true, createdAt: true },
  });
  if (!event) throw new Error('Compliance audit record was not persisted');

  return { auditEventId: event.id, createdAt: event.createdAt, ...stored };
}

export async function getCurrentOpportunityComplianceAssessment(
  workspaceId: string,
  opportunityId: string,
) {
  const state = await loadComplianceState(workspaceId, opportunityId);
  const event = await prisma.auditEvent.findFirst({
    where: {
      workspaceId,
      action: COMPLIANCE_AUDIT_ACTION,
      entityType: 'Opportunity',
      entityId: opportunityId,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, after: true },
  });
  if (!event) return null;

  const stored = parseStoredAssessment(event.after);
  if (!stored) {
    return {
      auditEventId: event.id,
      createdAt: event.createdAt,
      stateCurrent: false,
      currentResult: 'BLOCKED' as const,
      currentBlockers: [
        {
          code: 'INVALID_STORED_ASSESSMENT',
          reason: 'Stored compliance assessment is invalid and cannot authorize promotion.',
        },
      ],
      assessment: null,
    };
  }

  const selectedEvidenceIds = validateEvidenceSelection(state, stored.evidenceClaimIds);
  const current = evaluateOpportunityCompliance({
    marketplace: state.opportunity.suggestedMarketplace,
    productType: state.opportunity.suggestedProductType,
    declaredCategories: stored.declarations.declaredCategories,
    thirdPartyTrademarksPresent: stored.declarations.thirdPartyTrademarksPresent,
    copyrightedStockWithoutLicence: stored.declarations.copyrightedStockWithoutLicence,
    evidenceClaimIds: selectedEvidenceIds,
    policyPack: packForPolicy(state),
  });
  const stateCurrent = stored.stateHash === state.stateHash;

  return {
    auditEventId: event.id,
    createdAt: event.createdAt,
    stateCurrent,
    currentResult: stateCurrent ? current.result : ('BLOCKED' as const),
    currentBlockers: stateCurrent
      ? current.blockers
      : [
          {
            code: 'STALE_ASSESSMENT',
            reason: 'Opportunity, evidence, or marketplace policy state changed after assessment.',
          },
        ],
    assessment: stored,
  };
}

export async function assertCurrentOpportunityComplianceForPromotion(
  workspaceId: string,
  opportunityId: string,
): Promise<void> {
  const hasStage6EvidenceQuality = await prisma.opportunityScore.findFirst({
    where: { opportunityId, scoreType: 'EVIDENCE_QUALITY' },
    select: { id: true },
  });
  // Compatibility boundary: pre-Stage-6 seed/demo opportunities do not have
  // this score history and retain their existing mechanical promotion tests.
  if (!hasStage6EvidenceQuality) return;

  const assessment = await getCurrentOpportunityComplianceAssessment(workspaceId, opportunityId);
  if (!assessment) {
    throw new ConflictException('A current passing Gate 1 compliance assessment is required');
  }
  if (!assessment.stateCurrent || assessment.currentResult !== 'PASS') {
    throw new ConflictException('Gate 1 compliance assessment is stale or blocked');
  }
}
