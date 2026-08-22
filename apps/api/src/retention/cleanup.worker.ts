import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { envBool, envInt, envString } from '../common/env';
import { stdoutWriter, type LogWriter } from '../common/logging/json-log';
import { captureServerError } from '../common/observability/sentry';
import { parseRedisUrl, type RedisConnectionOptions } from '../common/redis-url';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const QUEUE_NAME = 'cleanup';
const JOB_NAME = 'purge-expired';
const JOB_ID = 'retention-cleanup';
/**
 * Once a day. Retention is measured in days, so a tighter schedule would spend scans to
 * delete rows that only became deletable minutes ago; a looser one lets a table sit up to
 * that long past its stated window, which is the thing the policy promises not to do.
 */
const REPEAT_EVERY_MS = 24 * 60 * 60 * 1000;
/**
 * Attempts BullMQ makes at one scheduled run before giving up on it. Sized for this job's own
 * cadence, not copied from `due-soon.worker.ts`'s `attempts: 3` — that worker self-heals in 15
 * minutes either way, so its budget only has to beat "wait for the next tick". This one skips a
 * full *day* of retention enforcement on the next tick, so the retry budget is worth spending
 * more generously: see {@link JOB_BACKOFF_DELAY_MS} for why 5 attempts still finishes in about
 * an hour, well inside the 24h window.
 */
const JOB_ATTEMPTS = 5;
/**
 * Base delay for the exponential backoff between retries (BullMQ doubles this per attempt: 5m,
 * 10m, 20m, 40m — roughly 75 minutes of retrying before the run is given up on). Due-soon uses
 * 30s because its whole recovery budget has to fit inside a 15-minute tick; this job has a full
 * day of slack, so the delay is minutes rather than seconds on purpose — a longer gap gives a
 * DB restart or a Redis failover realistic time to finish before the next attempt lands on it,
 * and 75 minutes worst-case still leaves over 22 hours of margin before the next scheduled run,
 * which is the actual fallback this retry budget exists to make unnecessary.
 */
const JOB_BACKOFF_DELAY_MS = 5 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rows removed per `DELETE` statement.
 *
 * One unbounded `DELETE FROM "Notification" WHERE …` would be simpler and is the wrong shape
 * here: the first run after this ships has to clear however much history the instance has
 * accumulated, and that single statement holds row locks and an open transaction — plus the
 * WAL and dead tuples it generates — for its entire duration. Autovacuum cannot reclaim any
 * of it until the transaction commits, so peak bloat is proportional to the *total* deleted
 * rather than to a batch.
 *
 * Batching trades that for repeated scans (see {@link CleanupWorker.deleteInBatches}). A
 * thousand rows is large enough that steady state is one statement per table per night and
 * small enough that each transaction is measured in milliseconds.
 */
export const CLEANUP_BATCH_SIZE = 1000;

/**
 * Ceiling on the batches one table gets per run — a stop, not a target.
 *
 * The loop's real exit condition is a short batch. This bound exists so that a bug in a
 * predicate (one that matches rows the `DELETE` does not actually remove) becomes a job that
 * ends after a bounded amount of work instead of one that spins against the database until
 * someone notices. At the default batch size it also caps a first run at a million rows per
 * table; whatever is left is deleted by the next night's run.
 */
export const MAX_BATCHES_PER_TABLE = 1000;

export const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;
export const DEFAULT_ACTIVITY_RETENTION_DAYS = 365;
/**
 * Ninety days, matching {@link DEFAULT_NOTIFICATION_RETENTION_DAYS} rather than the activity
 * year — and the reason is who the row is about.
 *
 * `Activity` gets a year because it is a workspace's own history, browsed by the people in it.
 * A finished invitation is not that: the only thing it still holds is the address of somebody
 * who may never have had an account here, and nobody browses it — the settings screen lists
 * `pending` rows only. The shortest window that still leaves a support answer to "did we ever
 * invite this person" is the right one, and that is the same ninety days a read notification
 * gets for the same reason: nothing reads it, so keeping it longer only stores an address.
 */
export const DEFAULT_INVITATION_RETENTION_DAYS = 90;

/** The `backup` sidecar's own defaults, mirrored so the two cannot silently disagree. */
export const DEFAULT_BACKUP_INTERVAL_SECONDS = 86_400;
export const DEFAULT_BACKUP_KEEP = 7;

