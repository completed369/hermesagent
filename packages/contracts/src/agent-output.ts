import { z } from 'zod';

/**
 * Canonical structured output contract every voting board agent MUST return.
 * See docs/AGENT_OUTPUT_CONTRACTS.md. Any output that fails this schema is
 * INVALID and must be retried per policy, never silently treated as approval.
 */
export const AgentDecision = z.enum(['APPROVE', 'REVISE', 'REJECT']);
export type AgentDecision = z.infer<typeof AgentDecision>;

export const RiskSeverity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const RiskProbability = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const VetoType = z.enum(['NONE', 'FINANCE', 'COMPLIANCE', 'SECURITY', 'QUALITY']);

export const RiskSchema = z.object({
  title: z.string().min(1),
  severity: RiskSeverity,
  probability: RiskProbability,
  mitigation: z.string().min(1),
});

export const VetoSchema = z.object({
  active: z.boolean(),
  type: VetoType,
  reason: z.string(),
});

export const AgentOutputSchema = z
  .object({
    agentRole: z.string().min(1),
    agentVersion: z.string().min(1),
    proposalVersionId: z.string().uuid(),
    decision: AgentDecision,
    confidence: z.number().min(0).max(100),
    summary: z.string().min(1),
    reasons: z.array(z.string()),
    supportingEvidenceIds: z.array(z.string().uuid()),
    assumptions: z.array(z.string()),
    missingInformation: z.array(z.string()),
    risks: z.array(RiskSchema),
    requiredChanges: z.array(z.string()),
    estimatedImpact: z.string(),
    veto: VetoSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    // A veto must always be self-consistent: active vetoes require a real type/reason.
    if (val.veto.active && val.veto.type === 'NONE') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An active veto must declare a type other than NONE',
        path: ['veto', 'type'],
      });
    }
    if (val.veto.active && val.veto.reason.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An active veto must include a reason',
        path: ['veto', 'reason'],
      });
    }
    if (!val.veto.active && val.veto.type !== 'NONE') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'veto.type must be NONE when veto.active is false',
        path: ['veto', 'type'],
      });
    }
  });

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export const BOARD_AGENT_ROLES = [
  'MARKET_INTELLIGENCE_DIRECTOR',
  'PRODUCT_STRATEGY_DIRECTOR',
  'CREATIVE_AND_PRODUCTION_DIRECTOR',
  'FINANCE_AND_RISK_OFFICER',
  'GROWTH_DIRECTOR',
  'COMPLIANCE_AND_MARKETPLACE_POLICY_OFFICER',
  'OPERATIONS_AND_QUALITY_OFFICER',
  'RED_TEAM_AND_SECURITY_OFFICER',
] as const;
export type BoardAgentRole = (typeof BOARD_AGENT_ROLES)[number];

export const CRITICAL_VETO_ROLES: Record<string, VetoType[number] | undefined> = {
  FINANCE_AND_RISK_OFFICER: 'FINANCE',
  COMPLIANCE_AND_MARKETPLACE_POLICY_OFFICER: 'COMPLIANCE',
  OPERATIONS_AND_QUALITY_OFFICER: 'QUALITY',
  RED_TEAM_AND_SECURITY_OFFICER: 'SECURITY',
};
