import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, MemberRole } from '@kurul/shared-types';
import type {
  AccountDeletionPreviewDto,
  DepartingMembershipDto,
  SoleOwnedWorkspaceDto,
} from '@kurul/shared-types';
import type { Prisma } from '../generated/prisma';
import { escapeLikePattern } from '../common/escape-like';
import { stdoutWriter, type LogWriter } from '../common/logging/json-log';
import { redactMentionsOf } from '../common/mentions/redact-mentions';
import { PrismaService } from '../prisma/prisma.service';
import { evictUserFromWorkspaceSockets } from '../realtime/workspace-socket-eviction';
import type { WorkspaceDeletedLogLine } from '../workspace/workspace.service';
import { ANONYMOUS_USER_NAME, anonymisedUserFields } from './anonymised-user';
import type { DeleteAccountDto, WorkspaceDispositionDto } from './dto/delete-account.dto';

/** Who asked for the deletion. Recorded on every row and line this flow writes. */
export type DeletionInitiator = 'self' | 'instance_admin';

/**
 * How long the whole deletion gets inside one interactive transaction.
 *
 * Prisma's default is five seconds, which is right for a request-path write and wrong for this
 * one: a `delete` disposition is a cascading delete of an entire tenant, and the mention rewrite
 * walks every comment that ever named the person. Ninety seconds is chosen against the ≤30
 * minute success metric this feature is measured by — a bound that turns a pathological case
 * into a clean rollback and a `500` rather than a half-anonymised account, while being far past
 * anything a real instance takes (a workspace with 5 000 tasks, 5 000 comments and 20 000
 * activity rows completes in seconds, measured).
 */
const DELETION_TRANSACTION_TIMEOUT_MS = 90_000;

/** Comments rewritten per round trip when redacting mentions. */
const COMMENT_REDACTION_PAGE = 500;

/** Rows touched by one execution, for the log line. */
export interface AccountDeletionCounts {
  workspacesTransferred: number;
  workspacesDeleted: number;
  membershipsRemoved: number;
  assignmentsRemoved: number;
  invitationsRevoked: number;
  /**
   * Invitations addressed *to* the departing account, whatever their state.
   *
   * Counted apart from `invitationsRevoked` because they are a different claim: that one is
   * "this account stops vouching for anybody", this one is "this account's address stops
   * existing in the database".
   */
  invitationsReceivedDeleted: number;
  commentsRedacted: number;
  activitiesRedacted: number;
  sessionsDeleted: number;
  accountsDeleted: number;
  verificationsDeleted: number;
  notificationsDeleted: number;
  usagePingsDeleted: number;
}

/**
 * The record of an account deletion that outlives every table it touched.
 *
 * `warn`, like `workspace.deleted`, and for the same reason: nothing else can notice its
 * absence later, because the thing it describes no longer exists to be compared against.
 *
 * **No e-mail address and no name.** Those are the columns this flow exists to remove, and
 * copying them into a log aggregator on the way out would move the problem rather than solve
 * it — the rule ADR 0020's retention sweep already follows.
 */
export interface AccountDeletedLogLine extends AccountDeletionCounts {
  ts: string;
  level: 'warn';
  event: 'account.deleted';
  /** The account that was anonymised. An id, which is not personal data on its own. */
  userId: string;
  initiatedBy: DeletionInitiator;
  /**
   * The instance administrator who ordered it, or null on the self-service path (where it
   * would only repeat `userId`). This is the *only* place an operator's identity is recorded:
   * it deliberately never reaches a tenant's activity feed.
   */
  actorId: string | null;
  durationMs: number;
}

/**
 * `workspace.deleted`, with the one field that says *why*.
 *
 * Additive rather than a change to `WorkspaceDeletedLogLine`: a workspace deleted as a side
 * effect of an erasure request is a different story from one an owner deleted on the settings
 * screen, and the log is the only place that distinction can survive. Every field the existing
 * line has keeps its name, so a `jq 'select(.event == "workspace.deleted")'` written before this
 * shipped still reads both.
 */
