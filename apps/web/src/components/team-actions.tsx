'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

export interface WorkspaceMemberView {
  id: string;
  createdAt: string;
  user: { id: string; email: string; displayName: string; isFounder: boolean };
  role: { key: string; name: string };
}

export function TeamActions({ members }: { members: WorkspaceMemberView[] }) {
  const router = useRouter();
  const [roleKey, setRoleKey] = useState<'OPERATOR' | 'VIEWER'>('OPERATOR');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createInvite() {
    setBusy('invite');
    setError(null);
    setInviteLink(null);
    try {
      const invitation = await apiFetch<{ token: string }>('/workspaces/invitations', {
        method: 'POST',
        body: JSON.stringify({ roleKey, expiresInHours: 72 }),
      });
      setInviteLink(`${window.location.origin}/join/${invitation.token}`);
      setCopied(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invite.');
    } finally {
      setBusy(null);
    }
  }

  async function copyInvite() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
  }

  async function changeRole(memberId: string, nextRole: 'OPERATOR' | 'VIEWER') {
    setBusy(memberId);
    setError(null);
    try {
      await apiFetch(`/workspaces/members/${memberId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleKey: nextRole }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this member.');
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: WorkspaceMemberView) {
    if (!window.confirm(`Remove ${member.user.displayName} from this workspace?`)) return;
    setBusy(member.id);
    setError(null);
    try {
      await apiFetch(`/workspaces/members/${member.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this member.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'end',
          gap: 10,
          padding: 16,
          border: '1px solid var(--vos-border)',
          borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(79,70,229,.09), rgba(6,182,212,.05))',
        }}
      >
        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          Access level
          <select
            className="vos-input"
            value={roleKey}
            onChange={(event) => setRoleKey(event.target.value as 'OPERATOR' | 'VIEWER')}
          >
            <option value="OPERATOR">Operator</option>
            <option value="VIEWER">Viewer</option>
          </select>
        </label>
        <button className="vos-btn" type="button" onClick={createInvite} disabled={busy !== null}>
          {busy === 'invite' ? 'Creating…' : 'Create secure invite'}
        </button>
        <span style={{ color: 'var(--vos-text-muted)', fontSize: 12 }}>
          Single use · expires in 72 hours · no email provider
        </span>
      </div>

      {inviteLink ? (
        <div role="status" style={{ display: 'grid', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Copy this link now — it will not be shown again.</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="vos-input" readOnly value={inviteLink} aria-label="Invitation link" />
            <button type="button" onClick={copyInvite}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="vos-error" role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ display: 'grid', gap: 8 }}>
        {members.map((member) => (
          <div
            key={member.id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px, 1fr) auto auto',
              gap: 12,
              alignItems: 'center',
              padding: '12px 0',
              borderTop: '1px solid var(--vos-border)',
            }}
          >
            <div>
              <strong style={{ display: 'block', fontSize: 14 }}>{member.user.displayName}</strong>
              <span style={{ color: 'var(--vos-text-muted)', fontSize: 12 }}>
                {member.user.email}
              </span>
            </div>
            {member.role.key === 'FOUNDER' ? (
              <span className="vos-badge vos-badge--ok">Founder</span>
            ) : (
              <select
                className="vos-input"
                aria-label={`Role for ${member.user.displayName}`}
                value={member.role.key}
                disabled={busy === member.id}
                onChange={(event) =>
                  changeRole(member.id, event.target.value as 'OPERATOR' | 'VIEWER')
                }
              >
                <option value="OPERATOR">Operator</option>
                <option value="VIEWER">Viewer</option>
              </select>
            )}
            {member.role.key === 'FOUNDER' ? (
              <span />
            ) : (
              <button
                type="button"
                disabled={busy === member.id}
                onClick={() => removeMember(member)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
