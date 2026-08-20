'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

export interface AvailableWorkspace {
  id: string;
  workspace: { id: string; name: string; slug: string };
  role: { key: string; name: string };
}

export function WorkspaceSwitcher({
  activeWorkspaceId,
  memberships,
}: {
  activeWorkspaceId: string;
  memberships: AvailableWorkspace[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function switchWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId || busy) return;
    setBusy(true);
    setError(null);
    const workspace = memberships.find((candidate) => candidate.workspace.id === workspaceId);
    setStatus(`Switching to ${workspace?.workspace.name ?? 'workspace'}.`);
    try {
      await apiFetch('/workspaces/switch', {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      });
      setStatus(`Active workspace changed to ${workspace?.workspace.name ?? 'workspace'}.`);
      // The active workspace lives in an HttpOnly cookie that is consumed by the
      // server-rendered shell. A client-router refresh can race the cookie update
      // while already on /dashboard and retain the previous tenant's shell. A
      // hard replacement creates a fresh server request without leaving the stale
      // tenant view as the current browser-history entry.
      window.location.replace('/dashboard');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not switch workspace.');
      setStatus('');
      setBusy(false);
    }
  }

  if (memberships.length === 0) return null;

  return (
    <div className="vos-workspace-switcher" aria-busy={busy}>
      <p className="vos-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
      <label>
        Active workspace
        <select
          className="vos-input"
          value={activeWorkspaceId}
          disabled={busy || memberships.length === 1}
          onChange={(event) => void switchWorkspace(event.target.value)}
        >
          {memberships.map((membership) => (
            <option key={membership.id} value={membership.workspace.id}>
              {membership.workspace.name} · {membership.role.name}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p className="vos-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
