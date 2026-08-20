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

export const collaborationRoleSchema = z.enum(['OPERATOR', 'VIEWER']);
export const workspaceMemberIdSchema = z.string().uuid('Member ID must be a UUID');
export const invitationTokenSchema = z
  .string()
  .length(43, 'Invitation token has an invalid length')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invitation token has an invalid format');
export const previewInvitationSchema = z.object({ token: invitationTokenSchema });

export const createInvitationSchema = z.object({
  roleKey: collaborationRoleSchema,
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

export const changeMemberRoleSchema = z.object({ roleKey: collaborationRoleSchema });

export const acceptInvitationSchema = z.object({
  token: invitationTokenSchema,
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().trim().min(1).max(100),
});

export type CollaborationRole = z.infer<typeof collaborationRoleSchema>;
