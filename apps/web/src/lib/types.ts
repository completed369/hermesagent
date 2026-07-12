export interface AuthenticatedUser {
  userId: string;
  email: string;
  isFounder: boolean;
  workspaceId: string;
  roleKey: string;
  permissions: string[];
}
