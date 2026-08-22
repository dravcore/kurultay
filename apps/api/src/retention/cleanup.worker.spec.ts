import { Logger } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { initSentry, resetSentryForTesting } from '../common/observability/sentry';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  CLEANUP_BATCH_SIZE,
  CleanupWorker,
  MAX_BATCHES_PER_TABLE,
  MIN_ORPHAN_GRACE_MS,
  cutoffFor,
  orphanGraceMs,
  retentionSettings,
} from './cleanup.worker';

// Same stub as the due-soon worker's spec: the registration tests need to see what the worker
// asks BullMQ for, without a Redis for it to ask against.
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    upsertJobScheduler: jest.fn().mockResolvedValue({ id: 'retention-cleanup' }),
    close: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));

const RETENTION_ENV = [
  'CLEANUP_ENABLED',
  'NOTIFICATION_RETENTION_DAYS',
  'ACTIVITY_RETENTION_DAYS',
  'INVITATION_RETENTION_DAYS',
  'REDIS_URL',
  // The orphan sweep's grace period is BACKUP_KEEP × BACKUP_INTERVAL, so these two are as much
  // retention configuration as the windows above are.
  'BACKUP_INTERVAL',
  'BACKUP_KEEP',
] as const;

/** A storage key shaped like the real thing: it carries an attachment's id, so it identifies. */
const ORPHAN_KEY = '0198f0c2/0198f0c2-3c1a-7a3f-9b6e-2f0a1d4c5e60';

