import { z } from 'zod';

export const publishListingSchema = z.object({
  approvalRequestId: z.string().uuid(),
});
export type PublishListingInput = z.infer<typeof publishListingSchema>;
