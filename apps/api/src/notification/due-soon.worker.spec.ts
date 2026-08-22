import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NotificationType, SocketEvents } from '@kurul/shared-types';
import { Queue, Worker, type Job } from 'bullmq';
import { initSentry, resetSentryForTesting } from '../common/observability/sentry';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DueSoonWorker } from './due-soon.worker';
import { NotificationMailer } from './notification-mailer';
import { NotificationService } from './notification.service';

/** The mailer is covered in `notification-mailer.spec.ts`; here it only has to be called. */
function mailerStub() {
  return { sendForCreated: jest.fn().mockResolvedValue(undefined) };
}

function asMailer(stub: ReturnType<typeof mailerStub>): NotificationMailer {
  return stub as unknown as NotificationMailer;
}

// The registration test needs to see what the worker asks BullMQ for without a Redis to ask
// it against. No other test in this file constructs a queue, so the stub is file-wide.
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    upsertJobScheduler: jest.fn().mockResolvedValue({ id: 'due-soon-scan' }),
    close: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));

/** Every migration's SQL, whitespace-normalised so statements can be matched as one line. */
function allMigrationSql(): string {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(dir, entry.name, 'migration.sql');
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    })
    .join('\n')
    .replace(/\s+/g, ' ');
}

describe('DueSoonWorker', () => {
  it('creates due_soon notifications for assignees in the window', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }, { userId: 'u2' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(
      prisma as unknown as PrismaService,
      notifications,
      asMailer(mailerStub()),
    );

    const created = await worker.runScan();

    expect(created).toBe(2);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            type: NotificationType.DueSoon,
            userId: 'u1',
            taskId: 't1',
          }),
          expect.objectContaining({
            type: NotificationType.DueSoon,
            userId: 'u2',
            taskId: 't1',
          }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it('hands the mailer one entry per stored row, after the signals', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }, { userId: 'u2' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const mailer = mailerStub();
    const worker = new DueSoonWorker(
      prisma as unknown as PrismaService,
      notifications,
      asMailer(mailer),
    );

    await worker.runScan();

    expect(mailer.sendForCreated).toHaveBeenCalledTimes(1);
    expect(mailer.sendForCreated).toHaveBeenCalledWith([
      {
        workspaceId: 'w1',
        userId: 'u1',
        actorId: null,
        type: NotificationType.DueSoon,
        taskId: 't1',
      },
      {
        workspaceId: 'w1',
        userId: 'u2',
        actorId: null,
        type: NotificationType.DueSoon,
        taskId: 't1',
      },
    ]);
  });

  it('skips pairs that already have a recent or unread due_soon', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }, { userId: 'u2' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ userId: 'u1', taskId: 't1' }]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(
      prisma as unknown as PrismaService,
      notifications,
      asMailer(mailerStub()),
    );

    const created = await worker.runScan();

    expect(created).toBe(1);
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            userId: 'u2',
            taskId: 't1',
          }),
        ],
      }),
    );
  });

  it('signals each assignee once for the whole scan, not once per inserted row', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }, { userId: 'u2' }],
          },
          {
            id: 't2',
            title: 'Review',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }],
          },
          {
            id: 't3',
            title: 'Other tenant',
            dueDate: due,
            board: { workspaceId: 'w2' },
            assignees: [{ userId: 'u1' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(
      prisma as unknown as PrismaService,
      notifications,
      asMailer(mailerStub()),
    );

    await worker.runScan();

    // Four rows, three signals: u1/w1 is collapsed, and u1/w2 stays separate because the badge
    // it feeds is a different tenant's.
    expect(realtime.emitToUser).toHaveBeenCalledTimes(3);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'w1',
      'u1',
      SocketEvents.NOTIFICATION_UNREAD_CHANGED,
      { workspaceId: 'w1', userId: 'u1' },
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'w1',
      'u2',
      SocketEvents.NOTIFICATION_UNREAD_CHANGED,
      { workspaceId: 'w1', userId: 'u2' },
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'w2',
      'u1',
      SocketEvents.NOTIFICATION_UNREAD_CHANGED,
      { workspaceId: 'w2', userId: 'u1' },
    );
  });

  it('publishes nothing when the scan inserted nothing', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Already notified — every pair is skipped, so `createMany` is never reached.
      $queryRaw: jest.fn().mockResolvedValue([{ userId: 'u1', taskId: 't1' }]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(
      prisma as unknown as PrismaService,
      notifications,
      asMailer(mailerStub()),
    );

    await expect(worker.runScan()).resolves.toBe(0);
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('looks the batch up by (taskId, userId) pairs, not by their cross product', async () => {
    const due = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Ship',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u1' }],
          },
          {
            id: 't2',
            title: 'Review',
            dueDate: due,
            board: { workspaceId: 'w1' },
            assignees: [{ userId: 'u2' }],
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const realtime = { emitToUser: jest.fn() };
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    );
    const worker = new DueSoonWorker(
      prisma as unknown as PrismaService,
      notifications,
      asMailer(mailerStub()),
    );

    await worker.runScan();

    const [fragments, taskIds, userIds] = prisma.$queryRaw.mock.calls[0]!;
    // Two positionally-matched arrays, not two independent `IN` lists: (t1,u1) and (t2,u2)
    // are searched, while (t1,u2) and (t2,u1) — which no assignment produced — are not.
    expect(taskIds).toEqual(['t1', 't2']);
    expect(userIds).toEqual(['u1', 'u2']);
    expect((fragments as string[]).join('?')).toContain('unnest(');
    // The re-notify predicate is what the partial unique index backs up; widening it would
    // turn a skipped pair into a swallowed insert conflict.
    expect((fragments as string[]).join('?')).toContain('n."readAt" IS NULL OR n."createdAt" >= ');
  });

  describe('registration', () => {
    const originalRedisUrl = process.env.REDIS_URL;

    afterEach(async () => {
      if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = originalRedisUrl;
      jest.clearAllMocks();
    });

    function buildWorker(): DueSoonWorker {
      const prisma = { task: { findMany: jest.fn() } } as unknown as PrismaService;
      const notifications = {} as NotificationService;
      return new DueSoonWorker(prisma, notifications, asMailer(mailerStub()));
    }

    it('registers the scan as a job scheduler, not as a deprecated repeatable job', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const worker = buildWorker();

      await worker.onModuleInit();

      const queue = (Queue as unknown as jest.Mock).mock.results[0]!.value as {
        add: jest.Mock;
        upsertJobScheduler: jest.Mock;
      };
      expect(queue.add).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'due-soon-scan',
        { every: 15 * 60 * 1000 },
        {
          name: 'scan-due-soon',
          opts: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        },
      );

      await worker.onModuleDestroy();
    });

    it('starts nothing when REDIS_URL is unset', async () => {
      delete process.env.REDIS_URL;

      await buildWorker().onModuleInit();

      expect(Queue).not.toHaveBeenCalled();
    });
  });

  /**
   * BE-06: a single failed attempt used to be indistinguishable from a permanently broken
   * scan — both produced the same `error`-level log line, and nothing else. These pin the two
   * outcomes the retry policy is supposed to tell apart: a mid-retry failure (BullMQ already
   * has another attempt queued, so this is `warn`-level noise) versus the final failure of the
   * last configured attempt (nothing left to retry it, so it is `error`-level and reported to
   * Sentry — the thing an operator who is not tailing logs can actually see).
   */
  describe('failed handler', () => {
    const originalRedisUrl = process.env.REDIS_URL;

    beforeEach(() => {
      resetSentryForTesting();
    });

    afterEach(async () => {
      if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = originalRedisUrl;
      jest.clearAllMocks();
      resetSentryForTesting();
    });

    /**
     * Starts a worker and hands back the `on('failed', ...)` callback BullMQ would invoke —
     * reading it off the mocked `Worker`'s own `.on` calls, not a copy the test wrote itself,
     * so this exercises the exact closure `due-soon.worker.ts` registers.
     */
    async function registerAndGetFailedHandler(): Promise<
      (job: Job | undefined, error: Error) => void
    > {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const prisma = { task: { findMany: jest.fn() } } as unknown as PrismaService;
      const notifications = {} as NotificationService;
      const worker = new DueSoonWorker(prisma, notifications, asMailer(mailerStub()));

      await worker.onModuleInit();

      const workerInstance = (Worker as unknown as jest.Mock).mock.results[0]!.value as {
        on: jest.Mock;
      };
      const [, handler] = workerInstance.on.mock.calls.find(([event]) => event === 'failed') as [
        string,
        (job: Job | undefined, error: Error) => void,
      ];
      return handler;
    }

    /** Installs a fake Sentry SDK through the loader seam, same pattern as all-exceptions.filter.spec.ts. */
    async function enableFakeSentry(): Promise<{ captureException: jest.Mock }> {
      const captureException = jest.fn();
      const api = {
        init: jest.fn(),
        captureException,
        close: jest.fn(() => Promise.resolve(true)),
        withScope: (callback: (scope: { setTag: jest.Mock; setContext: jest.Mock }) => void) => {
          callback({ setTag: jest.fn(), setContext: jest.fn() });
        },
      } as unknown as typeof import('@sentry/node');

      process.env.SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
      try {
        await initSentry(() => Promise.resolve(api));
      } finally {
        delete process.env.SENTRY_DSN;
      }

      return { captureException };
    }

    it('logs a warning, not an error, when a failed job still has attempts left', async () => {
      const { captureException } = await enableFakeSentry();
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const handler = await registerAndGetFailedHandler();
      const job = { id: 'j1', attemptsMade: 1, opts: { attempts: 3 } } as unknown as Job;

      handler(job, new Error('ECONNRESET'));

      expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('attempt 1/3'));
      expect(logError).not.toHaveBeenCalled();
      expect(captureException).not.toHaveBeenCalled();
    });

    it('logs an error and reports to Sentry once every configured attempt is spent', async () => {
      const { captureException } = await enableFakeSentry();
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const handler = await registerAndGetFailedHandler();
      const error = new Error('relation "Task" does not exist');
      const job = { id: 'j1', attemptsMade: 3, opts: { attempts: 3 } } as unknown as Job;

      handler(job, error);

      expect(logError).toHaveBeenCalledWith(expect.stringContaining('exhausted all 3 attempt(s)'));
      expect(captureException).toHaveBeenCalledWith(error);
    });

    it('does not report to Sentry when Sentry is off (no SENTRY_DSN)', async () => {
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const handler = await registerAndGetFailedHandler();
      const job = { id: 'j1', attemptsMade: 3, opts: { attempts: 3 } } as unknown as Job;

      // Must not throw even though nothing is listening on the Sentry side.
      expect(() => handler(job, new Error('boom'))).not.toThrow();
      expect(logError).toHaveBeenCalled();
    });
  });

  // `skipDuplicates` compiles to `INSERT ... ON CONFLICT DO NOTHING`, which is a no-op unless
  // a unique index exists for it to conflict on. The app-level check above only closes the
  // single-scanner case; the constraint is what stops two concurrent scans from both
  // inserting the same due_soon. Prisma cannot express a partial unique index, so it is raw
  // SQL in a migration — which makes it easy to lose to a regenerated migration.
  it('is backed by a partial unique index so skipDuplicates has something to conflict on', () => {
    const sql = allMigrationSql();

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "Notification_due_soon_unread_uidx" ON "Notification" ' +
        `("userId", "taskId") WHERE "type" = '${NotificationType.DueSoon}' ` +
        'AND "readAt" IS NULL AND "taskId" IS NOT NULL;',
    );
    expect(sql).not.toMatch(/DROP INDEX[^;]*Notification_due_soon_unread_uidx/);
  });
});
