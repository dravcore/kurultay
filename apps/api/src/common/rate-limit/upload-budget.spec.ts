import { Logger } from '@nestjs/common';
import * as sentry from '../observability/sentry';
import {
  InMemoryByteBudget,
  RedisByteBudget,
  UPLOAD_BUDGET_FALLBACK_MAX_ENTRIES,
  UPLOAD_BUDGET_REPORT_DAMPEN_MS,
  UploadBudgetService,
  type ScriptRunner,
} from './upload-budget';

const evalMock = jest.fn();
const quitMock = jest.fn().mockResolvedValue('OK');

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    eval: (...args: unknown[]) => evalMock(...args) as unknown,
    on: jest.fn(),
    quit: (...args: unknown[]) => quitMock(...args) as unknown,
  })),
}));

/** A clock the tests advance by hand, so "the window lapses" needs no real waiting. */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe('InMemoryByteBudget', () => {
  it('allows charges up to and including the limit within one window', async () => {
    const budget = new InMemoryByteBudget(clock().now);

    await expect(budget.charge('k', 40, 100, 60)).resolves.toMatchObject({ allowed: true });
    await expect(budget.charge('k', 60, 100, 60)).resolves.toMatchObject({ allowed: true });
  });

  it('refuses the charge that crosses the limit and says how long the window has left', async () => {
    const time = clock();
    const budget = new InMemoryByteBudget(time.now);
    await budget.charge('k', 90, 100, 60);
    time.advance(15_000);

    const verdict = await budget.charge('k', 11, 100, 60);

    expect(verdict).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it('starts a fresh window once the previous one has lapsed', async () => {
    const time = clock();
    const budget = new InMemoryByteBudget(time.now);
    await budget.charge('k', 100, 100, 60);
    await expect(budget.charge('k', 1, 100, 60)).resolves.toMatchObject({ allowed: false });

    time.advance(60_000);

    await expect(budget.charge('k', 100, 100, 60)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 60,
    });
  });

  it('counts a refused charge, so the remaining budget cannot be probed for free', async () => {
    const budget = new InMemoryByteBudget(clock().now);
    await budget.charge('k', 50, 100, 60);

    await expect(budget.charge('k', 60, 100, 60)).resolves.toMatchObject({ allowed: false });
    // 110 is already on the counter: even one byte is over now.
    await expect(budget.charge('k', 1, 100, 60)).resolves.toMatchObject({ allowed: false });
  });

  it('keeps one key’s window separate from another’s', async () => {
    const budget = new InMemoryByteBudget(clock().now);
    await budget.charge('a', 100, 100, 60);

    await expect(budget.charge('b', 100, 100, 60)).resolves.toMatchObject({ allowed: true });
  });

  it('refuses a single charge larger than the whole limit', async () => {
    const budget = new InMemoryByteBudget(clock().now);

    await expect(budget.charge('k', 101, 100, 60)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('bounds its memory by evicting an entry once the cap is reached', async () => {
    const time = clock();
    const budget = new InMemoryByteBudget(time.now);
    for (let i = 0; i < UPLOAD_BUDGET_FALLBACK_MAX_ENTRIES; i += 1) {
      await budget.charge(`key-${i}`, 100, 100, 60);
    }

    // The cap is full and every window is live, so the oldest live key gives way.
    await budget.charge('newcomer', 1, 100, 60);

    // `key-1` was not evicted: it is still at its limit. (Checked first: re-charging `key-0`
    // below inserts a key into a full map, which evicts the next-oldest entry in turn.)
    await expect(budget.charge('key-1', 1, 100, 60)).resolves.toMatchObject({ allowed: false });
    // `key-0` was: it starts from scratch and is allowed a full limit again.
    await expect(budget.charge('key-0', 100, 100, 60)).resolves.toMatchObject({ allowed: true });
  });

  it('prefers evicting an expired entry over a live one', async () => {
    const time = clock();
    const budget = new InMemoryByteBudget(time.now);
    await budget.charge('stale', 100, 100, 1);
    time.advance(2_000);
    for (let i = 1; i < UPLOAD_BUDGET_FALLBACK_MAX_ENTRIES; i += 1) {
      await budget.charge(`key-${i}`, 100, 100, 60);
    }

    await budget.charge('newcomer', 1, 100, 60);

    // `key-1`, the oldest live entry, survived because `stale` had already lapsed.
    await expect(budget.charge('key-1', 1, 100, 60)).resolves.toMatchObject({ allowed: false });
  });
});

describe('RedisByteBudget', () => {
  const redis = { eval: jest.fn() } as unknown as ScriptRunner & { eval: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(sentry, 'captureServerError').mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hands the script the key, the bytes, the window and the limit, and reads its verdict', async () => {
    redis.eval.mockResolvedValueOnce([1, 42]);
    const budget = new RedisByteBudget(redis);

    const verdict = await budget.charge('kurul:upload-budget:1.2.3.4', 500, 1000, 60);

    expect(verdict).toEqual({ allowed: true, retryAfterSeconds: 42 });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCRBY'),
      1,
      'kurul:upload-budget:1.2.3.4',
      500,
      60,
      1000,
    );
  });

  it('turns a refusal into Retry-After seconds, falling back to the window when the TTL is unknown', async () => {
    redis.eval.mockResolvedValueOnce([0, 17]).mockResolvedValueOnce([0, -1]);
    const budget = new RedisByteBudget(redis);

    await expect(budget.charge('k', 1, 1, 60)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 17,
    });
    await expect(budget.charge('k', 1, 1, 60)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('degrades to the in-memory counter when Redis errors, instead of allowing everything', async () => {
    redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));
    const budget = new RedisByteBudget(redis, new InMemoryByteBudget(clock().now));

    await expect(budget.charge('k', 80, 100, 60)).resolves.toMatchObject({ allowed: true });
    await expect(budget.charge('k', 30, 100, 60)).resolves.toMatchObject({ allowed: false });
  });

  it('reports the outage once per transition, not once per request', async () => {
    redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));
    const budget = new RedisByteBudget(redis, new InMemoryByteBudget(clock().now));

    await budget.charge('a', 1, 100, 60);
    await budget.charge('b', 1, 100, 60);
    await budget.charge('c', 1, 100, 60);

    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(sentry.captureServerError).toHaveBeenCalledTimes(1);
  });

  it('logs the recovery and goes back to Redis, keeping the fallback counters', async () => {
    const time = clock();
    redis.eval.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([1, 60]);
    const budget = new RedisByteBudget(redis, new InMemoryByteBudget(time.now), time.now);

    await budget.charge('k', 1, 100, 60);
    time.advance(UPLOAD_BUDGET_REPORT_DAMPEN_MS);
    await budget.charge('k', 1, 100, 60);

    expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenLastCalledWith(expect.stringContaining('recovered'));
  });

  it('dampens the reports of a flapping connection to one per window', async () => {
    const time = clock();
    redis.eval
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([1, 60])
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([1, 60]);
    const budget = new RedisByteBudget(redis, new InMemoryByteBudget(time.now), time.now);

    for (let i = 0; i < 4; i += 1) {
      await budget.charge('k', 1, 100, 60);
    }

    // Four transitions inside one dampening window: one report.
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
  });
});