/**
 * The shortest orphan grace period this job will use, whatever the backup pair says.
 *
 * A day, and deliberately not derived from `BACKUP_*` — see {@link orphanGraceMs} for why the
 * floor has to be independent of the backup schedule to mean anything.
 */
export const MIN_ORPHAN_GRACE_MS = MS_PER_DAY;

/** Rows deleted in one run, per table. */
export interface CleanupCounts {
  sessions: number;
  verifications: number;
  notifications: number;
  activities: number;
  /** Deduplicated "somebody opened a board / the dashboard" rows — see `model UsagePing`. */
  usagePings: number;
  /** Finished `WorkspaceInvitation` rows — the one table here holding a *third party's* address. */
  invitations: number;
  /**
   * Files on disk with no row pointing at them, removed this run.
   *
   * The one count in this interface that is not a row count, and the one sweep that is not a
   * batched `DELETE`. It reports here anyway because the question an operator asks is "what did
   * last night's cleanup remove", and answering it from two places is how one of them stops
   * being read (ADR 0022).
   */
  orphanedFiles: number;
}

/**
 * How old a file has to be before "no row points at it" is allowed to mean "delete it".
 *
 * The window does **two** jobs, and only the first one is about backups:
 *
 * 1. **The restore window.** "On disk and not in the database" is a correct predicate only
 *    while the database is authoritative. After a restore it is not: `DROP DATABASE` and
 *    `pg_restore` rewind the rows while the disk stays where it was, so every file uploaded
 *    after the dump exists with no row to match — and a sweep that night would delete them
 *    permanently. The restore and the sweep are each safe alone and destructive together
 *    (ADR 0022). Tying this to `BACKUP_KEEP × BACKUP_INTERVAL` means no file can be swept while
 *    a dump old enough to disown it is still restorable. The constant is borrowed rather than
 *    invented, which is the point: that rotation is a rehearsed behaviour, not a documented
 *    intention.
 * 2. **The in-flight upload race.** Bytes are written before the row is (`D6`: the cheap
 *    direction of being wrong), so between the write and the commit there is always a file no
 *    row claims. This job has nothing to do with backups: it is there on an instance that has
 *    never taken a dump and it does not go away if the sidecar is switched off.
 *
 * Which is why {@link MIN_ORPHAN_GRACE_MS} is a floor and not a default. Both variables come
 * from a file an operator edits, and the product of the two can be made arbitrarily small —
 * `BACKUP_KEEP=0` (which `backup.sh`'s prune reads as "keep nothing") or `BACKUP_INTERVAL=0`
 * each collapse it to zero, which would hand the sweep every upload whose row has not committed
 * yet. A backup setting must not be able to reach through and disable the second job, so the
 * result is clamped by a window that owes the backup schedule nothing.
 *
 * The floor is only ever a floor: a longer configured window is used as configured, which is
 * what keeps the default (seven days) meaningful.
 */
export function orphanGraceMs(): number {
  const interval = envInt('BACKUP_INTERVAL', DEFAULT_BACKUP_INTERVAL_SECONDS);
  const keep = envInt('BACKUP_KEEP', DEFAULT_BACKUP_KEEP);
  const configured = Math.max(interval, 0) * Math.max(keep, 1) * 1000;
  return Math.max(configured, MIN_ORPHAN_GRACE_MS);
}

export interface RetentionSettings {
  enabled: boolean;
  /** Days a *read* notification is kept after it was read. `0` disables the sweep. */
  notificationDays: number;
  /** Days an activity row is kept after it was written. `0` disables the sweep. */
  activityDays: number;
  /**
   * Days a *finished* invitation is kept after it was created. `0` disables the sweep.
   *
   * Its own knob rather than a share of `NOTIFICATION_RETENTION_DAYS` even though the default
   * is the same number: a self-hoster shortening the invitation window is answering a
   * data-minimisation question about people who are not their users, and one shortening the
   * notification window is tidying an inbox. Two decisions, and coupling them would mean an
   * operator cannot make one without making the other.
   */
  invitationDays: number;
}

/**
 * Reads a retention window in days.
 *
 * `0` is a supported value meaning "keep forever" — a self-hoster under a legal obligation to
 * retain an audit trail has to be able to say so without editing code. A negative value is
 * refused rather than clamped: it would otherwise read as a cutoff in the *future* and delete
 * live rows, which is the one mistake this job must never make quietly.
 */
