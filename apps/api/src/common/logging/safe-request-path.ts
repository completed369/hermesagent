/**
 * Route parameters can contain bearer credentials (workspace invitations).
 * Keep route shape for operations while ensuring secrets never enter logs.
 */
export function safeRequestPath(path: string): string {
  return path.replace(
    /^(\/(?:api\/)?workspace-invitations\/)[^/]+(?=\/accept\/?$|\/?$)/,
    '$1:token',
  );
}
