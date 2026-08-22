import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { envString, isTestEnv } from '../env';
import { captureServerError } from '../observability/sentry';
import { parseRedisUrl } from '../redis-url';

const logger = new Logger('UploadBudget');

/** Namespace so the counters cannot collide with the auth limiter, the adapter or BullMQ. */
export const UPLOAD_BUDGET_KEY_PREFIX = 'kurul:upload-budget:';

/** Message in the `AllExceptionsFilter` envelope when the byte budget refuses an upload. */
export const UPLOAD_BUDGET_ERROR_MESSAGE =
  'Upload byte budget exceeded. Please try again in a minute.';

/**
 * Cap on distinct keys the in-process fallback tracks at once. Same number and same reasoning
 * as the auth limiter's fallback: a flood from rotating addresses during a Redis outage is the
 * traffic that would otherwise grow the map without bound, and an evicted key merely starts a
 * fresh window.
 */
export const UPLOAD_BUDGET_FALLBACK_MAX_ENTRIES = 10_000;

/** Minimum time between degraded/recovered reports, so a flapping Redis logs once, not per call. */
export const UPLOAD_BUDGET_REPORT_DAMPEN_MS = 5 * 60 * 1000;

export interface ByteBudgetVerdict {
  allowed: boolean;
  /** Whole seconds until the current window lapses: what `Retry-After` carries on a refusal. */
  retryAfterSeconds: number;
}

/**
 * A fixed-window byte counter.
 *
 * `charge` adds `bytes` to `key`'s running total for the current window and answers whether
 * that total is still within `limit`. The charge is made before the comparison, mirroring
 * `INCR`-then-compare in the auth limiter's script: the request that crosses the line is
 * counted, so a client cannot probe the remaining budget for free.
 */
export interface ByteBudget {
  charge(
    key: string,
    bytes: number,
    limit: number,
    windowSeconds: number,
  ): Promise<ByteBudgetVerdict>;
}

/**
 * One round trip, evaluated atomically: `INCRBY` creates the key when absent, and the
 * `ttl < 0` branch opens the window (doubling as a repair for a key that lost its expiry).
 * The window is fixed rather than sliding, which is what lets the whole check be a counter
 * and an expiry rather than a sorted set per client.
 */
const CHARGE_SCRIPT = `
local total = redis.call('INCRBY', KEYS[1], ARGV[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  ttl = tonumber(ARGV[2])
end
if total > tonumber(ARGV[3]) then
  return {0, ttl}
end
return {1, ttl}
`;

interface WindowEntry {
  total: number;
  expiresAt: number;
}

/**
 * In-process fixed-window byte counter: the store for an instance without `REDIS_URL`, and the
 * floor `RedisByteBudget` falls back to while Redis is erroring.
 *
 * Per process, so behind N replicas the effective ceiling is `limit * N`; a bounded number,
 * unlike the unbounded one fail-open would produce. Bounded memory and no timers: an expired
 * entry is noticed lazily on the next charge for its key, and the map's size is held at
 * `UPLOAD_BUDGET_FALLBACK_MAX_ENTRIES` by evicting an expired entry first, the oldest live one
 * otherwise (a key is re-inserted on every fresh window, so "oldest" means least recently
 * started rather than first ever seen).
 */
export class InMemoryByteBudget implements ByteBudget {
  private readonly windows = new Map<string, WindowEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  charge(
    key: string,
    bytes: number,
    limit: number,
    windowSeconds: number,
  ): Promise<ByteBudgetVerdict> {
    return Promise.resolve(this.chargeSync(key, bytes, limit, windowSeconds));
  }

  private chargeSync(
    key: string,
    bytes: number,
    limit: number,
    windowSeconds: number,
  ): ByteBudgetVerdict {
    const now = this.now();
    const existing = this.windows.get(key);

    if (existing !== undefined && existing.expiresAt > now) {
      existing.total += bytes;
      return {
        allowed: existing.total <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
      };
    }

    if (existing !== undefined) {
      // Expired: delete before re-inserting so the key moves to the insertion-order tail.
      this.windows.delete(key);
    } else if (this.windows.size >= UPLOAD_BUDGET_FALLBACK_MAX_ENTRIES) {
      this.evictOne(now);
    }

    this.windows.set(key, { total: bytes, expiresAt: now + windowSeconds * 1000 });
    return { allowed: bytes <= limit, retryAfterSeconds: windowSeconds };
  }

