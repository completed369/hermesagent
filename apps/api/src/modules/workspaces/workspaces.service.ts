import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, prisma } from '@ventureos/database';
import { hashPasswordAsync } from '@ventureos/auth';
import { enforceCapabilityAdmission } from '../../common/policy/capability-admission';
import { AuditService } from '../audit/audit.service';
import { normalizeAccountIdentifier } from '../auth/auth-identifiers';
import type { CollaborationRole } from './workspaces.dto';
import type { AuthenticatedUser } from '../../common/guards/session-auth.guard';

export interface UpdateBrandingInput {
  brandName?: string;
  logoUrl?: string;
  primaryColorHex?: string;
}

@Injectable()
export class WorkspacesService {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  async getWorkspaceSummary(workspaceId: string) {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const memberCount = await prisma.workspaceMember.count({ where: { workspaceId } });
    const integrations = await prisma.integration.findMany({ where: { workspaceId } });
    // Phase 8: branding is included in the same summary the dashboard shell
    // already fetches on every page load, so white-label settings (app name,
    // logo, accent color) apply without a second round-trip.
    const branding = await prisma.workspaceBranding.findUnique({ where: { workspaceId } });
    const ventureCount = await prisma.ventureProposal.count({ where: { workspaceId } });
    return { workspace, memberCount, integrations, branding, ventureCount };
  }

  /** Upserts (rather than requiring a prior row to exist) since a workspace
   * created before this endpoint existed might not have a WorkspaceBranding
   * row yet -- every workspace created via seed/registration going forward
   * always gets one, but this keeps the endpoint safe either way. */
  async updateBranding(workspaceId: string, input: UpdateBrandingInput) {
    await enforceCapabilityAdmission(workspaceId, 'WHITE_LABEL_BRANDING', 'internal');
    return prisma.workspaceBranding.upsert({
      where: { workspaceId },
      update: input,
      create: { workspaceId, ...input },
    });
  }

