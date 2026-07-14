import { z } from 'zod';

export const ApprovalState = z.enum([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
  'REVISION_REQUESTED',
  'EXPIRED',
  'REVOKED',
  'EXECUTED',
  'EXECUTION_FAILED',
]);
export type ApprovalState = z.infer<typeof ApprovalState>;

export const ApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  requestedAction: z.string().min(1),
  explanation: z.string().min(1),
  affectedResources: z.array(z.string()),
  artifactVersionId: z.string().uuid(),
  packageHash: z.string().min(1),
  estimatedCostEur: z.number().nonnegative(),
  maxAuthorizedCostEur: z.number().nonnegative(),
  reversible: z.boolean(),
  risks: z.array(z.string()),
  evidenceIds: z.array(z.string().uuid()),
  boardResultId: z.string().uuid().optional(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  requestedBy: z.string(),
  state: ApprovalState,
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionSchema = z.object({
  approvalRequestId: z.string().uuid(),
  founderIdentity: z.string().min(1),
  decidedAt: z.string().datetime(),
  decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_REVISION', 'APPROVE_WITH_CONDITIONS', 'REVOKE']),
  conditions: z.array(z.string()).default([]),
  comment: z.string().optional(),
  approvedAmountEur: z.number().nonnegative().optional(),
  approvedArtifactVersionId: z.string().uuid(),
  approvedPackageHash: z.string().min(1),
  expiresAt: z.string().datetime(),
  auditSignature: z.string().min(1),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/**
 * Server-side enforcement primitive: an approval may only authorize execution
 * of the EXACT artifact version and package hash it was granted for, and only
 * before its expiry. Every sensitive workflow step MUST call this before acting.
 * This must never be replaced by a frontend-only check.
 */
export function isApprovalValidForExecution(
  approval: Pick<
    ApprovalDecision,
    'approvedArtifactVersionId' | 'approvedPackageHash' | 'expiresAt'
  >,
  current: { artifactVersionId: string; packageHash: string; now?: Date },
): { valid: boolean; reason?: string } {
  const now = current.now ?? new Date();
  if (approval.approvedArtifactVersionId !== current.artifactVersionId) {
    return { valid: false, reason: 'ARTIFACT_VERSION_MISMATCH' };
  }
  if (approval.approvedPackageHash !== current.packageHash) {
    return { valid: false, reason: 'PACKAGE_HASH_MISMATCH' };
  }
  if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
    return { valid: false, reason: 'APPROVAL_EXPIRED' };
  }
  return { valid: true };
}
