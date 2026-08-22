import { Controller, INestApplication, Post, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { UPLOAD_BUDGET_ERROR } from '@kurul/shared-types';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { RATE_LIMIT_WINDOW_SECONDS } from '../common/rate-limit/rate-limit';
import {
  InMemoryByteBudget,
  RedisByteBudget,
  UPLOAD_BUDGET_ERROR_MESSAGE,
  UPLOAD_BUDGET_KEY_PREFIX,
  UploadBudgetService,
  type ByteBudget,
  type ScriptRunner,
} from '../common/rate-limit/upload-budget';
import { StorageService } from '../storage/storage.service';
import { UploadBudgetGuard } from './upload-budget.guard';

/**
 * Stands in for `AttachmentController` so the guard can be exercised without Better Auth, the
 * workspace guard or multer. The guard, the filter and the error shape are the production ones;
 * only the handler body is fake. Budget numbers are tiny for the reason the other limiter specs
 * use tiny limits: the production numbers are not small enough to trip in a unit test.
 */
@Controller()
class ProbeController {
  @Post('upload')
  @UseGuards(UploadBudgetGuard)
  upload(): { ok: true } {
    return { ok: true };
  }
}

const BUDGET = 1000;
const MAX_BYTES = 600;

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe('UploadBudgetGuard', () => {
  const originalEnabled = process.env.RATE_LIMIT_ENABLED;
  let app: INestApplication<App>;

  async function createApp(
    budget: ByteBudget,
    storage: { uploadBytesPerMinute: number; maxBytes: number },
  ): Promise<INestApplication<App>> {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        UploadBudgetGuard,
        { provide: StorageService, useValue: storage },
        { provide: UploadBudgetService, useValue: budget },
      ],
    }).compile();

    const created = moduleRef.createNestApplication<App>();
    created.useGlobalFilters(new AllExceptionsFilter());
    await created.init();
    // Bound once so the chunked request below has a port to dial; supertest reuses the listener.
    await created.listen(0, '127.0.0.1');
    return created;
  }

  /**
   * A multipart POST with no `Content-Length` at all. superagent always declares one, so this
   * goes through Node's client directly: a `write` without a declared length is sent chunked.
   */
  function undeclared(): Promise<number> {
    const { port } = app.getHttpServer().address() as AddressInfo;
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/upload',
          headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write('x');
      req.end();
    });
  }

  /** A multipart POST declaring `bytes` in `Content-Length`, without sending a real body. */
  function multipart(bytes: number): request.Test {
    return request(app.getHttpServer())
      .post('/upload')
      .set('Content-Type', 'multipart/form-data; boundary=x')
      .set('Content-Length', String(bytes))
      .send('x'.repeat(bytes));
  }

  afterEach(async () => {
    await app?.close();
    if (originalEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = originalEnabled;
  });

  describe('with rate limiting on', () => {
    let time: ReturnType<typeof clock>;

    beforeEach(async () => {
      delete process.env.RATE_LIMIT_ENABLED;
      time = clock();
      app = await createApp(new InMemoryByteBudget(time.now), {
        uploadBytesPerMinute: BUDGET,
        maxBytes: MAX_BYTES,
      });
    });

    it('lets uploads through while the declared bytes fit in the minute’s budget', async () => {
      await multipart(400).expect(201);
      await multipart(600).expect(201);
    });

    it('answers the upload that would cross the budget with 429 in the documented shape', async () => {
      await multipart(900).expect(201);
      time.advance(20_000);

      const refused = await multipart(200).expect(429);

      // The envelope a client branches on: its own `error`, distinct from the request
      // throttle's "Too Many Requests" (docs/api-conventions.md#errors).
      expect(refused.body).toMatchObject({
        statusCode: 429,
        error: UPLOAD_BUDGET_ERROR,
        message: UPLOAD_BUDGET_ERROR_MESSAGE,
        path: '/upload',
      });
      // The rest of the fixed window, in whole seconds.
      expect(refused.headers['retry-after']).toBe(String(RATE_LIMIT_WINDOW_SECONDS - 20));
    });

    it('opens a fresh budget once the window has lapsed', async () => {
      await multipart(1000).expect(201);
      await multipart(1).expect(429);

      time.advance(RATE_LIMIT_WINDOW_SECONDS * 1000);

      await multipart(1000).expect(201);
    });

    it('charges ATTACHMENT_MAX_BYTES to a multipart request that declares no length', async () => {
      // A body with no Content-Length is the one shape a client would choose to dodge a
      // declared-size budget, so it is charged the most it could turn out to be.
      await expect(undeclared()).resolves.toBe(201);
      // 600 charged; 600 more would make 1200 > 1000.
      await expect(undeclared()).resolves.toBe(429);
    });

    it('does not charge a JSON body, which creates a link and stores no bytes', async () => {
      await multipart(1000).expect(201);

      await request(app.getHttpServer())
        .post('/upload')
        .send({ kind: 'LINK', url: 'https://example.com' })
        .expect(201);
    });

    it('keys the budget by client IP under the limiter’s key prefix', async () => {
      const charge = jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
      await app.close();
      app = await createApp({ charge }, { uploadBytesPerMinute: BUDGET, maxBytes: MAX_BYTES });

      await multipart(10).expect(201);

      expect(charge).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${UPLOAD_BUDGET_KEY_PREFIX}(::ffff:)?127\\.0\\.0\\.1$`)),
        10,
        BUDGET,
        RATE_LIMIT_WINDOW_SECONDS,
      );
    });

    it('keeps enforcing from memory when the Redis store throws', async () => {
      const redis = {
        eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      } as unknown as ScriptRunner;
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await app.close();
      app = await createApp(new RedisByteBudget(redis, new InMemoryByteBudget(time.now)), {
        uploadBytesPerMinute: BUDGET,
        maxBytes: MAX_BYTES,
      });

      await multipart(900).expect(201);
      await multipart(200).expect(429);
      jest.restoreAllMocks();
    });
  });

  describe('switched off', () => {
    it('lets every upload past when RATE_LIMIT_ENABLED=false, like the other limits', async () => {
      process.env.RATE_LIMIT_ENABLED = 'false';
      const charge = jest.fn();
      app = await createApp({ charge }, { uploadBytesPerMinute: BUDGET, maxBytes: MAX_BYTES });

      await multipart(5000).expect(201);
      await multipart(5000).expect(201);

      expect(charge).not.toHaveBeenCalled();
    });

    it('lets every upload past when the budget is 0, the per-variable opt-out', async () => {
      delete process.env.RATE_LIMIT_ENABLED;
      const charge = jest.fn();
      app = await createApp({ charge }, { uploadBytesPerMinute: 0, maxBytes: MAX_BYTES });

      await multipart(5000).expect(201);

      expect(charge).not.toHaveBeenCalled();
    });
  });
});