  async listMembers(workspaceId: string) {
    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        createdAt: true,
        user: { select: { id: true, email: true, displayName: true, isFounder: true } },
        role: { select: { key: true, name: true } },
      },
    });
  }

  async listAvailableWorkspaces(userId: string) {
    return prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        workspace: { select: { id: true, name: true, slug: true } },
        role: { select: { key: true, name: true } },
      },
    });
  }

  async switchWorkspace(sessionId: string, userId: string, workspaceId: string) {
    return prisma.$transaction(async (tx) => {
      await lockMemberAccount(tx, userId);
      const session = await tx.session.findFirst({
        where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { activeWorkspaceId: true },
      });
      if (!session) throw new UnauthorizedException('Session invalid or expired');

      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: {
          workspace: { select: { id: true, name: true, slug: true } },
          role: { select: { key: true, name: true } },
        },
      });
      if (!membership) throw new ForbiddenException('Workspace membership is required');

      const switched = await tx.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { activeWorkspaceId: workspaceId },
      });
      if (switched.count !== 1) throw new UnauthorizedException('Session invalid or expired');
      if (session.activeWorkspaceId !== workspaceId) {
        await this.auditService.record(
          workspaceId,
          {
            actorId: userId,
            action: 'WORKSPACE_SESSION_SWITCHED',
            entityType: 'Session',
            entityId: sessionId,
            // This audit record belongs to the target workspace. Do not copy
            // a foreign workspace identifier across the tenant boundary.
            before: { activeWorkspaceSelected: session.activeWorkspaceId !== null },
            after: { activeWorkspaceId: workspaceId },
          },
          tx,
        );
      }
      return membership;
    });
  }

  async createInvitation(
    workspaceId: string,
    actorId: string,
    roleKey: CollaborationRole,
    expiresInHours: number,
  ) {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenDigest = digestInvitationToken(rawToken);
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const invitation = await prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      await assertFounderMembership(tx, workspaceId, actorId);
      await assertMemberCapacity(tx, workspaceId);
      const role = await tx.role.findUnique({ where: { key: roleKey } });
      if (!role) throw new NotFoundException('Collaboration role is unavailable');
      const created = await tx.workspaceInvitation.create({
        data: { workspaceId, roleId: role.id, createdById: actorId, tokenDigest, expiresAt },
      });
      await this.auditService.record(
        workspaceId,
        {
          actorId,
          action: 'WORKSPACE_INVITATION_CREATED',
          entityType: 'WorkspaceInvitation',
          entityId: created.id,
          after: { roleKey, expiresAt: expiresAt.toISOString() },
        },
        tx,
      );
      return created;
    });

    return { id: invitation.id, token: rawToken, roleKey, expiresAt };
  }

  async getInvitation(token: string) {
    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { tokenDigest: digestInvitationToken(token) },
      include: { workspace: { select: { name: true } }, role: { select: { key: true } } },
    });
    assertInvitationActive(invitation);
    return {
      workspaceName: invitation.workspace.name,
      roleKey: invitation.role.key,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(
    token: string,
    input: { email: string; password: string; displayName: string },
  ) {
    const normalizedEmail = normalizeAccountIdentifier(input.email);
    const tokenDigest = digestInvitationToken(token);
    const preflight = await prisma.workspaceInvitation.findUnique({
      where: { tokenDigest },
      select: { acceptedAt: true, revokedAt: true, expiresAt: true },
    });
    // Reject invalid, expired, or consumed bearer credentials before invoking
    // the deliberately expensive password KDF. The invitation is reloaded
    // and rechecked under the workspace lock below before any mutation.
    assertInvitationActive(preflight);
    const passwordHash = await hashPasswordAsync(input.password);

    const runAcceptanceTransaction = () =>
      prisma.$transaction(async (tx) => {
        const invitationRef = await tx.workspaceInvitation.findUnique({
          where: { tokenDigest },
          select: { workspaceId: true },
        });
        if (!invitationRef) throw new NotFoundException('Invitation is invalid or unavailable');
        // Every acceptance takes locks in account -> workspace order. The
        // account lock closes the cross-workspace race where two invitations
        // could otherwise both observe a new email before the unique user
        // constraint is committed.
        await lockTransactionKey(tx, `workspace-invite-account:${normalizedEmail}`);
        await lockWorkspace(tx, invitationRef.workspaceId);

        const invitation = await tx.workspaceInvitation.findUnique({
          where: { tokenDigest },
          include: { role: true, workspace: true },
        });
        assertInvitationActive(invitation);
        await assertMemberCapacity(tx, invitation.workspaceId);

        const existingUser = await tx.user.findUnique({ where: { email: normalizedEmail } });
        if (existingUser) {
          // Consume the bearer credential exactly as for a new account, but
          // reserve one authenticated continuation for this exact user. A
          // preview or anonymous replay now has identical post-response state
          // regardless of whether the supplied email already existed.
          const consumed = await tx.workspaceInvitation.updateMany({
            where: { id: invitation.id, acceptedAt: null, revokedAt: null },
            data: {
              acceptedAt: new Date(),
              acceptedById: existingUser.id,
              claimPending: true,
            },
          });
          if (consumed.count !== 1) throw new ConflictException('Invitation has already been used');
          await this.auditService.record(
            invitation.workspaceId,
            {
              action: 'WORKSPACE_INVITATION_CLAIM_DEFERRED',
              entityType: 'WorkspaceInvitation',
              entityId: invitation.id,
              after: { roleKey: invitation.role.key, accountBound: true },
            },
            tx,
          );
          return { received: true as const, workspaceName: invitation.workspace.name };
        }

        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            displayName: input.displayName,
            isFounder: false,
          },
        });
        const membership = await tx.workspaceMember.create({
          data: {
            workspaceId: invitation.workspaceId,
            userId: user.id,
            roleId: invitation.roleId,
          },
        });
        const consumed = await tx.workspaceInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date(), acceptedById: user.id },
        });
        if (consumed.count !== 1) throw new ConflictException('Invitation has already been used');
        await tx.workspace.update({
          where: { id: invitation.workspaceId },
          data: { mode: 'COLLABORATIVE' },
        });
        await this.auditService.record(
          invitation.workspaceId,
          {
            actorId: user.id,
            action: 'WORKSPACE_INVITATION_ACCEPTED',
            entityType: 'WorkspaceMember',
            entityId: membership.id,
            after: { roleKey: invitation.role.key },
          },
          tx,
        );
        return { received: true as const, workspaceName: invitation.workspace.name };
      });

    try {
      return await runAcceptanceTransaction();
    } catch (error) {
      // Registration uses its own transaction and can win the same-email
      // insert race after our first read. Retry exactly once only when Prisma
      // confirms the users.email unique constraint; the retry then observes
      // the account and follows the neutral deferred path. Never normalize an
      // unrelated uniqueness or database failure.
      if (!identifiesUserEmailConstraint(error)) throw error;
      return runAcceptanceTransaction();
    }
  }

  async acceptInvitationForAuthenticatedUser(token: string, actor: AuthenticatedUser) {
    const tokenDigest = digestInvitationToken(token);
    const preflight = await prisma.workspaceInvitation.findUnique({
      where: { tokenDigest },
      select: {
        acceptedAt: true,
        acceptedById: true,
        claimPending: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    assertInvitationClaimableByActor(preflight, actor.userId);

    return prisma.$transaction(async (tx) => {
      const invitationRef = await tx.workspaceInvitation.findUnique({
        where: { tokenDigest },
        select: { workspaceId: true },
      });
      if (!invitationRef) throw new NotFoundException('Invitation is invalid or unavailable');

      await lockMemberAccount(tx, actor.userId);
      await lockWorkspace(tx, invitationRef.workspaceId);

      const session = await tx.session.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { activeWorkspaceId: true },
      });
      if (!session) throw new UnauthorizedException('Session invalid or expired');

      const invitation = await tx.workspaceInvitation.findUnique({
        where: { tokenDigest },
        include: { role: true, workspace: true },
      });
      assertInvitationClaimableByActor(invitation, actor.userId);
      const completingDeferredClaim = invitation.claimPending;

      let membership = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId: actor.userId },
        },
        include: { role: true },
      });
      const membershipAlreadyExisted = membership !== null;
      if (!membership) {
        await assertMemberCapacity(tx, invitation.workspaceId);
        membership = await tx.workspaceMember.create({
          data: {
            workspaceId: invitation.workspaceId,
            userId: actor.userId,
            roleId: invitation.roleId,
          },
          include: { role: true },
        });
      }

      // Existing memberships are deliberately retained, including when the
      // invitation proposes a different role. Only a founder may change a
      // member's role through the dedicated audited role-management endpoint.
      const consumed = completingDeferredClaim
        ? await tx.workspaceInvitation.updateMany({
            where: {
              id: invitation.id,
              acceptedById: actor.userId,
              claimPending: true,
              revokedAt: null,
            },
            data: { claimPending: false },
          })
        : await tx.workspaceInvitation.updateMany({
            where: { id: invitation.id, acceptedAt: null, revokedAt: null },
            data: { acceptedAt: new Date(), acceptedById: actor.userId },
          });
      if (consumed.count !== 1) throw new ConflictException('Invitation has already been used');
      await tx.workspace.update({
        where: { id: invitation.workspaceId },
        data: { mode: 'COLLABORATIVE' },
      });
      const switched = await tx.session.updateMany({
        where: {
          id: actor.sessionId,
          userId: actor.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { activeWorkspaceId: invitation.workspaceId },
      });
      if (switched.count !== 1) throw new UnauthorizedException('Session invalid or expired');

      await this.auditService.record(
        invitation.workspaceId,
        {
          actorId: actor.userId,
          action: 'WORKSPACE_INVITATION_ACCEPTED',
          entityType: 'WorkspaceMember',
          entityId: membership.id,
          after: {
            invitationRoleKey: invitation.role.key,
            completedDeferredClaim: completingDeferredClaim,
            membershipAlreadyExisted,
            roleKey: membership.role.key,
          },
        },
        tx,
      );
      if (session.activeWorkspaceId !== invitation.workspaceId) {
        await this.auditService.record(
          invitation.workspaceId,
          {
            actorId: actor.userId,
            action: 'WORKSPACE_SESSION_SWITCHED',
            entityType: 'Session',
            entityId: actor.sessionId,
            // Keep the target tenant's audit trail useful without disclosing
            // the identifier of the workspace the member came from.
            before: { activeWorkspaceSelected: session.activeWorkspaceId !== null },
            after: {
              activeWorkspaceId: invitation.workspaceId,
              reason: 'INVITATION_ACCEPTED',
            },
          },
          tx,
        );
      }

      return {
        joined: true as const,
        roleKey: membership.role.key,
        workspaceId: invitation.workspaceId,
        workspaceName: invitation.workspace.name,
      };
    });
  }

  async changeMemberRole(
    workspaceId: string,
    actorId: string,
    memberId: string,
    roleKey: CollaborationRole,
  ) {
    return prisma.$transaction(async (tx) => {
      const memberRef = await tx.workspaceMember.findFirst({
        where: { id: memberId, workspaceId },
        select: { userId: true },
      });
      if (!memberRef) throw new NotFoundException('Workspace member not found');
      await lockMemberAccount(tx, memberRef.userId);
      await lockWorkspace(tx, workspaceId);
      await assertFounderMembership(tx, workspaceId, actorId);
      const member = await tx.workspaceMember.findFirst({
        where: { id: memberId, workspaceId },
        include: { role: true, user: true },
      });
      if (!member) throw new NotFoundException('Workspace member not found');
      if (member.role.key === 'FOUNDER') {
        throw new ForbiddenException('Founder role cannot be changed');
      }
      const role = await tx.role.findUnique({ where: { key: roleKey } });
      if (!role) throw new NotFoundException('Collaboration role is unavailable');
      const updated = await tx.workspaceMember.update({
        where: { id: member.id },
        data: { roleId: role.id },
        select: { id: true, role: { select: { key: true, name: true } } },
      });
      await this.auditService.record(
        workspaceId,
        {
          actorId,
          action: 'WORKSPACE_MEMBER_ROLE_CHANGED',
          entityType: 'WorkspaceMember',
          entityId: member.id,
          before: { roleKey: member.role.key },
          after: { roleKey },
        },
        tx,
      );
      return updated;
    });
  }

  async removeMember(workspaceId: string, actorId: string, memberId: string) {
    return prisma.$transaction(async (tx) => {
      const memberRef = await tx.workspaceMember.findFirst({
        where: { id: memberId, workspaceId },
        select: { userId: true },
      });
      if (!memberRef) throw new NotFoundException('Workspace member not found');
      await lockMemberAccount(tx, memberRef.userId);
      await lockWorkspace(tx, workspaceId);
      await assertFounderMembership(tx, workspaceId, actorId);
      const member = await tx.workspaceMember.findFirst({
        where: { id: memberId, workspaceId },
        include: { role: true, user: true },
      });
      if (!member) throw new NotFoundException('Workspace member not found');
      if (member.userId === actorId || member.role.key === 'FOUNDER') {
        throw new ForbiddenException('Founder membership cannot be removed');
      }
      await tx.workspaceMember.delete({ where: { id: member.id } });
      const revokedSessions = await tx.session.updateMany({
        where: { userId: member.userId, activeWorkspaceId: workspaceId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.auditService.record(
        workspaceId,
        {
          actorId,
          action: 'WORKSPACE_MEMBER_REMOVED',
          entityType: 'WorkspaceMember',
          entityId: member.id,
          before: { roleKey: member.role.key, userId: member.userId },
          after: { revokedSessionCount: revokedSessions.count },
        },
        tx,
      );
      return { removed: true as const };
    });
  }
}

function digestInvitationToken(token: string): string {
  return createHash('sha256').update(`ventureos-workspace-invite:${token}`).digest('hex');
}

function assertInvitationActive<
  T extends { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
>(invitation: T | null): asserts invitation is T {
  if (!invitation) throw new NotFoundException('Invitation is invalid or unavailable');
  if (invitation.revokedAt) throw new ConflictException('Invitation is no longer available');
  if (invitation.acceptedAt) throw new ConflictException('Invitation has already been used');
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new ConflictException('Invitation has expired');
  }
}

function assertInvitationClaimableByActor<
  T extends {
    acceptedAt: Date | null;
    acceptedById: string | null;
    claimPending: boolean;
    revokedAt: Date | null;
    expiresAt: Date;
  },
>(invitation: T | null, actorId: string): asserts invitation is T {
  if (!invitation) throw new NotFoundException('Invitation is invalid or unavailable');
  if (invitation.revokedAt) throw new ConflictException('Invitation is no longer available');
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new ConflictException('Invitation has expired');
  }
  if (invitation.acceptedAt && (!invitation.claimPending || invitation.acceptedById !== actorId)) {
    throw new ConflictException('Invitation has already been used');
  }
}

async function lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  await lockTransactionKey(tx, `workspace:${workspaceId}`);
}

