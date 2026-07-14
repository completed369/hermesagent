import { z } from 'zod';

export const decideApprovalSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_REVISION', 'APPROVE_WITH_CONDITIONS', 'REVOKE']),
  conditions: z.array(z.string()).default([]),
  comment: z.string().max(2000).optional(),
  approvedAmountEur: z.number().nonnegative().optional(),
});
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;
