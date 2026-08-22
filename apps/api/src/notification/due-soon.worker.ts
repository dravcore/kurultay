import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@kurul/shared-types';
import { Queue, Worker, type Job } from 'bullmq';
import { envString } from '../common/env';
import { captureServerError } from '../common/observability/sentry';
import { parseRedisUrl, type RedisConnectionOptions } from '../common/redis-url';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationMailer, type NotificationMailInput } from './notification-mailer';
import { NotificationService } from './notification.service';

const QUEUE_NAME = 'due-soon';
const JOB_NAME = 'scan-due-soon';
const JOB_ID = 'due-soon-scan';
const REPEAT_EVERY_MS = 15 * 60 * 1000;
export const DUE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Page size for the due-task scan — bounds memory/row-count per query instead of loading the whole window at once. */
export const SCAN_BATCH_SIZE = 500;
/**
 * Attempts BullMQ makes at one scheduled run before giving up on it (the first try plus
 * two retries). Without this the queue default is a single attempt, so a scan that lands on
 * a momentary Postgres or Redis blip does not get a second try of its own — it just waits out
 * the next scheduled tick 15 minutes later. Three attempts absorbs a blip inside the same run;
 * see {@link JOB_BACKOFF_DELAY_MS} for the spacing between them.
 */
const JOB_ATTEMPTS = 3;
/**
 * Base delay for the exponential backoff between retries (`BullMQ` doubles this per attempt:
 * 30s, then 60s). Long enough that a retry is not fired back at infrastructure that is still
 * mid-restart, short enough that all three attempts are spent well inside the 24h due-window
 * and the audit's ≤5m recovery target — worst case here is under two minutes, not 15.
 */
const JOB_BACKOFF_DELAY_MS = 30_000;

type ScanTaskRow = {
  id: string;
  title: string;
  dueDate: Date | null;
  board: { workspaceId: string };
  assignees: { userId: string }[];
};

