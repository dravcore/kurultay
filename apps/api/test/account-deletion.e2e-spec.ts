import { INestApplication } from '@nestjs/common';
import { ActivityType, AttachmentKind, MemberRole } from '@kurul/shared-types';
import type { AccountDeletionPreviewDto } from '@kurul/shared-types';
import request from 'supertest';
import { App } from 'supertest/types';
import { ANONYMOUS_USER_NAME, anonymisedEmailFor } from '../src/account/anonymised-user';
import { INSTANCE_ADMIN_EMAILS_ENV } from '../src/common/guards/instance-admin.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import {
  addMember,
  confirmEmail,
  createWorkspace,
  signUp,
  uniqueEmail,
  uniqueSuffix,
  type TestUser,
} from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * Account deletion as an erasure request, driven through the real HTTP surface
 * (audit finding DB-05, `docs/decisions/0026-account-deletion-anonymisation.md`).
 *
 * The spec is organised around the two claims the ADR actually makes, because those are the two
 * that can silently stop being true:
 *
 * 1. **Zero `Restrict` foreign-key violations.** Seven relations point at `User` with
 *    `onDelete: Restrict`, and the design's whole answer is that the row is never deleted. The
 *    fixture below deliberately populates *all seven* before deleting, and the assertions read
 *    every one of them back. A design that quietly started deleting the row would fail at the
 *    database, not in an assertion — which is the point.
 * 2. **The person is gone and the content is not.** Not only the `User` columns: the display
 *    name is also copied into comment bodies (mention markup) and into one `Activity.payload`
 *    field, and an anonymisation that misses those has changed nothing anybody can see.
 */