/** A frozen "now" so every cutoff in these tests is arithmetic, not a race with the clock. */
const NOW = new Date('2026-08-14T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

type ExecuteRawCall = [TemplateStringsArray, ...unknown[]];

function statementOf(call: ExecuteRawCall): string {
  return call[0].join('?').replace(/\s+/g, ' ').trim();
}

describe('CleanupWorker', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of RETENTION_ENV) saved.set(key, process.env[key]);
  });

  afterEach(() => {
    for (const key of RETENTION_ENV) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.clearAllMocks();
  });

  /**
   * A `StorageService` stub whose `persistsFiles` is a plain writable property.
   *
   * The real one is a getter over the process-wide backend; a test that wants "this deployment
   * stores nothing" would otherwise have to reach into module state that other specs share.
   */
  interface StorageStub {
    persistsFiles: boolean;
    listKeys: jest.Mock;
    remove: jest.Mock;
  }

  /** Turns a plain array into the `AsyncIterable` `StorageBackend.listKeys` hands back. */
  function keyStream(entries: { key: string; modifiedAt: Date }[]): AsyncIterable<{
    key: string;
    modifiedAt: Date;
  }> {
    return {
      async *[Symbol.asyncIterator]() {
        for (const entry of entries) yield entry;
      },
    };
  }

  function buildWorker(deleted: number[] = []): {
    worker: CleanupWorker;
    executeRaw: jest.Mock;
    findMany: jest.Mock;
    storage: StorageStub;
    lines: string[];
  } {
    const executeRaw = jest.fn().mockResolvedValue(0);
    for (const count of deleted) executeRaw.mockResolvedValueOnce(count);

    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $executeRaw: executeRaw,
      attachment: { findMany },
    } as unknown as PrismaService;

    // Nothing on disk by default, so every existing test in this file keeps describing a run
    // that only deletes rows.
    const storage: StorageStub = {
      persistsFiles: true,
      listKeys: jest.fn(() => keyStream([])),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const worker = new CleanupWorker(prisma, storage as unknown as StorageService);
    const lines: string[] = [];
    worker.setLogWriter((line) => lines.push(line));

    return { worker, executeRaw, findMany, storage, lines };
  }

  function callsFor(executeRaw: jest.Mock, table: string): ExecuteRawCall[] {
    return (executeRaw.mock.calls as ExecuteRawCall[]).filter((call) =>
      statementOf(call).includes(`DELETE FROM "${table}"`),
    );
  }

  describe('what it selects', () => {
    it('sweeps all six tables in one run and reports each table separately', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, executeRaw } = buildWorker([3, 2, 7, 5, 4, 6]);

      await expect(worker.runCleanup(NOW)).resolves.toEqual({
        sessions: 3,
        verifications: 2,
        notifications: 7,
        activities: 5,
        usagePings: 4,
        invitations: 6,
        orphanedFiles: 0,
      });

      // One statement per table: each batch came back short, so no table looped.
      expect(executeRaw).toHaveBeenCalledTimes(6);
      for (const table of [
        'Session',
        'Verification',
        'Notification',
        'Activity',
        'UsagePing',
        'WorkspaceInvitation',
      ]) {
        expect(callsFor(executeRaw, table)).toHaveLength(1);
      }
    });

    /**
     * Usage pings share ACTIVITY_RETENTION_DAYS rather than carrying a window of their own —
     * same class of row, one decision for the operator to make. The window runs from
     * `createdAt`, which is what "kept for N days after it was written" means.
     */
    it('sweeps UsagePing on the activity window, measured from createdAt', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.ACTIVITY_RETENTION_DAYS = '30';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'UsagePing');
      expect(statementOf(call!)).toContain('WHERE "createdAt" < ?');
      expect(call![1]).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
    });

    /** `0` means "keep forever" for pings exactly as it does for the activity rows. */
    it('issues no UsagePing statement when the activity window is disabled', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.ACTIVITY_RETENTION_DAYS = '0';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      expect(callsFor(executeRaw, 'UsagePing')).toHaveLength(0);
    });

    it('deletes a Session strictly before its own expiry, never one expiring exactly now', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'Session');
      // `<`, not `<=`: a session whose expiresAt is exactly the sweep instant is still a live
      // session for that instant, and deleting it would sign somebody out a beat early.
      expect(statementOf(call!)).toContain('WHERE "expiresAt" < ?');
      expect(call![1]).toEqual(NOW);
      expect(call![2]).toBe(CLEANUP_BATCH_SIZE);
    });

    it('deletes a Verification on the same strict expiry comparison', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'Verification');
      expect(statementOf(call!)).toContain('WHERE "expiresAt" < ?');
      expect(call![1]).toEqual(NOW);
    });

    it('only ever deletes a read Notification, and only one read before the cutoff', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      delete process.env.NOTIFICATION_RETENTION_DAYS;
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'Notification');
      // Unread is untouched at any age: it is still the thing the user was told is waiting.
      expect(statementOf(call!)).toContain('WHERE "readAt" IS NOT NULL AND "readAt" < ?');
      // Default window, measured from readAt: 90 days.
      expect(call![1]).toEqual(new Date(NOW.getTime() - 90 * DAY_MS));
    });

    it('honours NOTIFICATION_RETENTION_DAYS, to the second', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.NOTIFICATION_RETENTION_DAYS = '30';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const cutoff = callsFor(executeRaw, 'Notification')[0]![1] as Date;
      expect(cutoff).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
      // A row read exactly at the cutoff is outside `readAt < cutoff` and survives; a row read
      // one second earlier is inside it. Nothing between those two instants is ambiguous.
      expect(cutoff.getTime()).toBeGreaterThan(
        new Date(NOW.getTime() - 30 * DAY_MS - 1000).getTime(),
      );
    });

    it('measures the Activity window from createdAt, since an activity is never "read"', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      delete process.env.ACTIVITY_RETENTION_DAYS;
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'Activity');
      expect(statementOf(call!)).toContain('WHERE "createdAt" < ?');
      expect(call![1]).toEqual(new Date(NOW.getTime() - 365 * DAY_MS));
    });

    /**
     * The invitation sweep is the only one whose predicate has two ways to match, and getting
     * either half wrong is silent: drop the `status` half and a canceled invitation keeps its
     * invitee's address forever, drop the expiry half and an abandoned `pending` row does. The
     * `AND "createdAt" <` is what keeps both halves inside a window rather than immediate.
     */
    it('deletes a finished WorkspaceInvitation on the invitation window, measured from createdAt', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      delete process.env.INVITATION_RETENTION_DAYS;
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      const [call] = callsFor(executeRaw, 'WorkspaceInvitation');
      const statement = statementOf(call!);
      expect(statement).toContain('WHERE "createdAt" < ?');
      // Finished either because somebody decided, or because the clock did.
      expect(statement).toContain('AND ("status" <> \'pending\' OR "expiresAt" < ?)');
      // Default window: 90 days, not the activity year.
      expect(call![1]).toEqual(new Date(NOW.getTime() - 90 * DAY_MS));
      // The expiry half compares against the sweep instant itself, not against the cutoff — an
      // invitation that expired yesterday is finished today, and the window is what then
      // decides how long the finished record is kept.
      expect(call![2]).toEqual(NOW);
    });

    it('honours INVITATION_RETENTION_DAYS independently of the notification window', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.INVITATION_RETENTION_DAYS = '30';
      process.env.NOTIFICATION_RETENTION_DAYS = '90';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      expect(callsFor(executeRaw, 'WorkspaceInvitation')[0]![1]).toEqual(
        new Date(NOW.getTime() - 30 * DAY_MS),
      );
      // Same default number, separate decision: moving one must not move the other.
      expect(callsFor(executeRaw, 'Notification')[0]![1]).toEqual(
        new Date(NOW.getTime() - 90 * DAY_MS),
      );
    });

    it('bounds every statement with the batch size', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, executeRaw } = buildWorker();

      await worker.runCleanup(NOW);

      for (const call of executeRaw.mock.calls as ExecuteRawCall[]) {
        expect(statementOf(call)).toContain('LIMIT ?');
        expect(call[call.length - 1]).toBe(CLEANUP_BATCH_SIZE);
      }
    });
  });

  describe('retention windows that mean "keep forever"', () => {
    it('issues no Notification statement when NOTIFICATION_RETENTION_DAYS is 0', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.NOTIFICATION_RETENTION_DAYS = '0';
      const { worker, executeRaw } = buildWorker();

      const counts = await worker.runCleanup(NOW);

      expect(counts.notifications).toBe(0);
      expect(callsFor(executeRaw, 'Notification')).toHaveLength(0);
      // The expiry sweeps are not configurable and keep running.
      expect(callsFor(executeRaw, 'Session')).toHaveLength(1);
    });

    it('issues no Activity statement when ACTIVITY_RETENTION_DAYS is 0', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.ACTIVITY_RETENTION_DAYS = '0';
      const { worker, executeRaw } = buildWorker();

      const counts = await worker.runCleanup(NOW);

      expect(counts.activities).toBe(0);
      expect(callsFor(executeRaw, 'Activity')).toHaveLength(0);
    });

    it('issues no WorkspaceInvitation statement when INVITATION_RETENTION_DAYS is 0', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.INVITATION_RETENTION_DAYS = '0';
      const { worker, executeRaw } = buildWorker();

      const counts = await worker.runCleanup(NOW);

      expect(counts.invitations).toBe(0);
      expect(callsFor(executeRaw, 'WorkspaceInvitation')).toHaveLength(0);
    });

    it('refuses a negative window instead of turning it into a cutoff in the future', () => {
      process.env.ACTIVITY_RETENTION_DAYS = '-1';

      // A future cutoff would delete live rows. Boot loudly rather than sweep wrongly.
      expect(() => retentionSettings()).toThrow(/ACTIVITY_RETENTION_DAYS/);
    });
  });

  describe('CLEANUP_ENABLED=false', () => {
    it('deletes nothing and issues no statement', async () => {
      process.env.CLEANUP_ENABLED = 'false';
      const { worker, executeRaw, storage, lines } = buildWorker([10, 10, 10, 10]);

      await expect(worker.runCleanup(NOW)).resolves.toEqual({
        sessions: 0,
        verifications: 0,
        notifications: 0,
        activities: 0,
        usagePings: 0,
        invitations: 0,
        orphanedFiles: 0,
      });
      expect(executeRaw).not.toHaveBeenCalled();
      // The off switch covers the file sweep too: it is the same run, and a switch that stops
      // deleting rows while still deleting files would be the worst possible reading of it.
      expect(storage.listKeys).not.toHaveBeenCalled();
      expect(lines).toEqual([]);
    });

    it('starts no queue and no scheduler', async () => {
      process.env.CLEANUP_ENABLED = 'false';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { worker } = buildWorker();

      await worker.onModuleInit();

      expect(Queue).not.toHaveBeenCalled();
      await worker.onModuleDestroy();
    });
  });

  describe('batching', () => {
    it('keeps deleting a table while its batches come back full', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      // Session: full, full, short. Then one short batch for each remaining table.
      const { worker, executeRaw } = buildWorker([CLEANUP_BATCH_SIZE, CLEANUP_BATCH_SIZE, 4]);

      const counts = await worker.runCleanup(NOW);

      expect(callsFor(executeRaw, 'Session')).toHaveLength(3);
      expect(counts.sessions).toBe(CLEANUP_BATCH_SIZE * 2 + 4);
      // The short batch is the exit condition, so the other tables are still swept.
      expect(callsFor(executeRaw, 'Verification')).toHaveLength(1);
    });

    it('stops at the per-table ceiling rather than looping against the database forever', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      // Always a full batch — the shape a broken predicate would produce.
      const executeRaw = jest.fn().mockResolvedValue(CLEANUP_BATCH_SIZE);
      const worker = new CleanupWorker(
        { $executeRaw: executeRaw } as unknown as PrismaService,
        { persistsFiles: false } as unknown as StorageService,
      );
      worker.setLogWriter(() => {});

      await worker.runCleanup(NOW);

      expect(callsFor(executeRaw, 'Session')).toHaveLength(MAX_BATCHES_PER_TABLE);
    });
  });

  /**
   * The one sweep in this worker that is not a batched `DELETE`, and the one count that is not
   * a row count. Its grace period is `BACKUP_KEEP × BACKUP_INTERVAL`, so a file can never be
   * deleted while a dump old enough to disown it is still restorable (ADR 0022).
   */
  describe('orphan attachment sweep', () => {
    beforeEach(() => {
      process.env.CLEANUP_ENABLED = 'true';
      delete process.env.BACKUP_INTERVAL;
      delete process.env.BACKUP_KEEP;
    });

    /** One key, aged relative to the cutoff by `offsetMs` (negative = older than the cutoff). */
    function withOrphan(offsetMs: number): ReturnType<typeof buildWorker> {
      const built = buildWorker();
      const modifiedAt = new Date(NOW.getTime() - orphanGraceMs() + offsetMs);
      built.storage.listKeys.mockReturnValue(keyStream([{ key: ORPHAN_KEY, modifiedAt }]));
      return built;
    }

    it('removes a file with no row once it is older than the grace period', async () => {
      const { worker, storage } = withOrphan(-1000);

      const counts = await worker.runCleanup(NOW);

      expect(storage.remove).toHaveBeenCalledWith(ORPHAN_KEY);
      expect(counts.orphanedFiles).toBe(1);
    });

    it('leaves a file alone while a dump old enough to disown it is still restorable', async () => {
      const { worker, storage, findMany } = withOrphan(1000);

      const counts = await worker.runCleanup(NOW);

      expect(storage.remove).not.toHaveBeenCalled();
      expect(counts.orphanedFiles).toBe(0);
      // Not even asked about: a file inside the window is skipped before the database is
      // consulted, so a directory of fresh uploads costs no queries at all.
      expect(findMany).not.toHaveBeenCalled();
    });

    it('leaves a file alone when a row still points at it', async () => {
      const { worker, storage, findMany } = withOrphan(-1000);
      findMany.mockResolvedValue([{ storageKey: ORPHAN_KEY }]);

      const counts = await worker.runCleanup(NOW);

      expect(storage.remove).not.toHaveBeenCalled();
      expect(counts.orphanedFiles).toBe(0);
    });

    it('asks the database only about the keys it is holding, and only for the key column', async () => {
      const { worker, findMany } = withOrphan(-1000);

      await worker.runCleanup(NOW);

      expect(findMany).toHaveBeenCalledWith({
        where: { storageKey: { in: [ORPHAN_KEY] } },
        select: { storageKey: true },
      });
    });

    it('honours a shortened BACKUP_KEEP instead of assuming the default week', async () => {
      process.env.BACKUP_KEEP = '2';
      process.env.BACKUP_INTERVAL = '86400';
      // Three days old: outside a two-day window, well inside the seven-day default.
      const { worker, storage } = buildWorker();
      storage.listKeys.mockReturnValue(
        keyStream([{ key: ORPHAN_KEY, modifiedAt: new Date(NOW.getTime() - 3 * DAY_MS) }]),
      );

      const counts = await worker.runCleanup(NOW);

      expect(storage.remove).toHaveBeenCalledWith(ORPHAN_KEY);
      expect(counts.orphanedFiles).toBe(1);
    });

    it('does nothing at all when this deployment stores no files', async () => {
      const { worker, storage } = withOrphan(-1000);
      storage.persistsFiles = false;

      const counts = await worker.runCleanup(NOW);

      expect(storage.listKeys).not.toHaveBeenCalled();
      expect(counts.orphanedFiles).toBe(0);
    });

    it('never writes a path into the log line', async () => {
      const { worker, lines } = withOrphan(-1000);

      await worker.runCleanup(NOW);

      // A storage key is an attachment's identity. Copying it into a log aggregator is exactly
      // what this job exists to prevent (ADR 0020, `CleanupLogLine`).
      expect(lines[0]).not.toContain(ORPHAN_KEY);
      expect(JSON.parse(lines[0]!)).toMatchObject({ orphanedFiles: expect.any(Number) });
    });

    it('checks a directory in batches rather than one round trip per file', async () => {
      const { worker, findMany, storage } = buildWorker();
      const old = new Date(NOW.getTime() - 30 * DAY_MS);
      storage.listKeys.mockReturnValue(
        keyStream(
          Array.from({ length: CLEANUP_BATCH_SIZE + 1 }, (_, index) => ({
            key: `${ORPHAN_KEY}-${index}`,
            modifiedAt: old,
          })),
        ),
      );

      const counts = await worker.runCleanup(NOW);

      // 1001 files, two queries: one full batch plus the flush of the remainder.
      expect(findMany).toHaveBeenCalledTimes(2);
      expect(
        (findMany.mock.calls[0]![0] as { where: { storageKey: { in: string[] } } }).where.storageKey
          .in,
      ).toHaveLength(CLEANUP_BATCH_SIZE);
      expect(counts.orphanedFiles).toBe(CLEANUP_BATCH_SIZE + 1);
    });
  });

  describe('orphanGraceMs', () => {
    beforeEach(() => {
      delete process.env.BACKUP_INTERVAL;
      delete process.env.BACKUP_KEEP;
    });

    it('defaults to a week — the same rotation the backup sidecar actually performs', () => {
      expect(orphanGraceMs()).toBe(7 * DAY_MS);
    });

    it('multiplies the two backup variables the compose file passes in', () => {
      process.env.BACKUP_INTERVAL = '86400';
      process.env.BACKUP_KEEP = '3';

      expect(orphanGraceMs()).toBe(3 * DAY_MS);
    });

    it('treats BACKUP_KEEP=0 as one archive rather than as no grace at all', () => {
      // `ls | tail -n +1` in backup.sh's prune keeps nothing, but a zero-length window would
      // let the sweep delete a file the instant its row is missing — including during a
      // restore. Clamping to one interval is the conservative reading.
      process.env.BACKUP_KEEP = '0';
      process.env.BACKUP_INTERVAL = '86400';

      expect(orphanGraceMs()).toBe(DAY_MS);
    });

    /**
     * The floor exists because the grace period does two jobs and only one of them is about
     * backups. See {@link orphanGraceMs} — the in-flight upload race is there whether or not
     * this deployment takes a dump at all, so the window can never bottom out at zero.
     */
    it('never returns less than a day, however the backup pair is configured', () => {
      process.env.BACKUP_INTERVAL = '3600';
      process.env.BACKUP_KEEP = '3';

      // Three hours by multiplication; a day by floor.
      expect(orphanGraceMs()).toBe(MIN_ORPHAN_GRACE_MS);
      expect(MIN_ORPHAN_GRACE_MS).toBe(DAY_MS);
    });

    it('refuses to collapse the window when BACKUP_INTERVAL is 0', () => {
      // The data-loss path this floor closes: a zero-length window hands the sweep every file
      // whose row has not committed yet — bytes written, row still in flight, gone.
      process.env.BACKUP_INTERVAL = '0';
      process.env.BACKUP_KEEP = '7';

      expect(orphanGraceMs()).toBe(MIN_ORPHAN_GRACE_MS);
    });

    it('still honours a window longer than the floor', () => {
      process.env.BACKUP_INTERVAL = '86400';
      process.env.BACKUP_KEEP = '7';

      expect(orphanGraceMs()).toBe(7 * DAY_MS);
    });
  });

  describe('the log line', () => {
    it('emits one JSON line carrying the per-table counts and nothing from the rows', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, lines } = buildWorker([3, 2, 7, 5, 4, 6]);

      await worker.runCleanup(NOW);

      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(line).toMatchObject({
        level: 'info',
        event: 'retention.cleanup',
        sessions: 3,
        verifications: 2,
        notifications: 7,
        activities: 5,
        usagePings: 4,
        invitations: 6,
      });
      expect(typeof line.ts).toBe('string');
      expect(typeof line.durationMs).toBe('number');
      // Counts only. Anything identifying — an IP, a user agent, an e-mail, a task title —
      // would be the very data this job exists to delete, copied into a log aggregator on its
      // way out. The field list is closed for that reason.
      expect(Object.keys(line).sort()).toEqual([
        'activities',
        'durationMs',
        'event',
        'invitations',
        'level',
        'notifications',
        'orphanedFiles',
        'sessions',
        'ts',
        'usagePings',
        'verifications',
      ]);
    });

    it('still reports a run that deleted nothing', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      const { worker, lines } = buildWorker();

      await worker.runCleanup(NOW);

      // A silent job and an unscheduled job look identical in a log; the zero line is what
      // tells them apart.
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ sessions: 0, activities: 0 });
    });
  });

  describe('registration', () => {
    it('registers a daily job scheduler, not a deprecated repeatable job', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { worker } = buildWorker();

      await worker.onModuleInit();

      const queue = (Queue as unknown as jest.Mock).mock.results[0]!.value as {
        add: jest.Mock;
        upsertJobScheduler: jest.Mock;
      };
      expect(queue.add).not.toHaveBeenCalled();
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'retention-cleanup',
        { every: 24 * 60 * 60 * 1000 },
        {
          name: 'purge-expired',
          opts: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 5,
            backoff: { type: 'exponential', delay: 5 * 60 * 1000 },
          },
        },
      );

      await worker.onModuleDestroy();
    });

    it('starts nothing when REDIS_URL is unset', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      delete process.env.REDIS_URL;

      await buildWorker().worker.onModuleInit();

      expect(Queue).not.toHaveBeenCalled();
    });

    it('starts nothing when REDIS_URL cannot be parsed', async () => {
      process.env.CLEANUP_ENABLED = 'true';
      process.env.REDIS_URL = 'not-a-url';

      await buildWorker().worker.onModuleInit();

      expect(Queue).not.toHaveBeenCalled();
    });
  });

  /**
   * Mirrors the BE-06 tests in `due-soon.worker.spec.ts`, sized to this worker's own retry
   * policy: 5 attempts, not 3. A mid-retry failure is `warn`-level noise BullMQ is already
   * handling; only the failure of the last configured attempt is `error`-level and reported
   * to Sentry, since a skipped cleanup run is otherwise invisible until someone happens to
   * notice a table that should have shrunk did not.
   */
  describe('failed handler', () => {
    beforeEach(() => {
      process.env.CLEANUP_ENABLED = 'true';
      resetSentryForTesting();
    });

    afterEach(() => {
      resetSentryForTesting();
    });

    /**
     * Starts a worker and hands back the `on('failed', ...)` callback BullMQ would invoke —
     * read off the mocked `Worker`'s own `.on` calls, not a copy the test wrote itself, so
     * this exercises the exact closure `cleanup.worker.ts` registers.
     */
    async function registerAndGetFailedHandler(): Promise<
      (job: Job | undefined, error: Error) => void
    > {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const prisma = { $executeRaw: jest.fn() } as unknown as PrismaService;
      const worker = new CleanupWorker(prisma, {
        persistsFiles: false,
      } as unknown as StorageService);

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

    /** Installs a fake Sentry SDK through the loader seam, same pattern as due-soon's spec. */
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

    it('logs a warning, not an error, when a failed run still has attempts left', async () => {
      const { captureException } = await enableFakeSentry();
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const handler = await registerAndGetFailedHandler();
      const job = { id: 'j1', attemptsMade: 1, opts: { attempts: 5 } } as unknown as Job;

      handler(job, new Error('ECONNRESET'));

      expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('attempt 1/5'));
      expect(logError).not.toHaveBeenCalled();
      expect(captureException).not.toHaveBeenCalled();
    });

    it('logs an error and reports to Sentry once every configured attempt is spent', async () => {
      const { captureException } = await enableFakeSentry();
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const handler = await registerAndGetFailedHandler();
      const error = new Error('relation "Session" does not exist');
      const job = { id: 'j1', attemptsMade: 5, opts: { attempts: 5 } } as unknown as Job;

      handler(job, error);

      expect(logError).toHaveBeenCalledWith(expect.stringContaining('exhausted all 5 attempt(s)'));
      expect(captureException).toHaveBeenCalledWith(error);
    });

    it('does not report to Sentry when Sentry is off (no SENTRY_DSN)', async () => {
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const handler = await registerAndGetFailedHandler();
      const job = { id: 'j1', attemptsMade: 5, opts: { attempts: 5 } } as unknown as Job;

      // Must not throw even though nothing is listening on the Sentry side.
      expect(() => handler(job, new Error('boom'))).not.toThrow();
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('cutoffFor', () => {
    it('subtracts whole days from the given instant', () => {
      expect(cutoffFor(NOW, 90)).toEqual(new Date('2026-05-16T00:00:00.000Z'));
    });

    it('is the identity at zero days, so a zero window can never mean "delete everything"', () => {
      // The callers skip the sweep entirely at 0; this guards the arithmetic behind that.
      expect(cutoffFor(NOW, 0)).toEqual(NOW);
    });
  });
});