async function lockTransactionKey(tx: Prisma.TransactionClient, key: string): Promise<void> {
  // The pg adapter cannot deserialize PostgreSQL's native `void` result, so
  // project the lock call to a supported boolean while retaining its blocking
  // transaction-scoped semantics.
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS "locked"
  `;
}

async function lockMemberAccount(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await lockTransactionKey(tx, `workspace-member-account:${userId}`);
}

function identifiesUserEmailConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2002') {
    return false;
  }
  if (!('meta' in error) || typeof error.meta !== 'object' || error.meta === null) return false;
  if (!('target' in error.meta)) return false;
  const target = error.meta.target;
  const targets = Array.isArray(target) ? target : [target];
  return targets.some(
    (value) =>
      typeof value === 'string' &&
      (value === 'email' || value.includes('users_email') || value.includes('User_email')),
  );
}

async function assertFounderMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
): Promise<void> {
  const founder = await tx.workspaceMember.findFirst({
    where: { workspaceId, userId: actorId, role: { key: 'FOUNDER' } },
    select: { id: true },
  });
  if (!founder) throw new ForbiddenException('Founder authority is required');
}

async function assertMemberCapacity(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const [subscription, memberCount] = await Promise.all([
    tx.subscription.findUnique({ where: { workspaceId }, include: { plan: true } }),
    tx.workspaceMember.count({ where: { workspaceId } }),
  ]);
  if (!subscription) throw new ForbiddenException('Workspace subscription is unavailable');
  if (memberCount >= subscription.plan.maxWorkspaceMembers) {
    throw new ForbiddenException(
      `Workspace member limit reached (${memberCount}/${subscription.plan.maxWorkspaceMembers})`,
    );
  }
}
