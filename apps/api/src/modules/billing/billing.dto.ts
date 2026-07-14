import { z } from 'zod';

export const changePlanSchema = z.object({
  planKey: z.enum(['TRIAL', 'STARTER', 'GROWTH', 'AGENCY']),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export const issueLicenseKeySchema = z.object({
  expiresInDays: z.number().int().positive().optional(),
});
export type IssueLicenseKeyInput = z.infer<typeof issueLicenseKeySchema>;
