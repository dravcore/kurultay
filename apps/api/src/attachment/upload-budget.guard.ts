import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UPLOAD_BUDGET_ERROR } from '@kurul/shared-types';
import { RATE_LIMIT_WINDOW_SECONDS, rateLimitEnabled } from '../common/rate-limit/rate-limit';
import {
  UPLOAD_BUDGET_ERROR_MESSAGE,
  UPLOAD_BUDGET_KEY_PREFIX,
  UploadBudgetService,
} from '../common/rate-limit/upload-budget';
import { StorageService } from '../storage/storage.service';

/**
 * The bytes a multipart request declares, or `undefined` when it declares nothing usable.
 * A browser always sends `Content-Length` on a multipart body; a hand-rolled chunked upload
 * is the one shape that arrives without it.
 */
function declaredBytes(request: Pick<Request, 'headers'>): number | undefined {
  const header = request.headers['content-length'];
  if (typeof header !== 'string' || header.trim() === '') {
    return undefined;
  }
  const bytes = Number(header);
  return Number.isInteger(bytes) && bytes >= 0 ? bytes : undefined;
}

/**
 * Per-IP byte budget for `POST .../tasks/:taskId/attachments` (SEC-02 follow-up, ADR 0027's
 * 2026-08-21 update).
 *
 * The request throttle on this route counts requests, which `rate-limit.ts` has always called
 * the wrong unit: twenty 25 MiB uploads and twenty 10 kB uploads spend the same allowance. This
 * guard charges bytes instead, `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE` of them per client IP per
 * fixed minute, and it runs as a guard precisely so it is settled before `FileInterceptor` lets
 * multer buffer the body: a refused request costs the API no heap.
 *
 * What is charged is the request's `Content-Length`, read up front; the bytes have not been
 * received yet, and a declared length is the only number available before they are. A
 * multipart request with no `Content-Length` is charged `ATTACHMENT_MAX_BYTES`, the most it
 * could turn out to be, because an undeclared body is exactly the shape a client would choose
 * to dodge a declared-size budget. Only multipart requests are charged at all: a JSON body on
 * this route creates a LINK, which stores no bytes and has nothing for a byte budget to cap.
 *
 * Keyed by `req.ip`, the same trust-proxy-aware address the `ThrottlerGuard` keys on (see
 * `trust-proxy.ts`), so both limiters on the route agree about who the client is. The master
 * switch is the same `RATE_LIMIT_ENABLED` the other limits honour, read once at construction
 * for `throttlerOptions`'s reason; a budget of `0` is the per-variable opt-out.
 */
@Injectable()
export class UploadBudgetGuard implements CanActivate {
  private readonly enabled = rateLimitEnabled();

  constructor(
    private readonly storage: StorageService,
    private readonly budget: UploadBudgetService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = this.storage.uploadBytesPerMinute;
    if (!this.enabled || limit === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('multipart/')) {
      return true;
    }

    const bytes = declaredBytes(request) ?? this.storage.maxBytes;
    const key = `${UPLOAD_BUDGET_KEY_PREFIX}${request.ip ?? 'unknown'}`;
    const verdict = await this.budget.charge(key, bytes, limit, RATE_LIMIT_WINDOW_SECONDS);
    if (verdict.allowed) {
      return true;
    }

    // Set on the response rather than carried in the exception: `AllExceptionsFilter` writes
    // the envelope and knows nothing about headers, which is also how `ThrottlerGuard` hands
    // its own `Retry-After` past the filter.
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(verdict.retryAfterSeconds));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: UPLOAD_BUDGET_ERROR_MESSAGE,
        error: UPLOAD_BUDGET_ERROR,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