describe('UploadBudgetService', () => {
  const original = {
    redisUrl: process.env.REDIS_URL,
    nodeEnv: process.env.NODE_ENV,
    jestWorker: process.env.JEST_WORKER_ID,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of [
      ['REDIS_URL', original.redisUrl],
      ['NODE_ENV', original.nodeEnv],
      ['JEST_WORKER_ID', original.jestWorker],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('stays in memory under Jest even when REDIS_URL is set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const service = new UploadBudgetService();

    await expect(service.charge('k', 1, 100, 60)).resolves.toMatchObject({ allowed: true });

    expect(evalMock).not.toHaveBeenCalled();
  });

  it('warns and stays in memory when REDIS_URL is unset outside Jest', async () => {
    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    delete process.env.REDIS_URL;
    const service = new UploadBudgetService();

    await expect(service.charge('k', 1, 100, 60)).resolves.toMatchObject({ allowed: true });

    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL unset'));
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('uses Redis when REDIS_URL is set outside Jest, and closes it on module destroy', async () => {
    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    process.env.REDIS_URL = 'redis://localhost:6379/2';
    evalMock.mockResolvedValueOnce([0, 9]);
    const service = new UploadBudgetService();

    await expect(service.charge('k', 1, 100, 60)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 9,
    });
    await service.onModuleDestroy();

    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(quitMock).toHaveBeenCalledTimes(1);
  });
});
