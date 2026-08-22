import { Logger } from '@nestjs/common';
import {
  AUTH_RATE_LIMIT_KEY_PREFIX,
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_REPORT_DAMPEN_MS,
  authRateLimitOptions,
  createRedisRateLimitStorage,
  resetAuthRateLimitFallbackForTesting,
} from './auth-rate-limit';
import * as sentry from '../common/observability/sentry';
import { RATE_LIMIT_WINDOW_SECONDS } from '../common/rate-limit/rate-limit';

const evalMock = jest.fn();
const getMock = jest.fn();
const setMock = jest.fn();

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    eval: (...args: unknown[]) => evalMock(...args) as unknown,
    get: (...args: unknown[]) => getMock(...args) as unknown,
    set: (...args: unknown[]) => setMock(...args) as unknown,
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  })),
}));

describe('authRateLimitOptions', () => {
  const original = {
    enabled: process.env.RATE_LIMIT_ENABLED,
    redisUrl: process.env.REDIS_URL,
    nodeEnv: process.env.NODE_ENV,
    jestWorker: process.env.JEST_WORKER_ID,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // `authRateLimitOptions` refuses to open a socket under Jest, which is exactly what the
    // non-test branches need to be observable — so the test-env markers come off here and are
    // put back in `afterEach`.
    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of [
      ['RATE_LIMIT_ENABLED', original.enabled],
      ['REDIS_URL', original.redisUrl],
      ['NODE_ENV', original.nodeEnv],
      ['JEST_WORKER_ID', original.jestWorker],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('turns Better Auth rate limiting on explicitly, rather than leaving it to the production-only default', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.REDIS_URL;

    expect(authRateLimitOptions()).toEqual({
      enabled: true,
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: AUTH_RATE_LIMIT_MAX,
    });
  });

  it('keeps the counters in Redis when one is configured', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';

    const options = authRateLimitOptions();

    expect(options).toMatchObject({
      enabled: true,
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: AUTH_RATE_LIMIT_MAX,
    });
    // `consume` is the atomic primitive Better Auth prefers; without it the limiter silently
    // degrades to a non-atomic check-then-increment that concurrent requests can slip past.
    expect(typeof options.customStorage?.consume).toBe('function');
  });

  it('never reaches for secondary storage — that would move sessions out of Postgres', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';

    expect(authRateLimitOptions()).not.toHaveProperty('storage');
  });

  it('falls back to the in-memory store, with a warning, when Redis is not configured', () => {
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.REDIS_URL;
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const options = authRateLimitOptions();

    expect(options.customStorage).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL unset'));
  });

  it('follows the same master switch as the Nest throttler', () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    process.env.REDIS_URL = 'redis://localhost:6379';

    const options = authRateLimitOptions();

    expect(options.enabled).toBe(false);
    expect(options.customStorage).toBeUndefined();
  });
});

