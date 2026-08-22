import { INestApplication } from '@nestjs/common';
import { ActivityType, NotificationType, UsagePingKind } from '@kurul/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { CleanupWorker } from '../src/retention/cleanup.worker';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The retention sweep against a real Postgres.
 *
 * Unit tests can only assert which statement the worker builds; whether that statement picks
 * the intended rows — and only those — is a question for the database. So is the other half
 * of this feature: `Activity` rows are referenced by `Notification.activityId` under a
 * `Restrict`-heavy schema (see DB-05), and the only proof that deleting them does not raise a
 * foreign-key violation is deleting them.
 *
 * `CLEANUP_ENABLED` is `false` for the whole suite (`setup-e2e.ts`). Each test that wants a
 * sweep turns it on for the duration of that sweep, which is also how the "disabled means
 * disabled" test gets to be honest.
 */
describe('Retention cleanup (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let worker: CleanupWorker;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    worker = app.get(CleanupWorker);
    // The worker writes one JSON line per run to stdout; swallow it so the reporter output
    // stays readable. The line's shape is asserted in the unit spec.
    worker.setLogWriter(() => {});
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    process.env.NOTIFICATION_RETENTION_DAYS = '90';
    process.env.ACTIVITY_RETENTION_DAYS = '365';
    process.env.INVITATION_RETENTION_DAYS = '90';
  });

  afterEach(() => {
    process.env.CLEANUP_ENABLED = 'false';
    delete process.env.NOTIFICATION_RETENTION_DAYS;
    delete process.env.ACTIVITY_RETENTION_DAYS;
    delete process.env.INVITATION_RETENTION_DAYS;
  });

  async function sweep(now?: Date): Promise<ReturnType<CleanupWorker['runCleanup']>> {
    process.env.CLEANUP_ENABLED = 'true';
    try {
      return await worker.runCleanup(now);
    } finally {
      process.env.CLEANUP_ENABLED = 'false';
    }
  }

  interface Seed {
    userId: string;
    workspaceId: string;
    taskId: string;
  }

  /**
   * A user, a workspace, a board and a task — the FK targets every row below needs. Built
   * through the API rather than by insert so the fixtures sit on real rows (a real Better
   * Auth user, a real membership), which is what makes the FK assertions mean anything.
   */
  async function seed(): Promise<Seed> {
    const owner = await signUp(app, { name: 'Retention Owner' });
    const workspace = await createWorkspace(owner.agent, 'Retention', `ret-${Date.now()}`);
    const me = await owner.agent.get('/me').expect(200);
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const task = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Ship it', columnId: columns.body[0].id })
      .expect(201);

    return {
      userId: me.body.id as string,
      workspaceId: workspace.id,
      taskId: task.body.id as string,
    };
  }

  async function insertSession(userId: string, token: string, expiresAt: Date): Promise<string> {
    const row = await prisma.session.create({
      data: {
        userId,
        token,
        expiresAt,
        // The two PII columns the policy exists for. They are written here so the assertions
        // below are about rows that actually carry them.
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (retention test)',
      },
      select: { id: true },
    });
    return row.id;
  }

  async function insertVerification(identifier: string, expiresAt: Date): Promise<string> {
    const row = await prisma.verification.create({
      data: { identifier, value: 'token-value', expiresAt },
      select: { id: true },
    });
    return row.id;
  }

  async function insertNotification(
    s: Seed,
    options: { createdAt: Date; readAt: Date | null },
  ): Promise<string> {
    const row = await prisma.notification.create({
      data: {
        workspaceId: s.workspaceId,
        userId: s.userId,
        type: NotificationType.Mention,
        taskId: s.taskId,
        payload: { title: 'Ship it' },
        createdAt: options.createdAt,
        readAt: options.readAt,
      },
      select: { id: true },
    });
    return row.id;
  }

  async function insertActivity(s: Seed, createdAt: Date): Promise<string> {
    const row = await prisma.activity.create({
      data: {
        workspaceId: s.workspaceId,
        userId: s.userId,
        taskId: s.taskId,
        type: ActivityType.TaskCreated,
        payload: { title: 'Ship it' },
        createdAt,
      },
      select: { id: true },
    });
    return row.id;
  }

  async function insertUsagePing(s: Seed, createdAt: Date): Promise<string> {
    const row = await prisma.usagePing.create({
      data: {
        workspaceId: s.workspaceId,
        userId: s.userId,
        kind: UsagePingKind.BoardView,
        day: new Date(
          Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate()),
        ),
        createdAt,
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * An invitation carrying a real address, in whatever state and of whatever age.
   *
   * Written directly rather than through `POST /workspaces/:id/invitations` because that route
   * can only ever produce a fresh `pending` row: the states this sweep is about are reached by
   * time passing and by somebody answering, neither of which a test can wait for.
   */
  async function insertInvitation(
    s: Seed,
    options: { email: string; status: string; createdAt: Date; expiresAt: Date },
  ): Promise<string> {
    const row = await prisma.workspaceInvitation.create({
      data: {
        workspaceId: s.workspaceId,
        inviterId: s.userId,
        email: options.email,
        role: 'MEMBER',
        status: options.status,
        createdAt: options.createdAt,
        expiresAt: options.expiresAt,
      },
      select: { id: true },
    });
    return row.id;
  }

  describe('expired auth rows', () => {
    it('deletes an expired Session and keeps a live one', async () => {
      const s = await seed();
      const now = new Date();
      const expired = await insertSession(
        s.userId,
        'expired-token',
        new Date(now.getTime() - 1000),
      );
      const live = await insertSession(s.userId, 'live-token', new Date(now.getTime() + DAY_MS));

      const counts = await sweep(now);

      expect(counts.sessions).toBeGreaterThanOrEqual(1);
      expect(await prisma.session.findUnique({ where: { id: expired } })).toBeNull();
      expect(await prisma.session.findUnique({ where: { id: live } })).not.toBeNull();
    });

    it('spares a Session expiring at the exact sweep instant and deletes one a second older', async () => {
      const s = await seed();
      const now = new Date();
      const onTheBoundary = await insertSession(s.userId, 'boundary-token', now);
      const justPast = await insertSession(
        s.userId,
        'just-past-token',
        new Date(now.getTime() - 1000),
      );

      await sweep(now);

      // `expiresAt < now`, strictly: the boundary row is still valid for this instant.
      expect(await prisma.session.findUnique({ where: { id: onTheBoundary } })).not.toBeNull();
      expect(await prisma.session.findUnique({ where: { id: justPast } })).toBeNull();
    });

    it('deletes an expired Verification and keeps a live one', async () => {
      await seed();
      const now = new Date();
      const expired = await insertVerification(
        'expired@test.example.com',
        new Date(now.getTime() - 1000),
      );
      const live = await insertVerification(
        'live@test.example.com',
        new Date(now.getTime() + DAY_MS),
      );

      const counts = await sweep(now);

      expect(counts.verifications).toBe(1);
      expect(await prisma.verification.findUnique({ where: { id: expired } })).toBeNull();
      expect(await prisma.verification.findUnique({ where: { id: live } })).not.toBeNull();
    });

    it('leaves the signed-in session that Better Auth is currently using', async () => {
      // The suite's own fixtures sign users in; a sweep that took live sessions with it would
      // sign every concurrent user out. Better Auth wrote this row, not the test.
      const s = await seed();
      const before = await prisma.session.count({ where: { userId: s.userId } });
      expect(before).toBeGreaterThan(0);

      await sweep();

      expect(await prisma.session.count({ where: { userId: s.userId } })).toBe(before);
    });
  });

  describe('read notifications past the window', () => {
    it('deletes one read long ago, and spares unread, recently-read and boundary rows', async () => {
      const s = await seed();
      const now = new Date();
      const long = new Date(now.getTime() - 200 * DAY_MS);

      const oldRead = await insertNotification(s, {
        createdAt: long,
        readAt: new Date(now.getTime() - 91 * DAY_MS),
      });
      const oldUnread = await insertNotification(s, { createdAt: long, readAt: null });
      const recentRead = await insertNotification(s, {
        createdAt: long,
        readAt: new Date(now.getTime() - 1 * DAY_MS),
      });
      const onTheBoundary = await insertNotification(s, {
        createdAt: long,
        readAt: new Date(now.getTime() - 90 * DAY_MS),
      });
      const justPastBoundary = await insertNotification(s, {
        createdAt: long,
        readAt: new Date(now.getTime() - 90 * DAY_MS - 1000),
      });

      const counts = await sweep(now);

      expect(counts.notifications).toBe(2);
      expect(await prisma.notification.findUnique({ where: { id: oldRead } })).toBeNull();
      expect(await prisma.notification.findUnique({ where: { id: justPastBoundary } })).toBeNull();
      // Unread is untouched at any age — it is still waiting for its reader.
      expect(await prisma.notification.findUnique({ where: { id: oldUnread } })).not.toBeNull();
      expect(await prisma.notification.findUnique({ where: { id: recentRead } })).not.toBeNull();
      // `readAt < cutoff`, strictly.
      expect(await prisma.notification.findUnique({ where: { id: onTheBoundary } })).not.toBeNull();
    });

    it('measures the window from readAt, not from createdAt', async () => {
      const s = await seed();
      const now = new Date();
      // Written two years ago, read yesterday: still inside the window.
      const old = await insertNotification(s, {
        createdAt: new Date(now.getTime() - 730 * DAY_MS),
        readAt: new Date(now.getTime() - 1 * DAY_MS),
      });

      const counts = await sweep(now);

      expect(counts.notifications).toBe(0);
      expect(await prisma.notification.findUnique({ where: { id: old } })).not.toBeNull();
    });

    it('honours a shortened NOTIFICATION_RETENTION_DAYS', async () => {
      const s = await seed();
      const now = new Date();
      const readTenDaysAgo = await insertNotification(s, {
        createdAt: new Date(now.getTime() - 20 * DAY_MS),
        readAt: new Date(now.getTime() - 10 * DAY_MS),
      });

      process.env.NOTIFICATION_RETENTION_DAYS = '7';
      const counts = await sweep(now);

      expect(counts.notifications).toBe(1);
      expect(await prisma.notification.findUnique({ where: { id: readTenDaysAgo } })).toBeNull();
    });

    it('keeps every notification when the window is 0', async () => {
      const s = await seed();
      const now = new Date();
      const ancient = await insertNotification(s, {
        createdAt: new Date(now.getTime() - 730 * DAY_MS),
        readAt: new Date(now.getTime() - 700 * DAY_MS),
      });

      process.env.NOTIFICATION_RETENTION_DAYS = '0';
      const counts = await sweep(now);

      expect(counts.notifications).toBe(0);
      expect(await prisma.notification.findUnique({ where: { id: ancient } })).not.toBeNull();
    });
  });

  describe('activity past the window', () => {
    it('deletes an activity older than the window and keeps a recent one', async () => {
      const s = await seed();
      const now = new Date();
      const ancient = await insertActivity(s, new Date(now.getTime() - 400 * DAY_MS));
      const recent = await insertActivity(s, new Date(now.getTime() - 10 * DAY_MS));

      const counts = await sweep(now);

      // The seed also wrote a `task.created` activity through the API; only the backdated one
      // is old enough to go.
      expect(counts.activities).toBe(1);
      expect(await prisma.activity.findUnique({ where: { id: ancient } })).toBeNull();
      expect(await prisma.activity.findUnique({ where: { id: recent } })).not.toBeNull();
    });

    it('keeps the 14-day dashboard window intact', async () => {
      // The dashboard's throughput series reads the last 14 days. Whatever the retention
      // window is set to, a row inside that series must never be a candidate.
      const s = await seed();
      const now = new Date();
      const inWindow = await insertActivity(s, new Date(now.getTime() - 13 * DAY_MS));

      process.env.ACTIVITY_RETENTION_DAYS = '14';
      await sweep(now);

      expect(await prisma.activity.findUnique({ where: { id: inWindow } })).not.toBeNull();
    });

    it('nulls Notification.activityId instead of raising a foreign-key violation', async () => {
      const s = await seed();
      const now = new Date();
      const ancient = await insertActivity(s, new Date(now.getTime() - 400 * DAY_MS));
      const notification = await prisma.notification.create({
        data: {
          workspaceId: s.workspaceId,
          userId: s.userId,
          type: NotificationType.Mention,
          taskId: s.taskId,
          activityId: ancient,
          payload: { title: 'Ship it' },
          // Unread, so the notification sweep cannot be what removes it.
          readAt: null,
        },
        select: { id: true },
      });

      // `Activity.user` is `onDelete: Restrict` (DB-05) — deleting the *activity* is allowed,
      // deleting the user it points at is not. This is the assertion that the sweep stays on
      // the allowed side of that.
      await expect(sweep(now)).resolves.toMatchObject({ activities: 1 });

      const survivor = await prisma.notification.findUnique({
        where: { id: notification.id },
        select: { activityId: true },
      });
      expect(survivor).not.toBeNull();
      expect(survivor?.activityId).toBeNull();
    });

    it('leaves the user and workspace the deleted activity pointed at alone', async () => {
      const s = await seed();
      const now = new Date();
      await insertActivity(s, new Date(now.getTime() - 400 * DAY_MS));

      await sweep(now);

      expect(await prisma.user.findUnique({ where: { id: s.userId } })).not.toBeNull();
      expect(await prisma.workspace.findUnique({ where: { id: s.workspaceId } })).not.toBeNull();
      expect(await prisma.task.findUnique({ where: { id: s.taskId } })).not.toBeNull();
    });
  });

  describe('CLEANUP_ENABLED=false', () => {
    it('deletes nothing, even with every table full of expired rows', async () => {
      const s = await seed();
      const now = new Date();
      const session = await insertSession(
        s.userId,
        'expired-token',
        new Date(now.getTime() - 1000),
      );
      const verification = await insertVerification(
        'gone@test.example.com',
        new Date(now.getTime() - 1000),
      );
      const notification = await insertNotification(s, {
        createdAt: new Date(now.getTime() - 200 * DAY_MS),
        readAt: new Date(now.getTime() - 200 * DAY_MS),
      });
      const activity = await insertActivity(s, new Date(now.getTime() - 400 * DAY_MS));
      const ping = await insertUsagePing(s, new Date(now.getTime() - 400 * DAY_MS));
      const invitationCreatedAt = new Date(now.getTime() - 400 * DAY_MS);
      const invitation = await insertInvitation(s, {
        email: 'switched-off@test.example.com',
        status: 'canceled',
        createdAt: invitationCreatedAt,
        expiresAt: new Date(invitationCreatedAt.getTime() + 2 * DAY_MS),
      });

      // No `sweep()` helper here — the point is that the switch is honoured at the moment of
      // deletion, not only at registration.
      process.env.CLEANUP_ENABLED = 'false';
      await expect(worker.runCleanup(now)).resolves.toEqual({
        sessions: 0,
        verifications: 0,
        notifications: 0,
        activities: 0,
        usagePings: 0,
        invitations: 0,
        orphanedFiles: 0,
      });

      expect(await prisma.session.findUnique({ where: { id: session } })).not.toBeNull();
      expect(await prisma.verification.findUnique({ where: { id: verification } })).not.toBeNull();
      expect(await prisma.notification.findUnique({ where: { id: notification } })).not.toBeNull();
      expect(await prisma.activity.findUnique({ where: { id: activity } })).not.toBeNull();
      expect(await prisma.usagePing.findUnique({ where: { id: ping } })).not.toBeNull();
      expect(
        await prisma.workspaceInvitation.findUnique({ where: { id: invitation } }),
      ).not.toBeNull();
    });
  });

  /**
   * Usage pings are the newest thing this sweep is responsible for, and the one most easily
   * forgotten: they name a user and a day and would otherwise accumulate for the life of the
   * instance. They deliberately share ACTIVITY_RETENTION_DAYS — same class of row, one decision
   * for the operator — so these two tests are about that window applying, and about `0` still
   * meaning "keep forever".
   */
  describe('usage pings', () => {
    it('deletes a ping older than the activity window and keeps a recent one', async () => {
      const s = await seed();
      const now = new Date();
      const old = await insertUsagePing(s, new Date(now.getTime() - 400 * DAY_MS));
      const recent = await insertUsagePing(s, new Date(now.getTime() - 2 * DAY_MS));

      const counts = await sweep(now);

      expect(counts.usagePings).toBe(1);
      expect(await prisma.usagePing.findUnique({ where: { id: old } })).toBeNull();
      expect(await prisma.usagePing.findUnique({ where: { id: recent } })).not.toBeNull();
    });

    it('keeps every ping when the activity window is 0', async () => {
      const s = await seed();
      const now = new Date();
      const ancient = await insertUsagePing(s, new Date(now.getTime() - 4000 * DAY_MS));
      process.env.ACTIVITY_RETENTION_DAYS = '0';

      const counts = await sweep(now);

      expect(counts.usagePings).toBe(0);
      expect(await prisma.usagePing.findUnique({ where: { id: ancient } })).not.toBeNull();
    });
  });

  /**
   * The sweep added by audit finding DB-01, and the only one whose rows carry the personal data
   * of somebody who is not a user of this instance. `WorkspaceInvitation.email` is a literal
   * address; an invitation to a person who never signed up leaves no `User` row for account
   * deletion to reach, so before this sweep existed nothing in the product ever removed it.
   *
   * Two ways to be finished — somebody answered (`status <> 'pending'`) or the clock did
   * (`expiresAt` in the past) — and one way to be exempt: still pending, still unexpired, at any
   * age. These tests are that predicate, against the database rather than against the SQL.
   */
  describe('finished invitations past the window', () => {
    const ANCIENT = 400 * DAY_MS;

    /** Two days after `createdAt`, matching what the invitation flow actually writes. */
    function expiryFor(createdAt: Date): Date {
      return new Date(createdAt.getTime() + 2 * DAY_MS);
    }

    it('deletes a resolved invitation older than the window and keeps a fresh one', async () => {
      const s = await seed();
      const now = new Date();
      const oldCreatedAt = new Date(now.getTime() - ANCIENT);
      const freshCreatedAt = new Date(now.getTime() - 2 * DAY_MS);

      const oldAccepted = await insertInvitation(s, {
        email: 'old-accepted@test.example.com',
        status: 'accepted',
        createdAt: oldCreatedAt,
        expiresAt: expiryFor(oldCreatedAt),
      });
      const oldCanceled = await insertInvitation(s, {
        email: 'old-canceled@test.example.com',
        status: 'canceled',
        createdAt: oldCreatedAt,
        expiresAt: expiryFor(oldCreatedAt),
      });
      const oldRejected = await insertInvitation(s, {
        email: 'old-rejected@test.example.com',
        status: 'rejected',
        createdAt: oldCreatedAt,
        expiresAt: expiryFor(oldCreatedAt),
      });
      // Answered, but only the day before yesterday: inside the window, so still kept.
      const freshAccepted = await insertInvitation(s, {
        email: 'fresh-accepted@test.example.com',
        status: 'accepted',
        createdAt: freshCreatedAt,
        expiresAt: expiryFor(freshCreatedAt),
      });

      // Four rows in, or none of the assertions below distinguish "deleted" from "never
      // written" (the repo's vacuous-assertion rule).
      expect(await prisma.workspaceInvitation.count()).toBe(4);

      const counts = await sweep(now);

      expect(counts.invitations).toBe(3);
      expect(
        await prisma.workspaceInvitation.findUnique({ where: { id: oldAccepted } }),
      ).toBeNull();
      expect(
        await prisma.workspaceInvitation.findUnique({ where: { id: oldCanceled } }),
      ).toBeNull();
      expect(
        await prisma.workspaceInvitation.findUnique({ where: { id: oldRejected } }),
      ).toBeNull();
      expect(
        await prisma.workspaceInvitation.findUnique({ where: { id: freshAccepted } }),
      ).not.toBeNull();
    });

    it('keeps a pending invitation that has not expired, however old the row is', async () => {
      const s = await seed();
      const now = new Date();
      const createdAt = new Date(now.getTime() - ANCIENT);

      // Created over a year ago and still live: an admin extended it, or the deployment sets a
      // long expiry. It is a grant of access somebody can still accept, so age is irrelevant.
      const stillOpen = await insertInvitation(s, {
        email: 'still-open@test.example.com',
        status: 'pending',
        createdAt,
        expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      });
      // Same age, same `pending` status — but its expiry has passed, so nobody can act on it.
      const abandoned = await insertInvitation(s, {
        email: 'abandoned@test.example.com',
        status: 'pending',
        createdAt,
        expiresAt: expiryFor(createdAt),
      });

      expect(await prisma.workspaceInvitation.count()).toBe(2);

      const counts = await sweep(now);

      expect(counts.invitations).toBe(1);
      expect(
        await prisma.workspaceInvitation.findUnique({ where: { id: stillOpen } }),
      ).not.toBeNull();
      expect(await prisma.workspaceInvitation.findUnique({ where: { id: abandoned } })).toBeNull();
    });

    it('keeps every invitation when the window is 0', async () => {
      const s = await seed();
      const now = new Date();
      const createdAt = new Date(now.getTime() - 4000 * DAY_MS);
      const ancient = await insertInvitation(s, {
        email: 'ancient@test.example.com',
        status: 'canceled',
        createdAt,
        expiresAt: expiryFor(createdAt),
      });

      expect(await prisma.workspaceInvitation.count()).toBe(1);

      process.env.INVITATION_RETENTION_DAYS = '0';
      const counts = await sweep(now);

      expect(counts.invitations).toBe(0);
      expect(
        await prisma.workspaceInvitation.findUnique({ where: { id: ancient } }),
      ).not.toBeNull();
    });

    it('leaves the workspace and the inviter the deleted invitation pointed at alone', async () => {
      // `WorkspaceInvitation.inviter` is one of the seven `onDelete: Restrict` relations
      // (ADR 0026). Deleting the invitation is the allowed direction; this is the assertion
      // that the sweep stays on it.
      const s = await seed();
      const now = new Date();
      const createdAt = new Date(now.getTime() - ANCIENT);
      await insertInvitation(s, {
        email: 'gone@test.example.com',
        status: 'accepted',
        createdAt,
        expiresAt: expiryFor(createdAt),
      });

      await expect(sweep(now)).resolves.toMatchObject({ invitations: 1 });

      expect(await prisma.user.findUnique({ where: { id: s.userId } })).not.toBeNull();
      expect(await prisma.workspace.findUnique({ where: { id: s.workspaceId } })).not.toBeNull();
    });
  });

  describe('the success metric', () => {
    it('leaves zero expired Session/Verification rows and zero old read Notifications behind', async () => {
      const s = await seed();
      const now = new Date();
      for (let i = 0; i < 5; i += 1) {
        await insertSession(s.userId, `expired-${i}`, new Date(now.getTime() - (i + 1) * DAY_MS));
        await insertVerification(`expired-${i}@test.example.com`, new Date(now.getTime() - DAY_MS));
        await insertNotification(s, {
          createdAt: new Date(now.getTime() - 200 * DAY_MS),
          readAt: new Date(now.getTime() - (100 + i) * DAY_MS),
        });
      }

      await sweep(now);

      expect(await prisma.session.count({ where: { expiresAt: { lt: now } } })).toBe(0);
      expect(await prisma.verification.count({ where: { expiresAt: { lt: now } } })).toBe(0);
      expect(
        await prisma.notification.count({
          where: { readAt: { not: null, lt: new Date(now.getTime() - 90 * DAY_MS) } },
        }),
      ).toBe(0);
    });
  });
});