export interface AccountWorkspaceDeletedLogLine extends WorkspaceDeletedLogLine {
  /** The account whose deletion took this workspace with it. */
  deletedWithAccount: string;
}

type MembershipRow = {
  workspaceId: string;
  role: MemberRole;
  workspace: { id: string; name: string; slug: string };
};

/**
 * Executes a GDPR Article 17 / KVKK Article 7 erasure request.
 *
 * ## Why nothing here calls `auth.api.*`
 *
 * `WorkspaceMemberService`'s standing rule is that Better Auth owns membership writes, and this
 * service breaks it on purpose. That rule assumes the caller is a member of the workspace,
 * because `auth.api.removeMember` authorises against the caller's own session — and on the
 * administrator path the caller is not in the workspace at all. Better Auth's own
 * `user.deleteUser` is no help either: it hard-deletes the `user` row after its hooks run,
 * which is the exact statement seven `Restrict` foreign keys exist to refuse.
 *
 * So the three things the plugin would have done are done explicitly instead:
 *
 * 1. **Socket eviction** — `evictUserFromWorkspaceSockets` per workspace, the same call
 *    `WorkspaceMemberService.leave` makes for the same reason.
 * 2. **`session.activeOrganizationId`** — needs no clearing, because every one of the user's
 *    sessions is deleted in the same transaction.
 * 3. **The last-owner invariant** — enforced *above* by the disposition requirement rather than
 *    discovered *below* by the plugin, which is the only way the caller gets to choose.
 *
 * See `docs/decisions/0026-account-deletion-anonymisation.md`.
 */
@Injectable()
export class AccountDeletionService {
  /** Test seam, matching `CleanupWorker` and `WorkspaceService`. */
  private write: LogWriter = stdoutWriter;

  constructor(private readonly prisma: PrismaService) {}

  /** @internal — for tests. */
  setLogWriter(write: LogWriter): void {
    this.write = write;
  }

