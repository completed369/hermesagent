import { z } from 'zod';

export const updateBrandingSchema = z.object({
  brandName: z.string().min(1).max(80).optional(),
  logoUrl: z.string().url().optional(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #4F46E5')
    .optional(),
});
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
