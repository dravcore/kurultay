import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateColumnRequest, UpdateBoardRequest } from '@kurul/shared-types';
import { api, apiFetch, ApiError, apiStatus, resolveApiMessage } from './api';

const t = (key: string): string => `t:${key}`;

function apiError(statusCode: number): ApiError {
  return new ApiError({ statusCode, error: 'Error', message: 'boom' });
}

describe('apiStatus', () => {
  it('reads the status off an ApiError', () => {
    expect(apiStatus(apiError(403))).toBe(403);
  });

  it('is null for a failure that never reached a response', () => {
    expect(apiStatus(new TypeError('network'))).toBeNull();
    expect(apiStatus('nope')).toBeNull();
  });
});

describe('resolveApiMessage', () => {
  it('prefers the key mapped to the status', () => {
    expect(
      resolveApiMessage(apiError(403), t, {
        fallback: 'deleteError',
        byStatus: { 403: 'forbidden' },
      }),
    ).toBe('t:forbidden');
  });

  it('falls back for an unmapped status', () => {
    expect(
      resolveApiMessage(apiError(500), t, {
        fallback: 'deleteError',
        byStatus: { 403: 'forbidden' },
      }),
    ).toBe('t:deleteError');
  });

  it('falls back for a non-ApiError failure', () => {
    expect(
      resolveApiMessage(new TypeError('network'), t, {
        fallback: 'deleteError',
        byStatus: { 403: 'forbidden' },
      }),
    ).toBe('t:deleteError');
  });

  it('works without any status mapping', () => {
    expect(resolveApiMessage(apiError(403), t, { fallback: 'createError' })).toBe('t:createError');
  });

  it('prefers the key mapped to the envelope error over the one mapped to the status', () => {
    // The case this exists for: the upload endpoint answers 413 for the per-file size limit
    // *and* for a storage quota (ADR 0027), so the status alone would always show the size
    // message. `error` is the field api-conventions tells clients to branch on.
    const quota = new ApiError({
      statusCode: 413,
      error: 'Attachment Quota Exceeded',
      message: 'boom',
    });
    expect(
      resolveApiMessage(quota, t, {
        fallback: 'saveError',
        byError: { 'Attachment Quota Exceeded': 'quotaExceeded' },
        byStatus: { 413: 'tooLarge' },
      }),
    ).toBe('t:quotaExceeded');
  });

  it('falls through to the status for an unmapped error string', () => {
    expect(
      resolveApiMessage(apiError(413), t, {
        fallback: 'saveError',
        byError: { 'Attachment Quota Exceeded': 'quotaExceeded' },
        byStatus: { 413: 'tooLarge' },
      }),
    ).toBe('t:tooLarge');
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(body: unknown = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api writes', () => {
  it('serialises a declared request body and defaults the content type', async () => {
    const fetchMock = mockFetch({ id: 'c1' });

    await api.post<{ id: string }, CreateColumnRequest>('/workspaces/w1/boards/b1/columns', {
      name: 'To Do',
    });

    const init = lastInit(fetchMock);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"To Do"}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('sends no body at all for a body-less write', async () => {
    const fetchMock = mockFetch({});

    await api.post('/workspaces/w1/notifications/read-all');

    const init = lastInit(fetchMock);
    expect(init.body).toBeUndefined();
    // Nothing to serialise means nothing to declare a type for either.
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('patches with the declared request body', async () => {
    const fetchMock = mockFetch({ id: 'b1' });

    await api.patch<{ id: string }, UpdateBoardRequest>('/workspaces/w1/boards/b1', {
      description: null,
    });

    const init = lastInit(fetchMock);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{"description":null}');
  });
});

describe('apiFetch content type', () => {
  it('lets the browser write the multipart boundary instead of overwriting it', async () => {
    const fetchMock = mockFetch({});
    const body = new FormData();
    body.append('kind', 'FILE');

    await apiFetch('/x', { method: 'POST', body });

    const init = lastInit(fetchMock);
    expect(new Headers(init.headers).get('Content-Type')).toBeNull();
  });

  it('still sets JSON on an ordinary write', async () => {
    const fetchMock = mockFetch({});

    await api.post<unknown, { a: number }>('/x', { a: 1 });

    const init = lastInit(fetchMock);
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });
});

describe('api.postForm', () => {
  it('sends the FormData body untouched, with no Content-Type set', async () => {
    const fetchMock = mockFetch({ id: 'a1' });
    const body = new FormData();
    body.append('kind', 'FILE');

    await api.postForm('/x', body);

    const init = lastInit(fetchMock);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });
});

describe('api.getBlob', () => {
  it('reads a blob without trying to parse it as JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const blob = await api.getBlob('/x');

    expect(blob).toBeInstanceOf(Blob);
  });

  it('still raises ApiError from the JSON envelope when a blob read fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 404, error: 'Not Found', message: 'x' }), {
        status: 404,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getBlob('/x')).rejects.toBeInstanceOf(ApiError);
  });
});

/**
 * Compile-time half of the contract: these calls are rejected by `tsc --noEmit`, which runs
 * over the test files too. A body that only *looks* right is the failure mode the runtime
 * tests above cannot see — the request still goes out, the server 400s, and nothing said so
 * at build time.
 */
describe('api write typing', () => {
  it('rejects a body whose shape does not match the declared request type', () => {
    const send = async (): Promise<void> => {
      await api.post<{ id: string }, CreateColumnRequest>('/workspaces/w1/boards/b1/columns', {
        // @ts-expect-error `name` is required and `title` is not a CreateColumnRequest field.
        title: 'To Do',
      });
    };
    expect(send).toBeTypeOf('function');
  });

  it('rejects a body passed without naming its request type', () => {
    const send = async (): Promise<void> => {
      // @ts-expect-error the second type argument defaults to `never` — declare it.
      await api.post<{ id: string }>('/workspaces/w1/boards/b1/columns', { name: 'To Do' });
    };
    expect(send).toBeTypeOf('function');
  });

  it('rejects a body when no type argument is given at all', () => {
    const send = async (): Promise<void> => {
      // @ts-expect-error `NoInfer` keeps `TBody` at `never` instead of inferring the literal.
      await api.patch('/workspaces/w1/boards/b1', { name: 'Renamed' });
    };
    expect(send).toBeTypeOf('function');
  });
});