function retentionDays(name: string, fallback: number): number {
  const days = envInt(name, fallback);
  if (days < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative number of days, received "${days}"`);
  }
  return days;
}

/**
 * Read on every run, not once at boot, so the e2e suite can flip `CLEANUP_ENABLED` around a
 * single call and so a restart is enough to change a window (there is no config reload path).
 */
export function retentionSettings(): RetentionSettings {
  return {
    enabled: envBool('CLEANUP_ENABLED', true),
    notificationDays: retentionDays(
      'NOTIFICATION_RETENTION_DAYS',
      DEFAULT_NOTIFICATION_RETENTION_DAYS,
    ),
    activityDays: retentionDays('ACTIVITY_RETENTION_DAYS', DEFAULT_ACTIVITY_RETENTION_DAYS),
    invitationDays: retentionDays('INVITATION_RETENTION_DAYS', DEFAULT_INVITATION_RETENTION_DAYS),
  };
}

/** The instant before which a row of the given age is deletable. */
export function cutoffFor(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/**
 * The line this job exists to leave behind.
 *
 * Counts only. The rows being deleted are IP addresses, user agents, e-mail addresses in
 * `Verification.identifier` and `WorkspaceInvitation.email`, and notification payloads carrying
 * task titles — precisely the data the policy exists to remove from the database, so copying any
 * of it into a log aggregator on the way out would defeat the whole job.
 * `docs/decisions/0020-data-retention.md`.
 *
 * The rule extends to the orphan sweep without an exception: a storage key is an attachment's
 * identity, so `orphanedFiles` is a number and never a list of paths.
 */
export interface CleanupLogLine extends CleanupCounts {
  ts: string;
  level: 'info';
  event: 'retention.cleanup';
  durationMs: number;
}

/**
 * Deletes rows the retention policy no longer allows the database to hold.
 *
 * Scheduled the same way as `notification/due-soon.worker.ts` — a BullMQ job scheduler on the
 * shared `REDIS_URL`, closed from `onModuleDestroy` — so the two scheduled jobs in this
 * codebase behave identically under deploy and shutdown, and so a multi-replica deployment
 * gets one sweep per night rather than one per replica.
 *
 * Unlike every other query in the API this one is **not scoped by `workspaceId`**. It is a
 * global operator sweep with no request, no session and no tenant behind it: an expired
 * session belongs to a user, not to a workspace, and `Verification` has no tenant column at
 * all. The multi-tenant rule in CLAUDE.md guards data a *caller* can reach; nothing here is
 * reachable by a caller. See ADR 0020.
 */
@Injectable()
export class CleanupWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleanupWorker.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  /**
   * Test seam. Production writes the JSON line to stdout; the unit spec swaps in a collector
   * so it can assert on what a log aggregator would actually receive. Not a constructor
   * parameter because Nest resolves constructor parameters by type, and a function type has
   * no provider to resolve to.
   */
  private write: LogWriter = stdoutWriter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** @internal — for tests. */
  setLogWriter(write: LogWriter): void {
    this.write = write;
  }

  async onModuleInit(): Promise<void> {
    if (!retentionSettings().enabled) {
      // A deliberate off switch, so a warn rather than a log: an instance that has silently
      // stopped enforcing its own retention policy is worth noticing in a startup log.
      this.logger.warn('CLEANUP_ENABLED is false — retention cleanup worker not started');
      return;
    }

    const redisUrl = envString('REDIS_URL', '');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL unset — retention cleanup worker not started');
      return;
    }

    let connection: RedisConnectionOptions;
    try {
      connection = parseRedisUrl(redisUrl);
    } catch {
      this.logger.error('Invalid REDIS_URL — retention cleanup worker not started');
      return;
    }

    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, (job) => this.process(job), { connection });

    this.worker.on('failed', (job, error) => {
      const message = error instanceof Error ? error.message : String(error);
      const attemptsMade = job?.attemptsMade ?? 0;
      // Read back off the job rather than closing over `JOB_ATTEMPTS`, same as due-soon's
      // handler — this stays honest if a job ever ends up scheduled with a different policy.
      const attemptsAllowed = job?.opts.attempts ?? 1;

      if (attemptsMade < attemptsAllowed) {
        // BullMQ already has the next attempt queued per the exponential backoff above — this
        // is expected noise from a transient blip, not something to page anyone for.
        this.logger.warn(
          `cleanup job ${job?.id ?? '?'} failed (attempt ${attemptsMade}/${attemptsAllowed}), retrying: ${message}`,
        );
        return;
      }

      // Every configured attempt is spent: the run that was supposed to enforce the retention
      // policy tonight did not happen, and the next chance is a full day away. `removeOnFail:
      // 50` keeps the job in Redis for later inspection, but that only helps someone who
      // already knew to look — `captureServerError` is what surfaces it instead (issue #191,
      // same shape as BE-06/#189's due-soon fix).
      this.logger.error(
        `cleanup job ${job?.id ?? '?'} exhausted all ${attemptsAllowed} attempt(s), giving up: ${message}`,
      );
      captureServerError(error, { path: 'cleanup-worker' });
    });

    // Same reasoning as the due-soon scan: `add` with `repeat` keys the schedule on the
    // interval, so changing REPEAT_EVERY_MS orphans the old key and leaves two schedules
    // running. A job scheduler is addressed by its id alone, so an upsert replaces the
    // previous definition instead of racing it.
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

    this.logger.log(`retention cleanup worker registered (every ${REPEAT_EVERY_MS / 3600000}h)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Exposed for tests — sweep once.
   *
   * The `enabled` check is repeated here even though `onModuleInit` already refuses to
   * register the scheduler when it is off. A job scheduler lives in Redis, not in this
   * process: an instance restarted with `CLEANUP_ENABLED=false` leaves the definition another
   * replica (or the same Redis, after a rollback) can still act on. Checking at the point of
   * deletion is what actually makes the switch mean "delete nothing".
   */
  async runCleanup(now: Date = new Date()): Promise<CleanupCounts> {
    const settings = retentionSettings();
    const empty: CleanupCounts = {
      sessions: 0,
      verifications: 0,
      notifications: 0,
      activities: 0,
      usagePings: 0,
      invitations: 0,
      orphanedFiles: 0,
    };
    if (!settings.enabled) return empty;

    const startedAt = process.hrtime.bigint();

    // `expiresAt` is the row's own statement of when it stopped being useful, so there is no
    // window to configure: a session past its expiry cannot authenticate anybody and a
    // verification token past its expiry cannot be redeemed. Keeping either one longer stores
    // an IP address, a user agent or an e-mail address for no purpose at all — which is the
    // exact shape of the compliance problem, not merely a storage one.
    const sessions = await this.deleteInBatches(
      () => this.prisma.$executeRaw`
        DELETE FROM "Session"
        WHERE "id" IN (
          SELECT "id" FROM "Session" WHERE "expiresAt" < ${now} LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `,
    );

    const verifications = await this.deleteInBatches(
      () => this.prisma.$executeRaw`
        DELETE FROM "Verification"
        WHERE "id" IN (
          SELECT "id" FROM "Verification" WHERE "expiresAt" < ${now} LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `,
    );

    // `readAt IS NOT NULL` is load-bearing: an unread notification is still doing its job no
    // matter how old it is, and deleting it would silently drop something the user was told
    // was waiting for them. The clock starts at `readAt`, not at `createdAt`, for the same
    // reason — the retention window measures how long a *finished* notification is kept.
    const notifications =
      settings.notificationDays === 0
        ? 0
        : await this.deleteInBatches(() => {
            const cutoff = cutoffFor(now, settings.notificationDays);
            return this.prisma.$executeRaw`
              DELETE FROM "Notification"
              WHERE "id" IN (
                SELECT "id" FROM "Notification"
                WHERE "readAt" IS NOT NULL AND "readAt" < ${cutoff}
                LIMIT ${CLEANUP_BATCH_SIZE}
              )
            `;
          });

    // Activity is append-only and has no "done" marker, so its window runs from `createdAt`.
    // Deleting a row here nulls `Notification.activityId` (the FK is `onDelete: SetNull`),
    // which is why migration 20260814090000 adds the index that referential action needs —
    // without it Postgres re-scans the whole Notification table once per deleted activity.
    const activities =
      settings.activityDays === 0
        ? 0
        : await this.deleteInBatches(() => {
            const cutoff = cutoffFor(now, settings.activityDays);
            return this.prisma.$executeRaw`
              DELETE FROM "Activity"
              WHERE "id" IN (
                SELECT "id" FROM "Activity" WHERE "createdAt" < ${cutoff} LIMIT ${CLEANUP_BATCH_SIZE}
              )
            `;
          });

    // Usage pings share `ACTIVITY_RETENTION_DAYS` rather than growing a knob of their own.
    // They are the same class of row — instance history naming a user — and a self-hoster who
    // has already decided how long this instance keeps a record of what people did here should
    // not have to make that decision twice, in two variables that can silently disagree.
    //
    // The window runs from `createdAt`, not from `day`: the two are the same date for every row
    // this code writes, but `createdAt` is the column that cannot be affected by a future
    // backfill, and it is what "kept for N days after it was written" literally means. No
    // referential action to worry about — nothing references `UsagePing`.
    const usagePings =
      settings.activityDays === 0
        ? 0
        : await this.deleteInBatches(() => {
            const cutoff = cutoffFor(now, settings.activityDays);
            return this.prisma.$executeRaw`
              DELETE FROM "UsagePing"
              WHERE "id" IN (
                SELECT "id" FROM "UsagePing" WHERE "createdAt" < ${cutoff} LIMIT ${CLEANUP_BATCH_SIZE}
              )
            `;
          });

    // `WorkspaceInvitation.email` is the only personal datum in this schema that belongs to
    // somebody who is not a user. An invitation sent to an address that never signed up leaves
    // no `User` row, so account deletion cannot reach it (ADR 0026) and nothing else in the
    // product deletes it either — the row simply stays, with a real address in it, forever.
    // That is the shape of the finding this sweep closes: a table full of third parties' e-mail
    // addresses kept for no purpose, which is exactly what GDPR 5(1)(e) and KVKK 4 forbid.
    //
    // **A row is a candidate once it is finished, not once it is old.** Two ways to be
    // finished, and the `OR` is both of them: a `status` other than `pending` is a decision
    // somebody made (accepted, rejected, canceled), and `expiresAt` in the past is the decision
    // the clock made. A `pending` row whose expiry is still ahead of it is a live grant of
    // access somebody can still accept, and it is exempt at **any** age — deleting one would
    // silently withdraw an invitation an admin was told had been sent, and the settings screen
    // (which lists exactly `pending` and unexpired) would stop showing it with nothing to say.
    //
    // The window runs from `createdAt` because it is the only timestamp this table has: there
    // is no `resolvedAt` and Better Auth writes no `updatedAt` here. Measuring from creation
    // rather than from resolution deletes the record slightly *earlier* than a `resolvedAt`
    // would, and the gap is bounded by how long a row can stay pending — the invitation expiry,
    // days rather than months. Adding a column to close a gap that size is not worth a
    // migration; an instance whose invitation expiry ever approaches this window is the case to
    // revisit it for.
    //
    // **No index for this predicate yet, and that is an open item rather than a precedent.**
    // The precedent runs the other way: migration `20260814180000_retention_sweep_indexes`
    // measured every sweep at production-like volume and *added* `Session_expiresAt_idx`,
    // `Verification_expiresAt_idx` and `UsagePing_createdAt_idx` because those three were
    // sequential scans paid nightly, forever; it left `Activity` and `Notification` alone only
    // because their plans showed an existing composite already serving the sweep. The rule ADR
    // 0020 and `20260814150000_drop_unused_indexes` (DB-07) established is "measure, then add or
    // drop" — not "sweeps go unindexed". Nothing here has been measured, so what is claimed is
    // only that `WorkspaceInvitation` is orders of magnitude smaller than those tables (one row
    // per invitation ever sent, against one per event or per session) and that
    // `@@index([workspaceId, email, status])` cannot serve this predicate anyway — it constrains
    // neither `workspaceId` nor `email`, and `createdAt` is not in it. The same measurement is
    // what should decide, on an instance where this table has grown enough to be worth taking.
    const invitations =
      settings.invitationDays === 0
        ? 0
        : await this.deleteInBatches(() => {
            const cutoff = cutoffFor(now, settings.invitationDays);
            return this.prisma.$executeRaw`
              DELETE FROM "WorkspaceInvitation"
              WHERE "id" IN (
                SELECT "id" FROM "WorkspaceInvitation"
                WHERE "createdAt" < ${cutoff}
                  AND ("status" <> 'pending' OR "expiresAt" < ${now})
                LIMIT ${CLEANUP_BATCH_SIZE}
              )
            `;
          });

    // Last, and after the row sweeps on purpose: a row deleted above may be the last claim on a
    // file, so running the file pass afterwards makes that file a candidate tonight rather than
    // tomorrow night. It is also the only pass that touches something outside Postgres.
    const orphanedFiles = await this.sweepOrphanFiles(now);

    const counts: CleanupCounts = {
      sessions,
      verifications,
      notifications,
      activities,
      usagePings,
      invitations,
      orphanedFiles,
    };
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    // Emitted even when every count is zero. One line a night is a rounding error in log
    // volume, and its absence is the only evidence anyone gets that the sweep stopped
    // running — a job that quietly does nothing is indistinguishable from a job that is
    // quietly not scheduled.
    const line: CleanupLogLine = {
      ts: new Date().toISOString(),
      level: 'info',
      event: 'retention.cleanup',
      durationMs: Math.round(durationMs * 1000) / 1000,
      ...counts,
    };
    this.write(JSON.stringify(line));

    return counts;
  }

  /**
   * Runs one table's `DELETE` until it stops filling a batch.
   *
   * The exit condition is a batch that came back short, which is the only signal that says
   * "no matching rows are left" without a second counting query. Each call is its own
   * implicit transaction — that is the point of the loop: the lock and the WAL of one batch
   * are released before the next begins, so a large first sweep never turns into one
   * long-running transaction that blocks autovacuum on the table it is cleaning.
   *
   * The cost is that every batch re-evaluates the predicate from the start of the table. That
   * is accepted rather than fixed with a keyset cursor: after the first run the loop is a
   * single short batch per table, and the alternative (paging by `id` across statements) has
   * to remember where it was across transactions that are deleting the very rows the cursor
   * points at. Nothing here needs to be fast — it runs once a night, off any request path.
   */
  private async deleteInBatches(runBatch: () => Promise<number>): Promise<number> {
    let total = 0;

    for (let pass = 0; pass < MAX_BATCHES_PER_TABLE; pass += 1) {
      const deleted = await runBatch();
      total += deleted;
      if (deleted < CLEANUP_BATCH_SIZE) return total;
    }

    this.logger.warn(
      `retention cleanup stopped at the ${MAX_BATCHES_PER_TABLE}-batch ceiling; the remainder is deleted on the next run`,
    );
    return total;
  }

  /**
   * Deletes stored files that no attachment row claims.
   *
   * Not `deleteInBatches`: that helper's contract is a `() => Promise<number>` running one
   * idempotent SQL statement per call, and an `unlink` is neither transactional nor reversible.
   * The sweep lives here and reports into the same counts, but it is its own loop — the shape
   * break is deliberate and ADR 0022 records it.
   *
   * Keys are checked against the database in batches so a directory of a million files is one
   * `IN (…)` per thousand rather than a million round trips, and the whole pass is capped the
   * same way every other sweep is: a bug that matches files the delete does not remove ends the
   * run, it does not spin.
   *
   * The age check runs before the database is consulted at all, so a directory of fresh uploads
   * on a deployment that has never orphaned anything costs zero queries.
   */
  private async sweepOrphanFiles(now: Date): Promise<number> {
    if (!this.storage.persistsFiles) return 0;

    const cutoff = new Date(now.getTime() - orphanGraceMs());
    const ceiling = CLEANUP_BATCH_SIZE * MAX_BATCHES_PER_TABLE;
    let removed = 0;
    let batch: string[] = [];

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const claimed = await this.prisma.attachment.findMany({
        where: { storageKey: { in: batch } },
        select: { storageKey: true },
      });
      const keep = new Set(claimed.map((row) => row.storageKey));
      for (const key of batch) {
        if (keep.has(key)) continue;
        await this.storage.remove(key);
        removed += 1;
      }
      batch = [];
    };

    for await (const entry of this.storage.listKeys()) {
      if (entry.modifiedAt >= cutoff) continue;
      batch.push(entry.key);
      if (batch.length >= CLEANUP_BATCH_SIZE) await flush();
      if (removed >= ceiling) break;
    }
    await flush();

    return removed;
  }

  /**
   * BullMQ's retry always re-invokes this whole method, never a single {@link deleteInBatches}
   * call — job-level retry, not batch-level. That is a deliberate choice, not the path of
   * least resistance: `deleteInBatches`'s signature (`() => Promise<number>`) has no way to
   * report which pass it died on, so a batch-level retry would need new plumbing to resume mid
   * table. Retrying the whole run instead costs nothing extra, because every `DELETE …WHERE
   * expiresAt < now` / `…createdAt < cutoff` predicate here is naturally idempotent: a retry
   * re-selects whatever is still eligible — rows an earlier, successful table in the same
   * attempt already removed simply match zero rows the second time — so re-running the run from
   * the top never double-deletes or double-counts anything the log line reports.
   */
  private async process(_job: Job): Promise<void> {
    await this.runCleanup();
  }
}