describe('createRedisRateLimitStorage', () => {
  const storage = createRedisRateLimitStorage('redis://localhost:6379');
  const rule = { window: RATE_LIMIT_WINDOW_SECONDS, max: 5 };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(sentry, 'captureServerError').mockReturnValue(false);
    // Every `describe.each` and every plain `it` below shares the module-level fallback
    // state (`degraded`, the counters map) with every other one — the same reason
    // `createRedisRateLimitStorage` keeps a single Redis `client` module-wide. Reset it
    // before each test so "already reported" and stale counts from a previous test cannot
    // leak into the next one's assertions.
    resetAuthRateLimitFallbackForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetAuthRateLimitFallbackForTesting();
  });

  it('namespaces its keys so they cannot collide with the Socket.io adapter or BullMQ', async () => {
    evalMock.mockResolvedValue([1, -1]);

    await storage.consume?.('127.0.0.1-/sign-in/email', rule);

    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      `${AUTH_RATE_LIMIT_KEY_PREFIX}127.0.0.1-/sign-in/email`,
      rule.window,
      rule.max,
    );
  });

  it('allows a request that lands inside the window', async () => {
    evalMock.mockResolvedValue([1, -1]);

    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  it('reports how long the caller has to wait once the window is full', async () => {
    evalMock.mockResolvedValue([0, 42]);

    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: false,
      retryAfter: 42,
    });
  });

  it('falls back to the whole window when Redis reports no usable TTL', async () => {
    evalMock.mockResolvedValue([0, -1]);

    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: false,
      retryAfter: rule.window,
    });
  });

  it('degrades to an in-memory limit when Redis is unreachable, rather than allowing every request', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // Still allowed: a single request is inside the fallback's own window too.
    await expect(storage.consume?.('key', rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    expect(sentry.captureServerError).toHaveBeenCalledTimes(1);
  });

  it('blocks past the limit under the fallback — an outage no longer means unlimited attempts', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

    for (let i = 0; i < rule.max; i++) {
      await expect(storage.consume?.('flood', rule)).resolves.toMatchObject({ allowed: true });
    }

    await expect(storage.consume?.('flood', rule)).resolves.toMatchObject({
      allowed: false,
      retryAfter: expect.any(Number),
    });
  });

  it('tracks distinct keys separately under the fallback', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

    for (let i = 0; i < rule.max; i++) {
      await storage.consume?.('a', rule);
    }
    // "a" is now at the limit; "b" has never been consumed and must not inherit its count.
    await expect(storage.consume?.('a', rule)).resolves.toMatchObject({ allowed: false });
    await expect(storage.consume?.('b', rule)).resolves.toMatchObject({ allowed: true });
  });

  it("frees a blocked key's fallback window once it expires", async () => {
    jest.useFakeTimers();
    try {
      evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

      for (let i = 0; i < rule.max; i++) {
        await storage.consume?.('expiring', rule);
      }
      await expect(storage.consume?.('expiring', rule)).resolves.toMatchObject({
        allowed: false,
      });

      jest.advanceTimersByTime((rule.window + 1) * 1000);

      await expect(storage.consume?.('expiring', rule)).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps the fallback at a bounded number of distinct keys instead of growing without limit', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    // A single request per key is enough to prove the point at max: 1 — the second request
    // for a still-tracked key is blocked, a fresh one is allowed.
    const capRule = { window: RATE_LIMIT_WINDOW_SECONDS, max: 1 };
    const overCap = 10_001;

    await storage.consume?.('key-0', capRule);
    for (let i = 1; i < overCap; i++) {
      await storage.consume?.(`key-${i}`, capRule);
    }

    // If `key-0` were still tracked, this second request for it would be blocked (count 2 >
    // max 1). It is allowed instead, which is only possible if it was evicted to make room —
    // proof the map did not grow past its cap under `overCap` distinct keys.
    await expect(storage.consume?.('key-0', capRule)).resolves.toMatchObject({ allowed: true });
  }, 30_000);

  it('goes back to Redis once it answers again, and logs the recovery once', async () => {
    jest.useFakeTimers();
    try {
      evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await storage.consume?.('key', rule);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));

      // Past the report-dampening window, so the recovery report is not swallowed by it —
      // that behaviour (a flap producing at most one report) is covered separately below.
      jest.advanceTimersByTime(AUTH_RATE_LIMIT_REPORT_DAMPEN_MS + 1);
      evalMock.mockResolvedValue([1, -1]);
      await expect(storage.consume?.('key', rule)).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
      expect(error).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenLastCalledWith(expect.stringContaining('recovered'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not log or report a repeat outage once already degraded — no per-request spam', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await storage.consume?.('key', rule);
    await storage.consume?.('key', rule);
    await storage.consume?.('key', rule);

    expect(error).toHaveBeenCalledTimes(1);
    expect(sentry.captureServerError).toHaveBeenCalledTimes(1);
  });

  it('dampens a flapping Redis to at most one report within the dampening window', async () => {
    jest.useFakeTimers();
    try {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await storage.consume?.('key', rule);
      expect(error).toHaveBeenCalledTimes(1);
      expect(sentry.captureServerError).toHaveBeenCalledTimes(1);

      // Flap several times in a row, all inside the dampening window: recovered, degraded,
      // recovered, degraded... None of these transitions should add another report.
      for (let i = 0; i < 5; i++) {
        evalMock.mockResolvedValueOnce([1, -1]);
        await storage.consume?.('key', rule);
        evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        await storage.consume?.('key', rule);
      }

      expect(error).toHaveBeenCalledTimes(1);
      expect(sentry.captureServerError).toHaveBeenCalledTimes(1);

      // Once the window has fully elapsed, the next transition is reported again.
      jest.advanceTimersByTime(AUTH_RATE_LIMIT_REPORT_DAMPEN_MS + 1);
      evalMock.mockResolvedValueOnce([1, -1]);
      await storage.consume?.('key', rule);

      expect(error).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenLastCalledWith(expect.stringContaining('recovered'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps fallback counters through a single flap, rather than resetting the floor on every recovery', async () => {
    const floodRule = { window: RATE_LIMIT_WINDOW_SECONDS, max: 2 };

    // Degrades: count 1, allowed.
    evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(storage.consume?.('recur', floodRule)).resolves.toMatchObject({
      allowed: true,
    });

    // Recovers, briefly. If this cleared `fallbackCounters`, the next failure would restart
    // "recur" at count 1 instead of continuing from 1.
    evalMock.mockResolvedValueOnce([1, -1]);
    await expect(storage.consume?.('recur', floodRule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });

    // Flaps back down: count 2, still allowed at max 2 — only possible if the count survived
    // the recovery above instead of being reset to 1.
    evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(storage.consume?.('recur', floodRule)).resolves.toMatchObject({
      allowed: true,
    });

    // Count 3 > max 2: blocked. Proof the floor held across the flap instead of the attacker
    // getting a clean slate on each brief recovery.
    evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(storage.consume?.('recur', floodRule)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('prefers expired entries when evicting, so a key flood cannot free a still-blocked key', async () => {
    jest.useFakeTimers();
    try {
      evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
      // Short window so the attacker's key can cycle through one window refresh — that
      // refresh is what erosion depends on: `Map#set` on an existing key does not move it to
      // the insertion-order tail, so an unfixed fallback leaves the attacker's key looking
      // like the *oldest* entry in the map forever, despite being touched more recently than
      // the still-untouched fillers inserted after it.
      const attackerRule = { window: 1, max: 1 };
      // Long window so these never expire during the test — eviction must fall back to
      // "oldest by position" for every one of them, with nothing expired to prefer instead,
      // which is exactly the condition under which the recency fix (not the
      // prefer-expired-entries fix) is what has to hold.
      const fillerRule = { window: 1_000, max: 1 };
      const fillerCount = 9_000;
      const floodCount = 2_000;

      // t=0: the attacker's key is inserted first — the oldest entry in the map by pure
      // insertion order, before any filler exists.
      await storage.consume?.('attacker', attackerRule);

      // Still t=0: fillers inserted after it, so by insertion order alone they are all
      // *younger* than the attacker's key.
      for (let i = 0; i < fillerCount; i++) {
        await storage.consume?.(`filler-${i}`, fillerRule);
      }

      // t=2s: past the attacker's 1s window, but nowhere near the fillers' 1000s one.
      jest.advanceTimersByTime((attackerRule.window + 1) * 1000);

      // Window refresh: fixed code deletes the stale entry and re-inserts it, moving it past
      // every filler to the tail. Unfixed code overwrites it in place and leaves it at the
      // front, i.e. still "oldest".
      await storage.consume?.('attacker', attackerRule);
      // Immediately blocked again, still inside this (live) refreshed window.
      await expect(storage.consume?.('attacker', attackerRule)).resolves.toMatchObject({
        allowed: false,
      });

      // A flood of brand-new keys — none of them, the fillers, or the attacker's key are
      // expired at this point, so every eviction this triggers must fall back to "oldest by
      // position" exactly like the pre-fix code always did.
      for (let i = 0; i < floodCount; i++) {
        await storage.consume?.(`flood-${i}`, fillerRule);
      }

      // Fixed: the attacker's key was moved off the "oldest" position by its window refresh,
      // so the flood evicted fillers instead — still blocked.
      // Unfixed: the attacker's key never moved, so it was the very first entry evicted —
      // this would come back `allowed: true` on a brand-new window.
      await expect(storage.consume?.('attacker', attackerRule)).resolves.toMatchObject({
        allowed: false,
      });
    } finally {
      jest.useRealTimers();
    }
  }, 30_000);

  it('blocks the very first request when max is 0, mirroring the Redis script (INCR then compare)', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const zeroRule = { window: RATE_LIMIT_WINDOW_SECONDS, max: 0 };

    await expect(storage.consume?.('zero', zeroRule)).resolves.toEqual({
      allowed: false,
      retryAfter: zeroRule.window,
    });
  });

  it('reads back the counter `consume` writes', async () => {
    getMock.mockResolvedValue('7');

    await expect(storage.get('key')).resolves.toMatchObject({ key: 'key', count: 7 });
    expect(getMock).toHaveBeenCalledWith(`${AUTH_RATE_LIMIT_KEY_PREFIX}key`);
  });

  it('reports an unknown key as absent rather than as a zero count', async () => {
    getMock.mockResolvedValue(null);

    await expect(storage.get('key')).resolves.toBeNull();
  });

  it('writes with an expiry, so a counter can never outlive its window', async () => {
    setMock.mockResolvedValue('OK');

    await storage.set('key', { key: 'key', count: 3, lastRequest: Date.now() });

    expect(setMock).toHaveBeenCalledWith(
      `${AUTH_RATE_LIMIT_KEY_PREFIX}key`,
      3,
      'EX',
      RATE_LIMIT_WINDOW_SECONDS,
    );
  });
});
