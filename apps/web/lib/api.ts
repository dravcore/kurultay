import { resolveApiBaseUrl } from './api-url';

/**
 * The base every browser-side request is prefixed with.
 *
 * May be a same-origin path (`/api`, the shipped image's default) or a full origin — see
 * `lib/api-url.ts` for why both shapes exist. Server-side callers must use
 * `getServerApiBaseUrl()` from that module instead: a path has nothing to resolve against
 * inside Node.
 */
export function getApiBaseUrl(): string {
  return resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
}

/** Nest `AllExceptionsFilter` JSON body. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly body: ApiErrorBody;

  constructor(body: ApiErrorBody) {
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    super(message);
    this.name = 'ApiError';
    this.statusCode = body.statusCode;
    this.body = body;
  }
}

/** The HTTP status behind a failure, or `null` when it never reached one (network, abort). */
export function apiStatus(caught: unknown): number | null {
  return caught instanceof ApiError ? caught.statusCode : null;
}

/** The failure Better Auth's client returns as a value instead of throwing. */
export interface AuthClientErrorBody {
  /** Better Auth's machine-readable reason, e.g. `EMAIL_ALREADY_VERIFIED`. */
  code?: string;
  message?: string;
  status: number;
  statusText: string;
}

/**
 * Lifts a Better Auth client failure into the `ApiError` the rest of the app catches.
 *
 * Better Auth answers `{ data, error }` rather than throwing, so a screen that calls both it
 * and `api.*` would otherwise need two error paths side by side — and `apiStatus`,
 * `resolveApiMessage` and `useApiResource` would work on only one of them. The code goes into
 * `error` because that is the field callers are told to branch on
 * (`docs/api-conventions.md#errors`), never the message.
 */
export function authClientError(body: AuthClientErrorBody): ApiError {
  return new ApiError({
    statusCode: body.status,
    error: body.code ?? body.statusText,
    message: body.message ?? body.statusText,
  });
}

/**
 * The slice of a next-intl translator this module needs — narrowed to a plain function so
 * the mapping stays testable without standing up an intl provider.
 */
export type ApiMessageTranslator = (key: string) => string;

/** Translation keys explaining one failed request, keyed by the status that produced it. */
export interface ApiMessageKeys {
  /** Used when no status matches — including a network error, which carries no status. */
  fallback: string;
  /** HTTP status → translation key, e.g. `{ 403: 'forbidden' }`. */
  byStatus?: Readonly<Partial<Record<number, string>>>;
  /**
   * Envelope `error` string → translation key, checked before `byStatus`.
   *
   * For the failures a status alone cannot name: the upload endpoint answers 413 for both the
   * per-file size limit and a storage quota (ADR 0027), and `error` is the field
   * `docs/api-conventions.md#errors` tells clients to branch on. Keys here should come from
   * `@kurul/shared-types` constants, never be retyped strings.
   */
  byError?: Readonly<Partial<Record<string, string>>>;
}

/**
 * Turns a caught request failure into the message shown to the user.
 *
 * Every screen was re-deriving the same thing from `caught instanceof ApiError &&
 * caught.statusCode === 403`, which is how a permission failure ends up reported as a
 * generic "could not save" on the one screen that forgot the check. Keys are resolved
 * relative to whatever namespace `t` was created for.
 *
 * Callers that need more than wording out of the status — closing a panel on 404, offering
 * a retry only for unexplained failures — should branch on {@link apiStatus} instead.
 */
export function resolveApiMessage(
  caught: unknown,
  t: ApiMessageTranslator,
  keys: ApiMessageKeys,
): string {
  const status = apiStatus(caught);
  const code = caught instanceof ApiError ? caught.body.error : null;
  const key =
    (code === null ? undefined : keys.byError?.[code]) ??
    (status === null ? undefined : keys.byStatus?.[status]) ??
    keys.fallback;
  return t(key);
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = {
      statusCode: response.status,
      error: response.statusText || 'Error',
      message: `Request failed with status ${response.status}`,
    };
  }
  return new ApiError({
    statusCode: body.statusCode ?? response.status,
    error: body.error ?? 'Error',
    message: body.message ?? `Request failed with status ${response.status}`,
  });
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  // `FormData` is the one body shape whose Content-Type the browser has to write itself: the
  // header carries a boundary token generated with the body, and setting the bare media type
  // here produces a request no multipart parser can read. Everything else keeps the JSON
  // default it has always had.
  const writesOwnContentType = init?.body instanceof FormData;
  if (init?.body !== undefined && !writesOwnContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * Typed Nest API client used by the web app.
 *
 * Writes take the request type as a second explicit type argument
 * (`api.post<ColumnDto, CreateColumnRequest>(path, body)`). It defaults to `never` rather
 * than being inferred from `body`, which is the whole point: an inferred body type accepts
 * whatever it is handed, so the `@kurul/shared-types` request shapes were documentation
 * that the compiler never read. With `never` as the default, a call that passes a body
 * without naming its type does not compile at all, and one that names it is checked against
 * the DTO the endpoint actually validates.
 *
 * `NoInfer` is what keeps the default reachable — without it, omitting both type arguments
 * would let `body` re-open the hole it closes. A body-less write (`POST .../read-all`) still
 * works unchanged, because `body` stays optional.
 */
export const api = {
  get<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
    return request<TResponse>(path, { ...init, method: 'GET' });
  },
  post<TResponse, TBody = never>(
    path: string,
    body?: NoInfer<TBody>,
    init?: RequestInit,
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      ...init,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<TResponse, TBody = never>(
    path: string,
    body?: NoInfer<TBody>,
    init?: RequestInit,
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      ...init,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<TResponse = void>(path: string, init?: RequestInit): Promise<TResponse> {
    return request<TResponse>(path, { ...init, method: 'DELETE' });
  },

  /**
   * A multipart write, for the one endpoint that takes a file.
   *
   * Separate from `post` rather than a branch inside it: `post`'s body is typed `NoInfer<TBody>`
   * against the shared request DTOs precisely so an untyped object cannot slip through, and a
   * `FormData` has no such contract to check. Two members keep that guarantee intact for every
   * other call site.
   */
  postForm<TResponse>(path: string, body: FormData, init?: RequestInit): Promise<TResponse> {
    return request<TResponse>(path, { ...init, method: 'POST', body });
  },

  /**
   * Reads a response as bytes.
   *
   * `request` cannot serve this: it ends in `response.json()`, which is right for every endpoint
   * that existed before attachments and wrong for the one that does not answer with JSON. The
   * failure path stays shared — a non-2xx is still parsed by `parseError`, so an attachment that
   * 404s raises the same `ApiError` every other call does.
   */
  async getBlob(path: string, init?: RequestInit): Promise<Blob> {
    const response = await apiFetch(path, { ...init, method: 'GET' });
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },
};