describe('Account deletion and anonymisation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const savedAdmins = process.env[INSTANCE_ADMIN_EMAILS_ENV];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (savedAdmins === undefined) delete process.env[INSTANCE_ADMIN_EMAILS_ENV];
    else process.env[INSTANCE_ADMIN_EMAILS_ENV] = savedAdmins;
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    delete process.env[INSTANCE_ADMIN_EMAILS_ENV];
  });

  async function userId(user: TestUser): Promise<string> {
    const me = await user.agent.get('/me').expect(200);
    return (me.body as { id: string }).id;
  }

  async function preview(user: TestUser): Promise<AccountDeletionPreviewDto> {
    const response = await user.agent.get('/me/deletion-preview').expect(200);
    return response.body as AccountDeletionPreviewDto;
  }

  /**
   * A departing user who has touched **every one of the seven `Restrict` relations**:
   * membership, an invitation they sent, a task they created, an assignment, a comment, an
   * activity row, and an uploaded attachment.
   *
   * The workspace has a second OWNER, so nothing here needs a disposition — the owned-workspace
   * question has its own tests below.
   */
  async function seedContentfulUser(options?: { departingEmail?: string }): Promise<{
    departing: TestUser;
    departingId: string;
    keeper: TestUser;
    keeperId: string;
    workspaceId: string;
    boardId: string;
    columnId: string;
    taskId: string;
    commentId: string;
    attachmentId: string;
    pendingInvitationId: string;
  }> {
    const keeper = await signUp(app, { name: 'Keeper' });
    const departing = await signUp(app, {
      name: 'Ada Lovelace',
      ...(options?.departingEmail === undefined ? {} : { email: options.departingEmail }),
    });
    const keeperId = await userId(keeper);
    const departingId = await userId(departing);

    const workspace = await createWorkspace(keeper.agent, 'Shared', 'shared');
    await addMember(prisma, workspace.id, departingId, MemberRole.OWNER);
    await confirmEmail(app, prisma, departing);

    const board = await departing.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Delivery' })
      .expect(201);
    const boardId = (board.body as { id: string }).id;

    const columns = await departing.agent
      .get(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
      .expect(200);
    const columnId = (columns.body as { id: string }[])[0]!.id;

    const task = await departing.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'Ship it', columnId })
      .expect(201);
    const taskId = (task.body as { id: string }).id;

    await departing.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/assignees`)
      .send({ userId: departingId })
      .expect(201);

    const comment = await departing.agent
      .post(`/workspaces/${workspace.id}/tasks/${taskId}/comments`)
      .send({ body: 'I looked at this and it is fine' })
      .expect(201);
    const commentId = (comment.body as { id: string }).id;

    // Written directly: the attachment relation is one of the seven, and the upload path needs
    // a configured `STORAGE_PATH` this suite does not have. A LINK needs no storage and is the
    // same foreign key.
    const attachment = await prisma.attachment.create({
      data: {
        taskId,
        uploadedById: departingId,
        kind: AttachmentKind.Link,
        filename: 'The spec',
        url: 'https://example.com/spec',
      },
      select: { id: true },
    });

    const invitation = await departing.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: uniqueEmail('invitee'), role: MemberRole.MEMBER })
      .expect(201);

    return {
      departing,
      departingId,
      keeper,
      keeperId,
      workspaceId: workspace.id,
      boardId,
      columnId,
      taskId,
      commentId,
      attachmentId: attachment.id,
      pendingInvitationId: (invitation.body as { id: string }).id,
    };
  }

  describe('the seven Restrict foreign keys', () => {
    it('keeps every authorship reference resolvable, and the content readable', async () => {
      const seed = await seedContentfulUser();

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      // The row is still there. Everything below depends on it, and `DELETE FROM "User"` would
      // have failed on the first foreign key rather than reaching any of these.
      const user = await prisma.user.findUnique({ where: { id: seed.departingId } });
      expect(user).not.toBeNull();

      // Six of the seven relations still point at it. `WorkspaceMember` is the seventh and is
      // asserted separately below: membership is revoked by design, so "still resolvable" is
      // the wrong claim for it — what matters there is that the delete was legal at all.
      const [task, comment, attachment, activity, invitation] = await Promise.all([
        prisma.task.findUnique({
          where: { id: seed.taskId },
          include: { createdBy: { select: { id: true, name: true } } },
        }),
        prisma.comment.findUnique({
          where: { id: seed.commentId },
          include: { user: { select: { id: true, name: true } } },
        }),
        prisma.attachment.findUnique({
          where: { id: seed.attachmentId },
          include: { uploadedBy: { select: { id: true, name: true } } },
        }),
        prisma.activity.findFirst({
          where: { userId: seed.departingId, type: ActivityType.TaskCreated },
          include: { user: { select: { id: true, name: true } } },
        }),
        prisma.workspaceInvitation.findFirst({
          where: { inviterId: seed.departingId },
          include: { inviter: { select: { id: true } } },
        }),
      ]);

      expect(task?.createdBy.id).toBe(seed.departingId);
      expect(comment?.user.id).toBe(seed.departingId);
      expect(attachment?.uploadedBy.id).toBe(seed.departingId);
      expect(activity?.user.id).toBe(seed.departingId);
      // The pending invitation is revoked (it is a live grant of access), so the only inviter
      // reference left is the one this asserts does *not* exist — see the invitation test below.
      expect(invitation).toBeNull();

      // ...and every one of them now names nobody.
      expect(task?.createdBy.name).toBe(ANONYMOUS_USER_NAME);
      expect(comment?.user.name).toBe(ANONYMOUS_USER_NAME);
      expect(attachment?.uploadedBy.name).toBe(ANONYMOUS_USER_NAME);

      // The content itself is untouched — this is the half that makes it anonymisation rather
      // than deletion of other people's history.
      expect(task?.title).toBe('Ship it');
      expect(comment?.body).toBe('I looked at this and it is fine');
    });

    it('is legal at the database: the membership delete the flow performs does not violate anything', async () => {
      const seed = await seedContentfulUser();

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const memberships = await prisma.workspaceMember.findMany({
        where: { userId: seed.departingId },
      });
      expect(memberships).toHaveLength(0);

      // The workspace survives with its other OWNER — the departure took nothing with it.
      const remaining = await prisma.workspaceMember.findMany({
        where: { workspaceId: seed.workspaceId },
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.userId).toBe(seed.keeperId);
    });
  });

  describe('what the anonymised row says', () => {
    it('rewrites every identifying column and stamps deletedAt', async () => {
      const seed = await seedContentfulUser();
      await prisma.user.update({
        where: { id: seed.departingId },
        data: { avatarUrl: 'https://example.com/ada.png', locale: 'tr' },
      });

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: seed.departingId } });
      expect(user.email).toBe(anonymisedEmailFor(seed.departingId));
      expect(user.name).toBe(ANONYMOUS_USER_NAME);
      expect(user.avatarUrl).toBeNull();
      expect(user.locale).toBeNull();
      expect(user.emailVerified).toBe(false);
      expect(user.deletedAt).toBeInstanceOf(Date);
    });

    it('derives the replacement address from the id, so it cannot be recomputed from the old one', async () => {
      const seed = await seedContentfulUser();
      const originalEmail = seed.departing.email;

      await seed.departing.agent.delete('/me').send({ confirmEmail: originalEmail }).expect(204);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: seed.departingId } });
      // The point of ADR 0026's departure from the audit's "hash the address" recommendation:
      // nothing derived from the old address is stored, so holding a list of addresses proves
      // nothing about who had an account here.
      expect(user.email).not.toContain(originalEmail.split('@')[0]);
      expect(user.email.endsWith('@deleted.invalid')).toBe(true);
    });

    it('frees the address for a fresh sign-up, which gets a different id', async () => {
      const seed = await seedContentfulUser();
      const originalEmail = seed.departing.email;

      await seed.departing.agent.delete('/me').send({ confirmEmail: originalEmail }).expect(204);

      const reborn = await signUp(app, { email: originalEmail, name: 'Ada Again' });
      const rebornId = await userId(reborn);

      expect(rebornId).not.toBe(seed.departingId);
      // ...and the old content stayed with the tombstone rather than following the address.
      const task = await prisma.task.findUniqueOrThrow({ where: { id: seed.taskId } });
      expect(task.createdById).toBe(seed.departingId);
    });
  });

  describe('the name copied out of the User row', () => {
    it('rewrites the display name inside every mention of the departing user', async () => {
      const seed = await seedContentfulUser();

      const mention = await seed.keeper.agent
        .post(`/workspaces/${seed.workspaceId}/tasks/${seed.taskId}/comments`)
        .send({
          body: `Thanks @[Ada Lovelace](${seed.departingId}), and cc @[Keeper](${seed.keeperId})`,
        })
        .expect(201);
      const mentionId = (mention.body as { id: string }).id;

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const rewritten = await prisma.comment.findUniqueOrThrow({ where: { id: mentionId } });
      expect(rewritten.body).toContain(`@[${ANONYMOUS_USER_NAME}](${seed.departingId})`);
      expect(rewritten.body).not.toContain('Ada Lovelace');
      // The other person in the same sentence is untouched, and the mention still resolves —
      // the id half is deliberately preserved so the comment stays a sentence.
      expect(rewritten.body).toContain(`@[Keeper](${seed.keeperId})`);
    });

    it('scrubs Activity.payload.targetName where the payload is about the departing user', async () => {
      const keeper = await signUp(app, { name: 'Keeper' });
      const departing = await signUp(app, { name: 'Ada Lovelace' });
      const other = await signUp(app, { name: 'Grace Hopper' });
      const keeperId = await userId(keeper);
      const departingId = await userId(departing);
      const otherId = await userId(other);

      const workspace = await createWorkspace(keeper.agent, 'Roster', 'roster');
      await addMember(prisma, workspace.id, departingId, MemberRole.MEMBER);
      await addMember(prisma, workspace.id, otherId, MemberRole.MEMBER);

      // Two role changes: one naming the departing user, one naming somebody else.
      await keeper.agent
        .patch(`/workspaces/${workspace.id}/members/${departingId}/role`)
        .send({ role: MemberRole.ADMIN })
        .expect(200);
      await keeper.agent
        .patch(`/workspaces/${workspace.id}/members/${otherId}/role`)
        .send({ role: MemberRole.ADMIN })
        .expect(200);

      const before = await prisma.activity.findMany({
        where: { workspaceId: workspace.id, type: ActivityType.MemberRoleChanged },
      });
      // Length before contents: two rows carrying `targetName`, or the assertions below hold
      // vacuously over an empty list.
      expect(before).toHaveLength(2);
      expect(before.map((row) => (row.payload as Record<string, unknown>).targetName)).toEqual(
        expect.arrayContaining(['Ada Lovelace', 'Grace Hopper']),
      );

      await departing.agent.delete('/me').send({ confirmEmail: departing.email }).expect(204);

      const after = await prisma.activity.findMany({
        where: { workspaceId: workspace.id, type: ActivityType.MemberRoleChanged },
        orderBy: { id: 'asc' },
      });
      expect(after).toHaveLength(2);

      const mine = after.find(
        (row) => (row.payload as Record<string, unknown>).targetUserId === departingId,
      );
      const theirs = after.find(
        (row) => (row.payload as Record<string, unknown>).targetUserId === otherId,
      );

      expect((mine?.payload as Record<string, unknown>).targetName).toBe(ANONYMOUS_USER_NAME);
      // The other person's row is untouched. A "scrub anything that looks like a name" rule
      // would have taken this one too.
      expect((theirs?.payload as Record<string, unknown>).targetName).toBe('Grace Hopper');
      // ...and the rest of the scrubbed payload survives, so the entry still says what happened.
      expect((mine?.payload as Record<string, unknown>).previousRole).toBe(MemberRole.MEMBER);
      expect((mine?.payload as Record<string, unknown>).newRole).toBe(MemberRole.ADMIN);
      expect(keeperId).toBeTruthy();
    });

    it('does not invent a targetName on payloads that never had one', async () => {
      const seed = await seedContentfulUser();

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const taskRows = await prisma.activity.findMany({
        where: { userId: seed.departingId, type: ActivityType.TaskCreated },
      });
      expect(taskRows).toHaveLength(1);
      expect(taskRows[0]!.payload as Record<string, unknown>).not.toHaveProperty('targetName');
    });
  });

  describe('what a client can tell afterwards', () => {
    it('marks the author of a surviving comment and activity as deleted, over HTTP', async () => {
      const seed = await seedContentfulUser();

      // Before: a live author, so the assertions after the delete are about a change rather
      // than about a field that was always true.
      const before = await seed.keeper.agent
        .get(`/workspaces/${seed.workspaceId}/tasks/${seed.taskId}/comments`)
        .expect(200);
      const beforeItems = (before.body as { items: { author: { deleted: boolean } }[] }).items;
      expect(beforeItems).toHaveLength(1);
      expect(beforeItems[0]!.author.deleted).toBe(false);

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const comments = await seed.keeper.agent
        .get(`/workspaces/${seed.workspaceId}/tasks/${seed.taskId}/comments`)
        .expect(200);
      const items = (
        comments.body as { items: { body: string; author: { name: string; deleted: boolean } }[] }
      ).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.author.deleted).toBe(true);
      // The stored tombstone still travels — an API consumer that is not the web app needs
      // something readable in the field — and the comment itself is untouched.
      expect(items[0]!.author.name).toBe(ANONYMOUS_USER_NAME);
      expect(items[0]!.body).toBe('I looked at this and it is fine');

      const activities = await seed.keeper.agent
        .get(`/workspaces/${seed.workspaceId}/tasks/${seed.taskId}/activities`)
        .expect(200);
      const rows = (
        activities.body as { items: { userId: string; author: { deleted: boolean } }[] }
      ).items;
      const theirs = rows.filter((row) => row.userId === seed.departingId);
      expect(theirs.length).toBeGreaterThan(0);
      expect(theirs.every((row) => row.author.deleted)).toBe(true);
    });

    it('never publishes when the account was deleted', async () => {
      const seed = await seedContentfulUser();
      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const comments = await seed.keeper.agent
        .get(`/workspaces/${seed.workspaceId}/tasks/${seed.taskId}/comments`)
        .expect(200);

      // `deletedAt` is a date about a named individual, and this route is readable by every
      // member down to GUEST. The flag says whether; nothing says when (ADR 0026).
      expect(JSON.stringify(comments.body)).not.toContain('deletedAt');
    });
  });

  describe('what is removed outright', () => {
    it('deletes credentials, sessions, notifications, pings and open assignments', async () => {
      const seed = await seedContentfulUser();

      await prisma.usagePing.create({
        data: {
          userId: seed.departingId,
          workspaceId: seed.workspaceId,
          kind: 'board_view',
          day: new Date('2026-08-15T00:00:00.000Z'),
        },
      });

      // Written by hand, and the reason is worth recording: on this deployment Better Auth
      // never puts an address in `Verification.identifier`. E-mail verification is a JWT
      // signed with the secret and touches no row at all; password reset stores
      // `reset-password:<opaque token>`. The address only lands in this column through the
      // OTP/magic-link plugins, which are not enabled — so this row is that shape, and the
      // assertion below is about the sweep working, not about a row sign-up produced.
      await prisma.verification.create({
        data: {
          identifier: seed.departing.email,
          value: 'otp-shaped-value',
          expiresAt: new Date(Date.now() + 600_000),
        },
      });

      const before = await Promise.all([
        prisma.session.count({ where: { userId: seed.departingId } }),
        prisma.account.count({ where: { userId: seed.departingId } }),
        prisma.taskAssignee.count({ where: { userId: seed.departingId } }),
        prisma.usagePing.count({ where: { userId: seed.departingId } }),
        prisma.verification.count({ where: { identifier: { contains: seed.departing.email } } }),
      ]);
      // Every one of these has to be non-zero before the delete, or the assertions after it
      // prove nothing at all.
      for (const count of before) expect(count).toBeGreaterThan(0);

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const after = await Promise.all([
        prisma.session.count({ where: { userId: seed.departingId } }),
        prisma.account.count({ where: { userId: seed.departingId } }),
        prisma.taskAssignee.count({ where: { userId: seed.departingId } }),
        prisma.usagePing.count({ where: { userId: seed.departingId } }),
        prisma.verification.count({ where: { identifier: { contains: seed.departing.email } } }),
        prisma.notification.count({ where: { userId: seed.departingId } }),
      ]);
      expect(after).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('revokes the invitations the user had left pending, and keeps the accepted ones', async () => {
      const seed = await seedContentfulUser();

      const accepted = await prisma.workspaceInvitation.create({
        data: {
          email: uniqueEmail('joined'),
          inviterId: seed.departingId,
          workspaceId: seed.workspaceId,
          role: MemberRole.MEMBER,
          status: 'accepted',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      });

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      // The live grant of access is gone: a deleted account cannot keep vouching for someone.
      expect(
        await prisma.workspaceInvitation.findUnique({ where: { id: seed.pendingInvitationId } }),
      ).toBeNull();
      // The record of one that was actually used survives, pointing at the tombstone — which is
      // also the seventh `Restrict` foreign key doing its job.
      const kept = await prisma.workspaceInvitation.findUnique({ where: { id: accepted.id } });
      expect(kept?.inviterId).toBe(seed.departingId);
    });

    /**
     * The invitee side of `WorkspaceInvitation`, and the half anonymisation cannot reach
     * (audit finding DB-01).
     *
     * `email` is a literal address in a column of its own — nothing about it is derived from
     * `User` — so rewriting the `User` row to `deleted-<id>@deleted.invalid` leaves every
     * invitation ever *sent to* this person still spelling out where they can be reached. The
     * inviter-side rule above ("pending only") is deliberately not the rule here: an accepted
     * invitation addressed to the departing user is not somebody else's record of an event, it
     * is a copy of the departing user's own contact details.
     *
     * Every fixture is written in the casing the column actually stores. Better Auth's
     * `create-invitation` route lower-cases the address before it is written and
     * `WorkspaceInvitationService.createInvitation` lower-cases it again on the way in, so a
     * mixed-case row is not a state this table reaches — see the next test for what asking the
     * database to be case-insensitive about it instead would cost.
     */
    it('removes every invitation addressed to the departing user, in any state', async () => {
      const seed = await seedContentfulUser();
      const address = seed.departing.email;

      const invitedRows = await Promise.all(
        (
          [
            // The one they accepted to get here: a record whose only remaining content is the
            // address.
            { status: 'accepted', email: address },
            // Still open — an offer nobody answered.
            { status: 'pending', email: address },
            // They said no — and the address is still sitting there.
            { status: 'rejected', email: address },
            // An admin took it back, and the address outlived the invitation entirely.
            { status: 'canceled', email: address },
          ] as const
        ).map((row) =>
          prisma.workspaceInvitation.create({
            data: {
              email: row.email,
              inviterId: seed.keeperId,
              workspaceId: seed.workspaceId,
              role: MemberRole.MEMBER,
              status: row.status,
              expiresAt: new Date(Date.now() + 86_400_000),
            },
            select: { id: true },
          }),
        ),
      );
      // Four rows in, or "none left afterwards" is a claim about an empty table.
      expect(invitedRows).toHaveLength(4);
      expect(await prisma.workspaceInvitation.count({ where: { email: address } })).toBe(4);

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      // The address is gone from the table.
      const survivors = await prisma.workspaceInvitation.findMany({
        where: { email: address },
        select: { id: true },
      });
      expect(survivors).toHaveLength(0);

      // ...and nothing anywhere else in the table carries it either — the assertion that would
      // still catch a predicate narrowed to one workspace or one status.
      const all = await prisma.workspaceInvitation.findMany({ select: { email: true } });
      for (const row of all) {
        expect(row.email.toLowerCase()).not.toBe(address.toLowerCase());
      }
    });

    /**
     * The delete above matches an address, and an address is not a pattern.
     *
     * This started as `email: { equals: user.email, mode: 'insensitive' }`, which Prisma
     * compiles to `ILIKE` on PostgreSQL with the operand passed through unescaped. `_` and `%`
     * are legal in a local part and are also the two `LIKE` wildcards, so a departing
     * `wildcard_…@test.example.com` silently widened its own erasure into `wildcard-…`,
     * `wildcardX…`, and anything else of the same length — in **every** workspace on the
     * instance, since the predicate is deliberately not workspace-scoped. One person exercising
     * their right to erasure would have revoked strangers' live invitations in tenants they had
     * never heard of, and the API would have answered `204`.
     *
     * So the decoy here is not a near-miss for tidiness: it is a *pending, unexpired* invitation
     * in a different workspace, sent by a different person, whose only relationship to the
     * departing user is that one character of the address differs. It has to survive.
     */
    it('matches the departing address literally — "_" in it is not a wildcard', async () => {
      const seed = await seedContentfulUser({
        departingEmail: `wildcard_${uniqueSuffix()}@test.example.com`,
      });
      const address = seed.departing.email;
      // The premise of the whole test: without the underscore there is no wildcard to mistake.
      expect(address).toContain('_');

      // Somebody else entirely. Under `ILIKE`, `_` matches this row's `-`.
      const stranger = address.replace('_', '-');
      expect(stranger).not.toBe(address);

      const otherWorkspace = await createWorkspace(seed.keeper.agent, 'Elsewhere', 'elsewhere');

      const [ownRow, strangerRow] = await Promise.all([
        prisma.workspaceInvitation.create({
          data: {
            email: address,
            inviterId: seed.keeperId,
            workspaceId: seed.workspaceId,
            role: MemberRole.MEMBER,
            status: 'pending',
            expiresAt: new Date(Date.now() + 86_400_000),
          },
          select: { id: true },
        }),
        prisma.workspaceInvitation.create({
          data: {
            email: stranger,
            inviterId: seed.keeperId,
            workspaceId: otherWorkspace.id,
            role: MemberRole.MEMBER,
            status: 'pending',
            expiresAt: new Date(Date.now() + 86_400_000),
          },
          select: { id: true },
        }),
      ]);

      // Both sides counted before the delete, or "the stranger's row survived" could be a claim
      // about a row that was never written and "the user's rows are gone" a claim about an
      // empty table.
      expect(await prisma.workspaceInvitation.count({ where: { email: address } })).toBe(1);
      expect(await prisma.workspaceInvitation.count({ where: { email: stranger } })).toBe(1);

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      // The erasure did its own job...
      expect(await prisma.workspaceInvitation.count({ where: { email: address } })).toBe(0);
      expect(await prisma.workspaceInvitation.findUnique({ where: { id: ownRow.id } })).toBeNull();

      // ...and stopped at the edge of it. This is the assertion the `ILIKE` predicate failed.
      const survivor = await prisma.workspaceInvitation.findUnique({
        where: { id: strangerRow.id },
      });
      expect(survivor).not.toBeNull();
      expect(survivor?.email).toBe(stranger);
      expect(survivor?.status).toBe('pending');
      expect(survivor?.workspaceId).toBe(otherWorkspace.id);
    });

    /**
     * The same wildcard risk as the invitation sweep above, on the other `contains` this flow
     * runs: `Verification.identifier` is swept with plain `contains` (no `mode`), which Prisma
     * compiles to the same unescaped `LIKE` on Postgres — confirmed empirically, see
     * `escapeLikePattern`'s doc comment. A departing address containing `_` would otherwise
     * delete a stranger's live verification row too.
     */
    it('matches the departing address literally in the Verification sweep — "_" is not a wildcard', async () => {
      const seed = await seedContentfulUser({
        departingEmail: `otpwild_${uniqueSuffix()}@test.example.com`,
      });
      const address = seed.departing.email;
      expect(address).toContain('_');

      // Under an unescaped `ILIKE`, `_` matches this row's `-`.
      const stranger = address.replace('_', '-');
      expect(stranger).not.toBe(address);

      const [ownRow, strangerRow] = await Promise.all([
        prisma.verification.create({
          data: { identifier: address, value: 'own', expiresAt: new Date(Date.now() + 600_000) },
          select: { id: true },
        }),
        prisma.verification.create({
          data: {
            identifier: stranger,
            value: 'stranger',
            expiresAt: new Date(Date.now() + 600_000),
          },
          select: { id: true },
        }),
      ]);

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      expect(await prisma.verification.findUnique({ where: { id: ownRow.id } })).toBeNull();

      // The assertion the unescaped predicate failed: a row that only matches the pattern, not
      // the address, survives.
      const survivor = await prisma.verification.findUnique({ where: { id: strangerRow.id } });
      expect(survivor).not.toBeNull();
      expect(survivor?.identifier).toBe(stranger);
    });
  });

  describe('a workspace the user solely owns', () => {
    async function seedSoleOwner(): Promise<{
      owner: TestUser;
      ownerId: string;
      member: TestUser;
      memberId: string;
      workspaceId: string;
    }> {
      const owner = await signUp(app, { name: 'Sole Owner' });
      const member = await signUp(app, { name: 'Second Person' });
      const ownerId = await userId(owner);
      const memberId = await userId(member);
      const workspace = await createWorkspace(owner.agent, 'Solely', 'solely');
      await addMember(prisma, workspace.id, memberId, MemberRole.MEMBER);
      return { owner, ownerId, member, memberId, workspaceId: workspace.id };
    }

    it('lists it in the preview with the people it could be handed to', async () => {
      const seed = await seedSoleOwner();

      const dto = await preview(seed.owner);

      expect(dto.soleOwnedWorkspaces).toHaveLength(1);
      const workspace = dto.soleOwnedWorkspaces[0]!;
      expect(workspace.workspaceId).toBe(seed.workspaceId);
      expect(workspace.memberCount).toBe(2);
      expect(workspace.transferCandidates).toHaveLength(1);
      expect(workspace.transferCandidates[0]!.userId).toBe(seed.memberId);
      expect(dto.otherWorkspaces).toHaveLength(0);
    });

    it('refuses the deletion with 409 until a decision is sent', async () => {
      const seed = await seedSoleOwner();

      const response = await seed.owner.agent
        .delete('/me')
        .send({ confirmEmail: seed.owner.email })
        .expect(409);

      // The message names the workspace, because the client's next move is to ask about it.
      expect((response.body as { message: string }).message).toContain(seed.workspaceId);
      // ...and nothing happened.
      const user = await prisma.user.findUniqueOrThrow({ where: { id: seed.ownerId } });
      expect(user.deletedAt).toBeNull();
    });

    it('transfers ownership when told to, and records the promotion', async () => {
      const seed = await seedSoleOwner();

      await seed.owner.agent
        .delete('/me')
        .send({
          confirmEmail: seed.owner.email,
          dispositions: [
            {
              workspaceId: seed.workspaceId,
              action: 'transfer',
              newOwnerUserId: seed.memberId,
            },
          ],
        })
        .expect(204);

      const promoted = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: seed.workspaceId, userId: seed.memberId } },
      });
      expect(promoted.role).toBe(MemberRole.OWNER);

      const promotions = await prisma.activity.findMany({
        where: { workspaceId: seed.workspaceId, type: ActivityType.MemberRoleChanged },
      });
      expect(promotions).toHaveLength(1);
      expect((promotions[0]!.payload as Record<string, unknown>).newRole).toBe(MemberRole.OWNER);
      expect((promotions[0]!.payload as Record<string, unknown>).reason).toBe('account.deleted');
    });

    it('deletes the workspace when told to, taking its boards with it', async () => {
      const seed = await seedSoleOwner();
      await seed.owner.agent
        .post(`/workspaces/${seed.workspaceId}/boards`)
        .send({ name: 'Doomed' })
        .expect(201);

      await seed.owner.agent
        .delete('/me')
        .send({
          confirmEmail: seed.owner.email,
          dispositions: [{ workspaceId: seed.workspaceId, action: 'delete' }],
        })
        .expect(204);

      expect(await prisma.workspace.findUnique({ where: { id: seed.workspaceId } })).toBeNull();
      expect(await prisma.board.count({ where: { workspaceId: seed.workspaceId } })).toBe(0);
      // No `account.deleted` row for a workspace that no longer exists — it would have been
      // deleted by the statement it described.
      expect(await prisma.activity.count({ where: { workspaceId: seed.workspaceId } })).toBe(0);
    });

    it('offers no transfer candidate for a workspace whose only member is the departing user', async () => {
      const owner = await signUp(app, { name: 'Alone' });
      const workspace = await createWorkspace(owner.agent, 'Empty', 'empty');

      const dto = await preview(owner);

      expect(dto.soleOwnedWorkspaces).toHaveLength(1);
      expect(dto.soleOwnedWorkspaces[0]!.transferCandidates).toHaveLength(0);
      expect(dto.soleOwnedWorkspaces[0]!.memberCount).toBe(1);
      // And the only disposition it accepts is `delete`.
      await owner.agent
        .delete('/me')
        .send({
          confirmEmail: owner.email,
          dispositions: [
            { workspaceId: workspace.id, action: 'transfer', newOwnerUserId: await userId(owner) },
          ],
        })
        .expect(404);
    });

    it('answers 404 for a transfer target who is not in that workspace', async () => {
      const seed = await seedSoleOwner();
      const stranger = await signUp(app, { name: 'Stranger' });
      const strangerId = await userId(stranger);
      await createWorkspace(stranger.agent, 'Elsewhere', 'elsewhere');

      // 404 rather than 403: a member id from another tenant must be indistinguishable from one
      // that does not exist, the same opacity every workspace route gives.
      await seed.owner.agent
        .delete('/me')
        .send({
          confirmEmail: seed.owner.email,
          dispositions: [
            {
              workspaceId: seed.workspaceId,
              action: 'transfer',
              newOwnerUserId: strangerId,
            },
          ],
        })
        .expect(404);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: seed.ownerId } });
      expect(user.deletedAt).toBeNull();
    });

    it('refuses a decision about a workspace that needs none', async () => {
      const seed = await seedContentfulUser();

      await seed.departing.agent
        .delete('/me')
        .send({
          confirmEmail: seed.departing.email,
          dispositions: [{ workspaceId: seed.workspaceId, action: 'delete' }],
        })
        .expect(409);

      // The workspace has another OWNER, so nothing about it was the caller's to decide — and
      // silently ignoring the instruction would have looked like agreement.
      expect(await prisma.workspace.findUnique({ where: { id: seed.workspaceId } })).not.toBeNull();
    });
  });

  describe('the tombstone the deletion leaves behind', () => {
    it('writes one account.deleted activity per surviving workspace, naming nobody', async () => {
      const seed = await seedContentfulUser();

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const rows = await prisma.activity.findMany({
        where: { workspaceId: seed.workspaceId, type: ActivityType.AccountDeleted },
      });
      expect(rows).toHaveLength(1);

      const payload = rows[0]!.payload as Record<string, unknown>;
      expect(payload.targetUserId).toBe(seed.departingId);
      expect(payload.previousRole).toBe(MemberRole.OWNER);
      expect(payload.initiatedBy).toBe('self');
      // A row written to stop naming somebody must not name them.
      expect(JSON.stringify(payload)).not.toContain('Ada Lovelace');
      expect(JSON.stringify(payload)).not.toContain(seed.departing.email);
      // The actor is the subject, so an operator's identity can never reach a tenant's feed.
      expect(rows[0]!.userId).toBe(seed.departingId);
    });

    it('leaves the deleted account unable to act with the session it still holds', async () => {
      const seed = await seedContentfulUser();

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      // Better Auth's cookie cache can still present this session for up to 60 seconds, so
      // the two writes that are not workspace-scoped refuse it explicitly (ADR 0026).
      await seed.departing.agent
        .post('/workspaces')
        .send({ name: 'Second Life', slug: `second-${Date.now()}` })
        .expect(401);
    });
  });

  describe('confirmation and authorisation', () => {
    it('refuses a deletion whose confirmation address does not match', async () => {
      const seed = await seedContentfulUser();

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.keeper.email })
        .expect(403);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: seed.departingId } });
      expect(user.deletedAt).toBeNull();
    });

    it('accepts the address in a different case', async () => {
      const seed = await seedContentfulUser();

      await seed.departing.agent
        .delete('/me')
        .send({ confirmEmail: seed.departing.email.toUpperCase() })
        .expect(204);
    });

    it('refuses a body with no confirmation at all', async () => {
      const seed = await seedContentfulUser();
      await seed.departing.agent.delete('/me').send({}).expect(400);
    });

    it('refuses the instance route to everyone when INSTANCE_ADMIN_EMAILS is unset', async () => {
      const seed = await seedContentfulUser();

      await seed.keeper.agent
        .get(`/instance/users/${seed.departingId}/deletion-preview`)
        .expect(403);
      await seed.keeper.agent
        .delete(`/instance/users/${seed.departingId}`)
        .send({ confirmEmail: seed.departing.email })
        .expect(403);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: seed.departingId } });
      expect(user.deletedAt).toBeNull();
    });

    it('lets a named instance administrator execute a request for somebody who cannot', async () => {
      const seed = await seedContentfulUser();
      process.env[INSTANCE_ADMIN_EMAILS_ENV] = seed.keeper.email;
      // `InstanceAdminGuard` requires `emailVerified` as well as list membership — a real
      // operator's account has been through mailbox verification (see the guard's doc comment).
      await confirmEmail(app, prisma, seed.keeper);

      const previewResponse = await seed.keeper.agent
        .get(`/instance/users/${seed.departingId}/deletion-preview`)
        .expect(200);
      expect((previewResponse.body as AccountDeletionPreviewDto).userId).toBe(seed.departingId);

      await seed.keeper.agent
        .delete(`/instance/users/${seed.departingId}`)
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: seed.departingId } });
      expect(user.deletedAt).toBeInstanceOf(Date);
      expect(user.name).toBe(ANONYMOUS_USER_NAME);

      const rows = await prisma.activity.findMany({
        where: { workspaceId: seed.workspaceId, type: ActivityType.AccountDeleted },
      });
      expect(rows).toHaveLength(1);
      expect((rows[0]!.payload as Record<string, unknown>).initiatedBy).toBe('instance_admin');
      // The operator ordered it and does not appear in the tenant's feed for it.
      expect(rows[0]!.userId).not.toBe(seed.keeperId);
    });

    it('answers 404 for an account that has already been deleted', async () => {
      const seed = await seedContentfulUser();
      process.env[INSTANCE_ADMIN_EMAILS_ENV] = seed.keeper.email;
      await confirmEmail(app, prisma, seed.keeper);

      await seed.keeper.agent
        .delete(`/instance/users/${seed.departingId}`)
        .send({ confirmEmail: seed.departing.email })
        .expect(204);

      await seed.keeper.agent
        .delete(`/instance/users/${seed.departingId}`)
        .send({ confirmEmail: seed.departing.email })
        .expect(404);
      await seed.keeper.agent
        .get(`/instance/users/${seed.departingId}/deletion-preview`)
        .expect(404);
    });

    it('requires a session at all', async () => {
      const anonymous = request.agent(app.getHttpServer());
      await anonymous.get('/me/deletion-preview').expect(401);
      await anonymous.delete('/me').send({ confirmEmail: 'nobody@test.example.com' }).expect(401);
    });
  });
});
