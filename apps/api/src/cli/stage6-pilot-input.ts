import { z } from 'zod';
import {
  createOpportunitySchema,
  opportunityComplianceAssessmentSchema,
} from '../modules/opportunities/opportunities.dto';

export const stage6PilotInputSchema = z
  .object({
    pilot: createOpportunitySchema,
    compliance: opportunityComplianceAssessmentSchema.omit({ evidenceClaimIds: true }).strict(),
  })
  .strict();

export type Stage6PilotInput = z.infer<typeof stage6PilotInputSchema>;