@Injectable()
export class DueSoonWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DueSoonWorker.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly mailer: NotificationMailer,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = envString('REDIS_URL', '');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL unset — due-soon worker not started');
      return;
    }

    let connection: RedisConnectionOptions;
    try {
      connection = parseRedisUrl(redisUrl);
    } catch {
      this.logger.error(`Invalid REDIS_URL — due-soon worker not started`);
      return;
    }

    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, (job) => this.process(job), { connection });

    this.worker.on('failed', (job, error) => {
      const message = error instanceof Error ? error.message : String(error);
      const attemptsMade = job?.attemptsMade ?? 0;
      // `job.opts.attempts` is what the *scheduler* asked for, not a guess — reading it back
      // off the job (rather than closing over `JOB_ATTEMPTS`) is what keeps this check honest
      // if BullMQ is ever asked to retry a job scheduled elsewhere with a different policy.
      const attemptsAllowed = job?.opts.attempts ?? 1;

      if (attemptsMade < attemptsAllowed) {
        // BullMQ has already scheduled the next attempt per the exponential backoff above —
        // this is expected noise from a transient blip, not something an operator needs
        // paged for, so it stays at `warn` instead of `error`.
        this.logger.warn(
          `due-soon job ${job?.id ?? '?'} failed (attempt ${attemptsMade}/${attemptsAllowed}), retrying: ${message}`,
        );
        return;
      }

      // Every attempt BullMQ was configured to make is spent: this is no longer a blip that
      // resolves itself, it is a scan that has silently stopped running until a human
      // intervenes. `removeOnFail: 50` keeps the job in Redis to inspect, but that is only
      // ever consulted after the fact by someone who thought to look — `captureServerError`
      // is what turns this into something surfaced instead of merely retained (audit BE-06).
      this.logger.error(
        `due-soon job ${job?.id ?? '?'} exhausted all ${attemptsAllowed} attempt(s), giving up: ${message}`,
      );
      captureServerError(error, { path: 'due-soon-worker' });
    });

    // `add` with `repeat` is the deprecated repeatable-job API: it leaves a repeat *key* behind
    // whose identity includes the interval, so changing REPEAT_EVERY_MS orphans the old key and
    // the queue quietly runs two schedules. A job scheduler is addressed by its id alone, so an
    // upsert replaces the previous definition instead of racing it.
    await this.queue.upsertJobScheduler(
      JOB_ID,
      { every: REPEAT_EVERY_MS },
      {
        name: JOB_NAME,
        opts: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
        },
      },
    );

    this.logger.log(`due-soon worker registered (every ${REPEAT_EVERY_MS / 60000}m)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Exposed for tests — scan once.
   *
   * Walks the due window in keyset-paginated batches (ordered by dueDate, id) rather than
   * loading every due task into memory in one query, so the scan stays bounded as the
   * table grows.
   */
  async runScan(): Promise<number> {
    const now = new Date();
    const until = new Date(now.getTime() + DUE_WINDOW_MS);
    const since = new Date(now.getTime() - DUE_WINDOW_MS);

    let cursor: { dueDate: Date; id: string } | null = null;
    let totalCreated = 0;
    // Recipients are collected across every page and signalled once at the end. A scan can
    // insert thousands of rows over many batches; a per-row — or even per-batch — emit would
    // hand the same user a burst of identical "your count changed" signals, and each one costs
    // that browser an unread-count request.
    const recipientsByWorkspace = new Map<string, Set<string>>();
    // Emails, unlike signals, are one per row: each reminder names one card.
    const mails: NotificationMailInput[] = [];

    for (;;) {
      const tasks: ScanTaskRow[] = await this.prisma.task.findMany({
        where: {
          dueDate: { gt: now, lte: until },
          assignees: { some: {} },
          ...(cursor
            ? {
                OR: [
                  { dueDate: { gt: cursor.dueDate } },
                  { dueDate: cursor.dueDate, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          board: { select: { workspaceId: true } },
          assignees: { select: { userId: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: SCAN_BATCH_SIZE,
      });

      if (tasks.length === 0) break;

      const { created, recipients } = await this.notifyBatch(tasks, since);
      totalCreated += created;
      for (const recipient of recipients) {
        const users = recipientsByWorkspace.get(recipient.workspaceId) ?? new Set<string>();
        users.add(recipient.userId);
        recipientsByWorkspace.set(recipient.workspaceId, users);
        mails.push({
          workspaceId: recipient.workspaceId,
          userId: recipient.userId,
          actorId: null,
          type: NotificationType.DueSoon,
          taskId: recipient.taskId,
        });
      }

      if (tasks.length < SCAN_BATCH_SIZE) break;
      const last = tasks[tasks.length - 1]!;
      if (!last.dueDate) break;
      cursor = { dueDate: last.dueDate, id: last.id };
    }

    // After the inserts, never inside the loop — and one signal per (workspace, user) pair,
    // not one per notification.
    for (const [workspaceId, users] of recipientsByWorkspace) {
      this.notifications.emitUnreadChanged(workspaceId, [...users]);
    }
    await this.mailer.sendForCreated(mails);

    return totalCreated;
  }

  /**
   * The (task, user) pairs in this batch that were already told about their due date.
   *
   * The obvious spelling — `taskId: { in: … }` AND `userId: { in: … }` — asks for the cross
   * product: a 500-task batch with a handful of assignees each searches hundreds of thousands
   * of combinations to find the few hundred that were actually paired, and then Node throws
   * the rest away. Joining against the pairs themselves, unnested into a two-column relation,
   * searches exactly the rows the batch is about. Same idiom as the position rebalance writes.
   *
   * The predicate is unchanged on purpose: a pair is skipped while its reminder is unread, or
   * while it is younger than the re-notify window. Widening it here would let the partial
   * unique index (`Notification_due_soon_unread_uidx`) do the rejecting instead, which turns a
   * skipped row into a swallowed conflict.
   */
  private async findAlreadyNotified(
    pairs: Array<{ taskId: string; userId: string }>,
    since: Date,
  ): Promise<Set<string>> {
    const taskIds = pairs.map((pair) => pair.taskId);
    const userIds = pairs.map((pair) => pair.userId);

    const existing = await this.prisma.$queryRaw<Array<{ userId: string; taskId: string }>>`
      SELECT n."userId", n."taskId"
      FROM "Notification" n
      INNER JOIN unnest(${taskIds}::text[], ${userIds}::text[]) AS pair("taskId", "userId")
        ON n."taskId" = pair."taskId" AND n."userId" = pair."userId"
      WHERE n."type" = ${NotificationType.DueSoon}
        AND (n."readAt" IS NULL OR n."createdAt" >= ${since})
    `;

    return new Set(existing.map((row) => `${row.userId}:${row.taskId}`));
  }

  private async notifyBatch(
    tasks: ScanTaskRow[],
    since: Date,
  ): Promise<{
    created: number;
    recipients: Array<{ workspaceId: string; userId: string; taskId: string }>;
  }> {
    const pairs = tasks.flatMap((task) =>
      task.dueDate === null
        ? []
        : task.assignees.map((assignee) => ({ taskId: task.id, userId: assignee.userId })),
    );
    if (pairs.length === 0) return { created: 0, recipients: [] };

    const skip = await this.findAlreadyNotified(pairs, since);

    const rows: Array<{
      workspaceId: string;
      userId: string;
      type: string;
      taskId: string;
      payload: { title: string; dueDate: string; type: string };
    }> = [];

    for (const task of tasks) {
      if (!task.dueDate) continue;
      for (const assignee of task.assignees) {
        const key = `${assignee.userId}:${task.id}`;
        if (skip.has(key)) continue;
        rows.push({
          workspaceId: task.board.workspaceId,
          userId: assignee.userId,
          type: NotificationType.DueSoon,
          taskId: task.id,
          payload: {
            title: task.title,
            dueDate: task.dueDate.toISOString(),
            type: NotificationType.DueSoon,
          },
        });
      }
    }

    if (rows.length === 0) return { created: 0, recipients: [] };

    const result = await this.prisma.notification.createMany({
      data: rows,
      skipDuplicates: true,
    });
    // `skipDuplicates` can drop rows a concurrent scanner already inserted, so a recipient here
    // may end up with nothing new. The cost of that is one extra unread-count request in a
    // browser whose badge is already correct — cheaper than reading back the inserted rows.
    if (result.count === 0) return { created: 0, recipients: [] };
    return {
      created: result.count,
      recipients: rows.map((row) => ({
        workspaceId: row.workspaceId,
        userId: row.userId,
        taskId: row.taskId,
      })),
    };
  }

  private async process(_job: Job): Promise<void> {
    const created = await this.runScan();
    if (created > 0) {
      this.logger.log(`due-soon scan created ${created} notification(s)`);
    }
  }
}
