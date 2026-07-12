import { z } from 'zod';

export const onboardingSchema = z.object({
  businessObjectives: z.string().max(4000).optional(),
  availableBudgetEur: z.number().nonnegative().optional(),
  riskTolerance: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  preferredCategories: z.array(z.string()).default([]),
  excludedCategories: z.array(z.string()).default([]),
  targetRegions: z.array(z.string()).default([]),
  preferredLanguages: z.array(z.string()).default(['en']),
  weeklyTimeHours: z.number().int().min(0).max(168).optional(),
  existingSkills: z.array(z.string()).default([]),
  marketplacePreferences: z.array(z.string()).default(['etsy']),
  advertisingPreference: z.enum(['DISABLED', 'MANUAL_APPROVAL_ONLY']).default('DISABLED'),
  approvalThresholdEur: z.number().nonnegative().optional(),
  refundThresholdEur: z.number().nonnegative().optional(),
  targetProfitEur: z.number().nonnegative().optional(),
  targetLaunchDate: z.string().datetime().optional(),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;
