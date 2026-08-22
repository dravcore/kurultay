import type { ExecutionContext } from '@nestjs/common';
import { seconds, SkipThrottle, Throttle, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { envBool } from '../env';

/**
 * Every policy in this file is expressed against the same one-minute window, so the numbers
 * below read as "requests per minute" without the reader having to cross-check a TTL.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Ceiling for an ordinary endpoint.
 *
 * `@nestjs/throttler` keys its counters by client IP *and* route handler, so this is 100
 * requests per minute per handler — not a single budget shared across the whole API. It is
 * therefore generous enough that no human-driven session reaches it (the board view issues a
 * handful of reads per interaction) while still capping a scripted loop.
 */
export const DEFAULT_RATE_LIMIT = 100;

/**
 * Creating an invitation sends an email through the SMTP relay configured in `MailModule`,
 * so the endpoint spends someone else's quota and can be aimed at a third party's inbox.
 * It is also admin-only and inherently low-frequency: a person inviting ten teammates a
 * minute is already unusual, and anything beyond that is a script.
 */
export const INVITATION_RATE_LIMIT = 10;

/**
 * `?q=` on the task list runs a trigram search over title/description. It is the most
 * expensive read in the API, and unlike the other filters it cannot be answered from an
 * equality index, so it gets its own ceiling — see `taskListRateLimit`.
 */
export const TASK_SEARCH_RATE_LIMIT = 30;

/**
 * Uploading spends disk rather than someone else's SMTP quota, so it sits above
 * `INVITATION_RATE_LIMIT` — but it is still the one endpoint where a single request can cost
 * `ATTACHMENT_MAX_BYTES`, so it sits well below the default.
 *
 * No ADR carries this number; this constant is its source. ADR 0022 asks for a decorator
 * "modelled on `ThrottleInvitations()`" and stops there. Left off, the global 100/min applies
 * and one IP can spend 25 MiB × 100 = 2.5 GiB of disk a minute.
 *
 * This ceiling is named as insufficient rather than pretended to be enough (ADR 0022): the
 * throttler counts requests per IP per route, which is the wrong unit twice here — twenty
 * 25 MiB uploads and twenty 10 kB uploads spend the same budget, and an office behind one NAT
 * shares a bucket. Since 2026-08-21 the route also carries the unit that was missing: a per-IP
 * byte budget (`ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`, `UploadBudgetGuard`, 256 MiB a minute by
 * default) charged before multer reads the body, and the storage quotas
 * (`ATTACHMENT_WORKSPACE_QUOTA_BYTES` / `ATTACHMENT_INSTANCE_QUOTA_BYTES`, ADR 0027) now have
 * finite defaults, so an unconfigured instance is bounded in total as well as per request. This
 * request count stays as the cheap first brake in front of the session lookup. Overriding
 * `ThrottlerGuard.getTracker` is deliberately not attempted.
 */
export const ATTACHMENT_UPLOAD_RATE_LIMIT = 20;

/**
 * Downloads sit *above* the default, not below it.
 *
 * A task panel with ten image attachments issues ten requests on open, so a user stepping
 * through a few cards would exhaust the 100/min default on a completely ordinary interaction.
 * ADR 0022 asks for this explicitly: the download endpoint gets a limit higher than the default.
 */
export const ATTACHMENT_DOWNLOAD_RATE_LIMIT = 300;

/**
 * A board import is one request that reads up to `TRELLO_IMPORT_MAX_BYTES`, parses it into an
 * object graph several times that size, and then writes thousands of rows inside a single
 * transaction. It costs more than an attachment upload, so it sits *below*
 * `ATTACHMENT_UPLOAD_RATE_LIMIT` rather than beside it.
 *
 * Three per minute is not a security boundary and this constant does not pretend otherwise — the
 * honesty note at :45-50 applies here twice over, because the throttler counts requests and the
 * cost here is measured in rows. What actually bounds it is `TRELLO_IMPORT_MAX_BYTES` plus the
 * admin-only role.
 */
export const IMPORT_RATE_LIMIT = 3;

/** Message returned in the `AllExceptionsFilter` envelope when a limit is hit. */
export const RATE_LIMIT_ERROR_MESSAGE = 'Too many requests. Please try again later.';

/**
 * Master switch, on by default.
 *
 * Exists for one supported use: integration tests drive hundreds of requests per handler
 * from a single loopback address in well under a minute, which is exactly the traffic shape
 * the limits above are meant to stop. `test/setup-e2e.ts` turns them off; nothing else
 * should. Turning this off in a deployment removes the API's only brute-force ceiling.
 */
export function rateLimitEnabled(): boolean {
  return envBool('RATE_LIMIT_ENABLED', true);
}

/** Options for the global `ThrottlerModule` registered in `AppModule`. */
export function throttlerOptions(): ThrottlerModuleOptions {
  // Read once, at module configuration time: `skipIf` runs on every request, and re-parsing
  // the environment there would turn a boot-time configuration error into a per-request one.
  const enabled = rateLimitEnabled();

  return {
    throttlers: [
      {
        name: 'default',
        ttl: seconds(RATE_LIMIT_WINDOW_SECONDS),
        limit: DEFAULT_RATE_LIMIT,
      },
    ],
    errorMessage: RATE_LIMIT_ERROR_MESSAGE,
    skipIf: () => !enabled,
  };
}

/** True when the request actually asks for a trigram search rather than a plain listing. */
function hasSearchTerm(request: Pick<Request, 'query'>): boolean {
  const q: unknown = request.query?.q;
  if (typeof q === 'string') {
    return q.trim() !== '';
  }
  // Express hands back an array when `?q=` is repeated; `TaskQueryDto` rejects that later,
  // but the guard runs first and a repeated key is still an attempt at the expensive path.
  return Array.isArray(q) && q.length > 0;
}

/**
 * Resolves the ceiling for `GET .../tasks`.
 *
 * The board's own paging goes through this same handler, so a flat `TASK_SEARCH_RATE_LIMIT`
 * would punish ordinary browsing for the sake of the search path. `@nestjs/throttler` lets
 * `limit` be a function of the request, so the strict number applies only when `q` is present
 * and everything else keeps the default.
 */
export function taskListRateLimit(context: ExecutionContext): number {
  const request = context.switchToHttp().getRequest<Request>();
  return hasSearchTerm(request) ? TASK_SEARCH_RATE_LIMIT : DEFAULT_RATE_LIMIT;
}

/** Stricter ceiling for `POST /workspaces/:workspaceId/invitations` (sends an email). */
export const ThrottleInvitations = (): MethodDecorator & ClassDecorator =>
  Throttle({
    default: { limit: INVITATION_RATE_LIMIT, ttl: seconds(RATE_LIMIT_WINDOW_SECONDS) },
  });

/** Stricter ceiling for `POST /workspaces/:workspaceId/tasks/:taskId/attachments`. */
export const ThrottleAttachmentUpload = (): MethodDecorator & ClassDecorator =>
  Throttle({
    default: { limit: ATTACHMENT_UPLOAD_RATE_LIMIT, ttl: seconds(RATE_LIMIT_WINDOW_SECONDS) },
  });

/** Stricter ceiling for `POST /workspaces/:workspaceId/imports/trello`. */
export const ThrottleImport = (): MethodDecorator & ClassDecorator =>
  Throttle({
    default: { limit: IMPORT_RATE_LIMIT, ttl: seconds(RATE_LIMIT_WINDOW_SECONDS) },
  });

/** Looser ceiling for the attachment byte stream. */
export const ThrottleAttachmentDownload = (): MethodDecorator & ClassDecorator =>
  Throttle({
    default: { limit: ATTACHMENT_DOWNLOAD_RATE_LIMIT, ttl: seconds(RATE_LIMIT_WINDOW_SECONDS) },
  });

/** Stricter ceiling for the task list, but only when it is used as a search. */
export const ThrottleTaskList = (): MethodDecorator & ClassDecorator =>
  Throttle({
    default: { limit: taskListRateLimit, ttl: seconds(RATE_LIMIT_WINDOW_SECONDS) },
  });

/**
 * Exempts liveness/readiness from throttling.
 *
 * Probes are supposed to be frequent — the Docker healthcheck and any orchestrator poll on a
 * fixed interval — and they all arrive from the same address as every other container on the
 * network. A throttled probe reports the API as unhealthy for a reason that has nothing to do
 * with the API's health, which is the one failure mode a probe must not have.
 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator => SkipThrottle();
