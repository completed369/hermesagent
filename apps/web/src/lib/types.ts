export interface AuthenticatedUser {
  userId: string;
  email: string;
  isFounder: boolean;
  workspaceId: string;
  workspaceName: string;
  roleKey: string;
  permissions: string[];
}
