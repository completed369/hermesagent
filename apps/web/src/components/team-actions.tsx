'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

export interface WorkspaceMemberView {
  id: string;
  createdAt: string;
  user: { id: string; email: string; displayName: string; isFounder: boolean };
  role: { key: string; name: string };
}

interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

export async function writeInvitationToClipboard(
  inviteLink: string,
  clipboard: ClipboardWriter | undefined,
): Promise<void> {
  if (!clipboard?.writeText) throw new Error('Clipboard access is unavailable');
  await clipboard.writeText(inviteLink);
}

export function TeamActions({ members }: { members: WorkspaceMemberView[] }) {
  const router = useRouter();
  const [roleKey, setRoleKey] = useState<'OPERATOR' | 'VIEWER'>('OPERATOR');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const inviteInput = useRef<HTMLInputElement>(null);

  async function createInvite() {
    setBusy('invite');
    setError(null);
    setInviteLink(null);
    setCopied(false);
    setStatus('Creating a secure invitation.');
    try {
      const invitation = await apiFetch<{ token: string }>('/workspaces/invitations', {
        method: 'POST',
        body: JSON.stringify({ roleKey, expiresInHours: 72 }),
      });
      setInviteLink(`${window.location.origin}/join#token=${encodeURIComponent(invitation.token)}`);
      setStatus('Secure invitation created. Copy the link now.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invite.');
      setStatus('');
    } finally {
      setBusy(null);
    }
  }

  async function copyInvite() {
    if (!inviteLink) return;
    setBusy('copy');
    setError(null);
    setCopied(false);
    setStatus('Copying the invitation link.');
    try {
      await writeInvitationToClipboard(inviteLink, navigator.clipboard);
      setCopied(true);
      setStatus('Invitation link copied to the clipboard.');
    } catch {
      setError('Could not copy the invitation link. Select and copy it manually.');
      setStatus('');
      inviteInput.current?.focus();
      inviteInput.current?.select();
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(memberId: string, nextRole: 'OPERATOR' | 'VIEWER') {
    setBusy(memberId);
    setError(null);
    setStatus('Updating the member role.');
    try {
      await apiFetch(`/workspaces/members/${memberId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleKey: nextRole }),
      });
      setStatus('Member role updated.');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this member.');
      setStatus('');
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: WorkspaceMemberView) {
    if (!window.confirm(`Remove ${member.user.displayName} from this workspace?`)) return;
    setBusy(member.id);
    setError(null);
    setStatus(`Removing ${member.user.displayName} from the workspace.`);
    try {
      await apiFetch(`/workspaces/members/${member.id}`, { method: 'DELETE' });
      setStatus(`${member.user.displayName} was removed from the workspace.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this member.');
      setStatus('');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="vos-team-actions">
      <p className="vos-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
      <div className="vos-team-invite" aria-busy={busy === 'invite'}>
        <label className="vos-team-field">
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
        <span className="vos-team-invite-note" id="invite-policy-note">
          Single use · expires in 72 hours · no email provider
        </span>
      </div>

      {inviteLink ? (
        <section className="vos-team-invite-result" aria-labelledby="invite-result-title">
          <strong id="invite-result-title">Copy this link now — it will not be shown again.</strong>
          <div className="vos-team-copy-row">
            <input
              ref={inviteInput}
              className="vos-input"
              readOnly
              value={inviteLink}
              aria-label="Invitation link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button className="vos-btn" type="button" onClick={copyInvite} disabled={busy !== null}>
              {busy === 'copy' ? 'Copying…' : copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="vos-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="vos-team-members" aria-label="Workspace members">
        {members.map((member) => (
          <div key={member.id} className="vos-team-member" aria-busy={busy === member.id}>
            <div className="vos-team-member-identity">
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
                className="vos-team-remove"
                type="button"
                disabled={busy === member.id}
                onClick={() => removeMember(member)}
              >
                {busy === member.id ? 'Working…' : 'Remove'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
