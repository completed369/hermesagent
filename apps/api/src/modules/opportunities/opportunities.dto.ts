import { z } from 'zod';

export const rejectOpportunitySchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type RejectOpportunityInput = z.infer<typeof rejectOpportunitySchema>;