  private evictOne(now: number): void {
    let oldestKey: string | undefined;
    for (const [candidate, entry] of this.windows) {
      if (entry.expiresAt <= now) {
        this.windows.delete(candidate);
        return;
      }
      oldestKey ??= candidate;
    }
    if (oldestKey !== undefined) {
      this.windows.delete(oldestKey);
    }
  }
}

/** The slice of an ioredis client the Redis store needs, so a spec can hand in a stub. */
export type ScriptRunner = Pick<Redis, 'eval'>;

/**
 * Redis-backed byte counter that degrades to {@link InMemoryByteBudget} when Redis errors,
 * following the `/auth/*` limiter's SEC-03 fix rather than failing open: a Redis outage must
 * not be the moment the upload route loses its only byte ceiling. The transition each way is
 * logged once (error level, dampened for a flapping connection) and reported once to Sentry on
 * the way down; enforcement itself is never dampened. The fallback's counters are kept across a
 * recovery, so a flapping connection cannot hand a client a clean slate on every flap.
 */
export class RedisByteBudget implements ByteBudget {
  private degraded = false;
  private lastReportedAt = 0;

  constructor(
    private readonly redis: ScriptRunner,
    private readonly fallback: ByteBudget = new InMemoryByteBudget(),
    private readonly now: () => number = Date.now,
  ) {}

  async charge(
    key: string,
    bytes: number,
    limit: number,
    windowSeconds: number,
  ): Promise<ByteBudgetVerdict> {
    try {
      // `eval` answers `unknown[]`; the script's two integers are the only shape it returns.
      const [allowed, ttl] = (await this.redis.eval(
        CHARGE_SCRIPT,
        1,
        key,
        bytes,
        windowSeconds,
        limit,
      )) as [number, number];

      if (this.degraded) {
        this.degraded = false;
        if (this.shouldReport()) {
          logger.error('Upload budget storage recovered: back to Redis-backed counters');
        }
      }
      return {
        allowed: allowed === 1,
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    } catch (error) {
      if (!this.degraded) {
        this.degraded = true;
        if (this.shouldReport()) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(
            'Upload budget storage unavailable: falling back to a per-process in-memory ' +
              `budget until Redis recovers: ${message}`,
          );
          captureServerError(error, { path: 'upload-budget.charge' });
        }
      }
      return this.fallback.charge(key, bytes, limit, windowSeconds);
    }
  }

  /** Claims the report slot for this transition, or says it was claimed too recently. */
  private shouldReport(): boolean {
    const now = this.now();
    if (now - this.lastReportedAt < UPLOAD_BUDGET_REPORT_DAMPEN_MS) {
      return false;
    }
    this.lastReportedAt = now;
    return true;
  }
}

/**
 * The DI-facing byte budget the upload route charges.
 *
 * Picks the store the way `authRateLimitOptions` does: Redis when `REDIS_URL` is set, so the
 * budget is shared across replicas and survives a restart; process memory otherwise, which is
 * the supported single-instance configuration (warned about, because a restart resets it). Jest
 * stays in memory for the auth limiter's reason: many suites in one process tree, and a socket
 * nobody tears down. The client is lazy, so a process that never serves an upload never opens it.
 */
@Injectable()
export class UploadBudgetService implements ByteBudget, OnModuleDestroy {
  private readonly budget: ByteBudget;
  private client: Redis | undefined;

  constructor() {
    const redisUrl = envString('REDIS_URL', '');
    if (isTestEnv()) {
      this.budget = new InMemoryByteBudget();
      return;
    }
    if (redisUrl === '') {
      logger.warn(
        'REDIS_URL unset: upload byte budget counters stay in memory (per instance, lost on restart)',
      );
      this.budget = new InMemoryByteBudget();
      return;
    }
    const redis = new Redis({
      ...parseRedisUrl(redisUrl),
      lazyConnect: true,
      // The charge sits in front of every upload. One retry then reject, so an outage reaches
      // the in-memory fallback instead of parking every upload behind a reconnect loop.
      maxRetriesPerRequest: 1,
    });
    // ioredis emits `error` on every failed reconnect; without a listener the first one is an
    // uncaught exception that takes the API down.
    redis.on('error', (error: Error) => {
      logger.debug(`Upload budget Redis error: ${error.message}`);
    });
    this.client = redis;
    this.budget = new RedisByteBudget(redis);
  }

  charge(
    key: string,
    bytes: number,
    limit: number,
    windowSeconds: number,
  ): Promise<ByteBudgetVerdict> {
    return this.budget.charge(key, bytes, limit, windowSeconds);
  }

  async onModuleDestroy(): Promise<void> {
    const redis = this.client;
    this.client = undefined;
    await redis?.quit().catch(() => undefined);
  }
}
