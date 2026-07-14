import { z } from 'zod';

// GET /api/onboarding returns Prisma's actual column values, and Prisma
// represents an unset nullable column as `null`, not `undefined`. The web
// onboarding form round-trips that response straight back into the PUT
// body, so every optional field here must accept `null` as well as
// `undefined` -- otherwise saving a profile that has any never-filled-in
// field crashes with a Zod 500 (confirmed live: after the first real save,
// every subsequent save from the actual UI failed this way).
export const onboardingSchema = z.object({
  businessObjectives: z.string().max(4000).optional().nullable(),
  availableBudgetEur: z.number().nonnegative().optional().nullable(),
  riskTolerance: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional().nullable(),
  preferredCategories: z.array(z.string()).default([]),
  excludedCategories: z.array(z.string()).default([]),
  targetRegions: z.array(z.string()).default([]),
  preferredLanguages: z.array(z.string()).default(['en']),
  weeklyTimeHours: z.number().int().min(0).max(168).optional().nullable(),
  existingSkills: z.array(z.string()).default([]),
  marketplacePreferences: z.array(z.string()).default(['etsy']),
  advertisingPreference: z.enum(['DISABLED', 'MANUAL_APPROVAL_ONLY']).default('DISABLED'),
  approvalThresholdEur: z.number().nonnegative().optional().nullable(),
  refundThresholdEur: z.number().nonnegative().optional().nullable(),
  targetProfitEur: z.number().nonnegative().optional().nullable(),
  targetLaunchDate: z.string().datetime().optional().nullable(),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;