  /** The live user row, or `404` — including for an account already anonymised. */
  private async requireLiveUser(userId: string): Promise<{ id: string; email: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, deletedAt: true },
    });

    // An already-deleted account answers the same `404` as one that never existed. There is
    // nothing to hide — the tombstone is not a secret — but "this account was deleted" is a
    // statement about a person that a bare id lookup should not hand out, and re-running a
    // deletion is not an operation with a meaningful second result.
    if (!user || user.deletedAt !== null) {
      throw new NotFoundException('Account not found');
    }

    return { id: user.id, email: user.email };
  }

  /**
   * Every workspace the user belongs to, split into the ones that need a decision and the ones
   * that do not.
   *
   * "Needs a decision" is `role = OWNER` **and** no other OWNER in the workspace — the same
   * predicate `WorkspaceMemberService.isLastOwner` uses, so leaving and being deleted agree
   * about what the last owner is.
   */
  private async partitionMemberships(userId: string): Promise<{
    soleOwned: MembershipRow[];
    other: MembershipRow[];
  }> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      select: {
        workspaceId: true,
        role: true,
        workspace: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { workspaceId: 'asc' },
    });

    const ownedIds = memberships
      .filter((row) => row.role === MemberRole.OWNER)
      .map((row) => row.workspaceId);

    // One grouped count for every owned workspace rather than a count per workspace: the number
    // of workspaces one person owns is small, but the query count should not grow with it.
    const ownerCounts =
      ownedIds.length === 0
        ? []
        : await this.prisma.workspaceMember.groupBy({
            by: ['workspaceId'],
            where: { workspaceId: { in: ownedIds }, role: MemberRole.OWNER },
            _count: { _all: true },
          });
    const ownersByWorkspace = new Map(ownerCounts.map((row) => [row.workspaceId, row._count._all]));

    const soleOwned: MembershipRow[] = [];
    const other: MembershipRow[] = [];
    for (const row of memberships) {
      const isSoleOwner =
        row.role === MemberRole.OWNER && (ownersByWorkspace.get(row.workspaceId) ?? 0) <= 1;
      (isSoleOwner ? soleOwned : other).push(row);
    }

    return { soleOwned, other };
  }

  /** What the deletion is about to do, before any of it happens. */
  async preview(userId: string): Promise<AccountDeletionPreviewDto> {
    await this.requireLiveUser(userId);
    const { soleOwned, other } = await this.partitionMemberships(userId);

    const soleOwnedWorkspaces: SoleOwnedWorkspaceDto[] = [];
    for (const membership of soleOwned) {
      const [memberCount, boardCount, candidates] = await Promise.all([
        this.prisma.workspaceMember.count({ where: { workspaceId: membership.workspaceId } }),
        this.prisma.board.count({ where: { workspaceId: membership.workspaceId } }),
        this.prisma.workspaceMember.findMany({
          where: {
            workspaceId: membership.workspaceId,
            userId: { not: userId },
            // A tombstone cannot be promoted: it has no session, no credentials and no way to
            // ever act as an owner, so offering one would be offering to strand the workspace.
            user: { deletedAt: null },
          },
          select: { userId: true, role: true, user: { select: { name: true } } },
          orderBy: { id: 'asc' },
        }),
      ]);

      soleOwnedWorkspaces.push({
        workspaceId: membership.workspaceId,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        memberCount,
        boardCount,
        transferCandidates: candidates.map((row) => ({
          userId: row.userId,
          name: row.user.name,
          role: row.role,
        })),
      });
    }

    const otherWorkspaces: DepartingMembershipDto[] = other.map((row) => ({
      workspaceId: row.workspaceId,
      name: row.workspace.name,
      role: row.role,
    }));

    const [comments, tasksCreated, attachments, activities] = await Promise.all([
      this.prisma.comment.count({ where: { userId } }),
      this.prisma.task.count({ where: { createdById: userId } }),
      this.prisma.attachment.count({ where: { uploadedById: userId } }),
      this.prisma.activity.count({ where: { userId } }),
    ]);

    return {
      userId,
      soleOwnedWorkspaces,
      otherWorkspaces,
      retainedContent: { comments, tasksCreated, attachments, activities },
    };
  }

  /**
   * Matches the request's dispositions against the workspaces that actually need one.
   *
   * Refuses in both directions. A workspace left undecided is the failure this whole design
   * exists to prevent; a disposition naming a workspace that needs no decision means the client
   * is working from a stale preview, and silently ignoring it would let "transfer this one"
   * disappear without a word.
   */
  private matchDispositions(
    soleOwned: MembershipRow[],
    dispositions: WorkspaceDispositionDto[],
  ): Map<string, WorkspaceDispositionDto> {
    const required = new Set(soleOwned.map((row) => row.workspaceId));
    const byWorkspace = new Map<string, WorkspaceDispositionDto>();

    for (const disposition of dispositions) {
      if (byWorkspace.has(disposition.workspaceId)) {
        throw new ConflictException(
          `Two decisions were sent for the same workspace: ${disposition.workspaceId}`,
        );
      }
      if (!required.has(disposition.workspaceId)) {
        throw new ConflictException(
          `This account is not the only owner of workspace ${disposition.workspaceId}; no decision is needed for it`,
        );
      }
      byWorkspace.set(disposition.workspaceId, disposition);
    }

    const undecided = [...required].filter((id) => !byWorkspace.has(id));
    if (undecided.length > 0) {
      // The message names them, because the client's next move is to ask about exactly these.
      throw new ConflictException(
        `Decide what happens to each workspace this account solely owns before it can be deleted: ${undecided.join(', ')}`,
      );
    }

    return byWorkspace;
  }

  /**
   * Executes the request.
   *
   * One interactive transaction, so a failure anywhere leaves a live account rather than a
   * half-anonymised one. Socket eviction and the log line are deliberately outside it: neither
   * can be rolled back, and evicting a socket for a deletion that did not commit would be a
   * lie the user could see.
   */
  async deleteAccount(
    userId: string,
    dto: DeleteAccountDto,
    initiatedBy: DeletionInitiator,
    actorId: string | null,
  ): Promise<AccountDeletionCounts> {
    const startedAt = process.hrtime.bigint();
    const user = await this.requireLiveUser(userId);

    if (dto.confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      // `403`, not `400`: the request is well-formed and the caller is authenticated — what
      // failed is the confirmation, and the answer should read as a refusal rather than as a
      // schema complaint. Case-insensitive on both sides, matching `isInstanceAdmin`: no mail
      // provider treats the local part as case-sensitive and being strict here only produces
      // a refusal nobody can explain.
      throw new ForbiddenException('The confirmation address does not match this account');
    }

    const { soleOwned, other } = await this.partitionMemberships(userId);
    const dispositions = this.matchDispositions(soleOwned, dto.dispositions ?? []);
    const deletedAt = new Date();

    const { counts, deletedWorkspaces, evictions } = await this.prisma.$transaction(
      async (tx) => {
        const result: AccountDeletionCounts = {
          workspacesTransferred: 0,
          workspacesDeleted: 0,
          membershipsRemoved: 0,
          assignmentsRemoved: 0,
          invitationsRevoked: 0,
          invitationsReceivedDeleted: 0,
          commentsRedacted: 0,
          activitiesRedacted: 0,
          sessionsDeleted: 0,
          accountsDeleted: 0,
          verificationsDeleted: 0,
          notificationsDeleted: 0,
          usagePingsDeleted: 0,
        };
        const removedWorkspaces: AccountWorkspaceDeletedLogLine[] = [];
        const evictFrom: string[] = [];

        for (const membership of soleOwned) {
          const disposition = dispositions.get(membership.workspaceId);
          // `matchDispositions` proved every sole-owned workspace has one, so this is the
          // invariant restated rather than a case that can happen — and restating it is what
          // keeps a future edit to that method from silently skipping a workspace here.
          if (!disposition) {
            throw new ConflictException(
              `Decide what happens to workspace ${membership.workspaceId} before this account can be deleted`,
            );
          }

          if (disposition.action === 'transfer' && disposition.newOwnerUserId !== undefined) {
            await this.transferOwnership(tx, membership, disposition.newOwnerUserId, userId);
            result.workspacesTransferred += 1;
            continue;
          }
          if (disposition.action === 'transfer') {
            // Unreachable through the DTO, whose `ValidateIf` makes the field required for a
            // transfer. Stated rather than asserted away, because the alternative to this branch
            // is a non-null assertion that turns a validation regression into a silent delete.
            throw new ConflictException(
              `A transfer needs a new owner for workspace ${membership.workspaceId}`,
            );
          }

          removedWorkspaces.push(
            await this.deleteWorkspace(tx, membership.workspaceId, userId, actorId ?? userId),
          );
          result.workspacesDeleted += 1;
        }

        // Every workspace whose rows survive this request: the transferred ones plus the ones
        // that needed no decision. Deliberately not the deleted ones — an activity row there
        // would be removed by the statement that deleted the workspace, which is the same
        // reason there is no `workspace.deleted` activity type.
        const surviving = [
          ...soleOwned.filter((row) => dispositions.get(row.workspaceId)?.action === 'transfer'),
          ...other,
        ];

        for (const membership of surviving) {
          await tx.activity.create({
            data: {
              workspaceId: membership.workspaceId,
              // The subject, never the administrator who may have ordered it: an operator's
              // identity must not appear in a tenant's feed. Their half of the record is the
              // JSON log line, which is instance-scoped by nature.
              userId,
              type: ActivityType.AccountDeleted,
              payload: {
                targetUserId: userId,
                previousRole: membership.role,
                initiatedBy,
              },
            },
          });
          evictFrom.push(membership.workspaceId);
        }

        // An assignment is a live claim on unfinished work, not history: a card assigned to a
        // deleted account looks owned and is not.
        result.assignmentsRemoved = (await tx.taskAssignee.deleteMany({ where: { userId } })).count;

        // Pending invitations only. An accepted or revoked one is a record of something that
        // happened and keeps pointing at the tombstone; a pending one is a live grant of access
        // that a deleted account would still be vouching for.
        result.invitationsRevoked = (
          await tx.workspaceInvitation.deleteMany({
            where: { inviterId: userId, status: 'pending' },
          })
        ).count;

        // The other side of the same table, and the one anonymisation cannot reach.
        // `WorkspaceInvitation.email` is a literal address in a column of its own — nothing
        // about it is derived from `User`, so rewriting the `User` row to
        // `deleted-<id>@deleted.invalid` leaves every invitation ever sent to this person still
        // spelling out where they can be reached. An erasure request that leaves the address in
        // the database has not erased it (audit finding DB-01).
        //
        // Every state, not only `pending`: unlike the inviter side above, the accepted row is
        // not somebody else's record of something that happened *to them* — it is a copy of the
        // departing person's own contact details, and there is no reading of Article 17 under
        // which that survives the request. What is kept is the workspace's history of the
        // membership itself, which lives in `WorkspaceMember` and `Activity` and never carried
        // the address.
        //
        // **Plain equality on the lower-cased address, and `mode: 'insensitive'` is not an
        // option here.** Prisma compiles `equals` + `mode: 'insensitive'` on PostgreSQL to
        // `ILIKE`, and it passes the operand through as a pattern rather than as a literal — so
        // every `_` and `%` in the departing person's own address becomes a wildcard. Deleting
        // `john_doe@example.com` would have matched `john.doe@example.com` and
        // `johnXdoe@example.com` as well, in *every* workspace on the instance, including live
        // pending grants belonging to people who have nothing to do with this request. A
        // deletion that widens itself by the shape of the address it was given is worse than
        // the leak it was closing.
        //
        // Lower-casing one side is the whole of the case question, because only one side can be
        // mixed: this column is written on exactly one path — Better Auth's `create-invitation`
        // route lower-cases `email` before the adapter writes it, and
        // `WorkspaceInvitationService.createInvitation` lower-cases it again before calling
        // that route, which is the same assumption `findPendingInvitations` already reads by.
        // `User.email` is whatever was registered, so it is the side that gets `toLowerCase()`.
        result.invitationsReceivedDeleted = (
          await tx.workspaceInvitation.deleteMany({
            where: { email: user.email.toLowerCase() },
          })
        ).count;

        result.commentsRedacted = await this.redactCommentMentions(tx, userId);
        result.activitiesRedacted = await this.redactActivityPayloads(tx, userId);

        result.notificationsDeleted = (
          await tx.notification.deleteMany({ where: { userId } })
        ).count;
        result.usagePingsDeleted = (await tx.usagePing.deleteMany({ where: { userId } })).count;
        result.sessionsDeleted = (await tx.session.deleteMany({ where: { userId } })).count;
        result.accountsDeleted = (await tx.account.deleteMany({ where: { userId } })).count;
        // `Verification` has no `userId`, so `identifier` is its only link to a person — and
        // what that column holds depends on the flow. Better Auth 1.6 writes an *opaque* token
        // for the two flows this deployment can reach (`reset-password:<token>`,
        // `delete-account-<token>`), and e-mail verification does not touch this table at all:
        // its link is a JWT signed with the secret. The address only lands here through the
        // OTP/magic-link plugins, which are not enabled today.
        //
        // So this is a `contains` on the address rather than an equality, and it is honest
        // about its reach: it removes every row that *names* the person, and it cannot remove a
        // row that does not. Those are covered by their own expiry, which ADR 0020's nightly
        // sweep already enforces — a `reset-password` token outlives its user by at most an
        // hour and carries no address to disclose in the meantime.
        //
        // `escapeLikePattern` for the same reason the comment two blocks up rules out
        // `mode: 'insensitive'` on the invitation delete: plain `contains` compiles to the same
        // unescaped `LIKE` (empirically confirmed — see `escapeLikePattern`'s doc comment), and
        // an email local-part is free to contain `_`, a legal RFC 5321 character. Unescaped,
        // deleting `john_doe@example.com`'s verification rows would also delete
        // `johnXdoe@example.com`'s — someone else's live token, caught by a pattern that was
        // never supposed to be a pattern.
        result.verificationsDeleted = (
          await tx.verification.deleteMany({
            where: { identifier: { contains: escapeLikePattern(user.email) } },
          })
        ).count;

        result.membershipsRemoved = (
          await tx.workspaceMember.deleteMany({ where: { userId } })
        ).count;

        await tx.user.update({
          where: { id: userId },
          data: anonymisedUserFields(userId, deletedAt),
        });

        return { counts: result, deletedWorkspaces: removedWorkspaces, evictions: evictFrom };
      },
      { timeout: DELETION_TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
    );

    // After the commit, and never inside it. A socket dropped for a transaction that then
    // rolled back is a user thrown out of a workspace they are still in.
    for (const workspaceId of evictions) {
      await evictUserFromWorkspaceSockets(workspaceId, userId);
    }

    for (const line of deletedWorkspaces) {
      this.write(JSON.stringify(line));
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line: AccountDeletedLogLine = {
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'account.deleted',
      userId,
      initiatedBy,
      actorId,
      durationMs: Math.round(durationMs * 1000) / 1000,
      ...counts,
    };
    this.write(JSON.stringify(line));

    return counts;
  }

  /** Promotes the named member to OWNER, and records who ordered it. */
  private async transferOwnership(
    tx: Prisma.TransactionClient,
    membership: MembershipRow,
    newOwnerUserId: string,
    departingUserId: string,
  ): Promise<void> {
    const target = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: membership.workspaceId, userId: newOwnerUserId },
      },
      select: { role: true, user: { select: { name: true, deletedAt: true } } },
    });

    // Scoped by workspace, so a member id from another tenant is indistinguishable from one
    // that does not exist — the same opacity `WorkspaceMemberService.requireMember` gives.
    if (!target || newOwnerUserId === departingUserId) {
      throw new NotFoundException('Workspace member not found');
    }
    if (target.user.deletedAt !== null) {
      // Reachable only by racing a second deletion, and worth its own answer: silently
      // promoting a tombstone would leave the workspace with an owner that can never sign in.
      throw new ConflictException('That member has been deleted and cannot become an owner');
    }

    await tx.workspaceMember.update({
      where: {
        workspaceId_userId: { workspaceId: membership.workspaceId, userId: newOwnerUserId },
      },
      data: { role: MemberRole.OWNER },
    });

    // The same shape `WorkspaceMemberService.updateMemberRole` writes, so an investigation
    // reading the audit trail cannot tell a promotion ordered here from one ordered on the
    // members screen — and does not have to, because both are the same fact.
    await tx.activity.create({
      data: {
        workspaceId: membership.workspaceId,
        userId: departingUserId,
        type: ActivityType.MemberRoleChanged,
        payload: {
          targetUserId: newOwnerUserId,
          targetName: target.user.name,
          previousRole: target.role,
          newRole: MemberRole.OWNER,
          actorRole: membership.role,
          reason: 'account.deleted',
        },
      },
    });
  }

  /**
   * Deletes one workspace and returns the line that will outlive it.
   *
   * The details are gathered before the delete for the reason `WorkspaceService.remove`
   * documents: afterwards even the name cannot be looked up. The line shape is imported from
   * there rather than reinvented, so `docker logs | jq 'select(.event == "workspace.deleted")'`
   * finds both without knowing which path produced them.
   */
  private async deleteWorkspace(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    departingUserId: string,
    actorId: string,
  ): Promise<AccountWorkspaceDeletedLogLine> {
    const doomed = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        name: true,
        slug: true,
        _count: { select: { members: true, boards: true } },
      },
    });

    // Prisma rather than `auth.api.deleteOrganization`, for the reason in the class comment:
    // the plugin authorises against the caller's session and the administrator path has no
    // membership in this workspace. Everything below the row is Postgres's own cascade, which
    // is what the plugin's delete would have triggered too.
    await tx.workspace.delete({ where: { id: workspaceId } });

    return {
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'workspace.deleted',
      workspaceId,
      actorId,
      name: doomed?.name ?? null,
      slug: doomed?.slug ?? null,
      memberCount: doomed?._count.members ?? null,
      boardCount: doomed?._count.boards ?? null,
      deletedWithAccount: departingUserId,
    };
  }

  /**
   * Rewrites `@[Name](userId)` to `@[Deleted user](userId)` in every comment that mentions the
   * departing user.
   *
   * This is the part an anonymisation most easily misses. The mention picker binds the display
   * name it saw into the comment body at write time, so the name is literal text in `Comment.body`
   * and updating the `User` row does not touch it. See `common/mentions/redact-mentions.ts`.
   *
   * Paged by `id` rather than read whole: the count is bounded by how often one person was
   * mentioned, which is not bounded by anything in the schema. `contains` is a `LIKE '%…%'` and
   * therefore a scan — accepted, because this runs once per account, ever, off any hot path.
   *
   * `userId` is not run through `escapeLikePattern`, unlike the other `contains` calls this
   * flow makes: it is a `uuid(7)` this service reads out of `User.id`, never text a person
   * typed, and its alphabet (hex digits and hyphens) cannot contain `%` or `_` to begin with.
   */
  private async redactCommentMentions(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    let cursor: string | undefined;
    let rewritten = 0;

    for (;;) {
      const page = await tx.comment.findMany({
        where: {
          body: { contains: userId },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, body: true },
        orderBy: { id: 'asc' },
        take: COMMENT_REDACTION_PAGE,
      });
      if (page.length === 0) return rewritten;

      for (const comment of page) {
        const body = redactMentionsOf(comment.body, userId, ANONYMOUS_USER_NAME);
        // A body can contain the id without containing a mention of it — a task URL pasted
        // into a sentence, for instance. Writing it back unchanged would inflate the count the
        // log line reports into something nobody could reconcile.
        if (body === comment.body) continue;
        await tx.comment.update({ where: { id: comment.id }, data: { body } });
        rewritten += 1;
      }

      cursor = page[page.length - 1]!.id;
      if (page.length < COMMENT_REDACTION_PAGE) return rewritten;
    }
  }

  /**
   * Replaces `payload.targetName` wherever the payload is about the departing user.
   *
   * Exactly one field, named rather than pattern-matched. Activity payloads in this codebase
   * carry ids and not names — `assigneeUserId`, `actorId`, `invitationId`, `mentionedUserIds` —
   * and `targetName` is the single exception, written by `member.removed`, `member.left` and
   * `member.role_changed` so the entry stays readable after the roster row is gone. A rule like
   * "scrub anything that looks like a name" over an open `Json` column would either miss the
   * next field or corrupt an unrelated one.
   *
   * `jsonb_set(…, false)` and the `IS NOT NULL` guard both say the same thing from opposite
   * sides: never create the key on a payload that did not have it.
   */
  private async redactActivityPayloads(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    return tx.$executeRaw`
      UPDATE "Activity"
      SET "payload" = jsonb_set("payload", '{targetName}', to_jsonb(${ANONYMOUS_USER_NAME}::text), false)
      WHERE "payload"->>'targetUserId' = ${userId}
        AND "payload"->>'targetName' IS NOT NULL
    `;
  }
}
