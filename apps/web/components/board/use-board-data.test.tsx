import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, Priority, type TaskDto, type WorkspaceMemberDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { api, ApiError } from '@/lib/api';
import type { BoardTaskFilters, BoardTaskPage, FetchBoardTasksOptions } from '@/lib/task-query';
import { fetchAllBoardTasks } from '@/lib/task-query';
import { useBoardData } from './use-board-data';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';

// `ApiError` and `apiStatus` stay real: telling a task that is gone from one that could not be
// read is exactly what the hook uses them for, so stubbing them would stub the behaviour away.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn() } };
});

vi.mock('@/lib/task-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/task-query')>();
  return { ...actual, fetchAllBoardTasks: vi.fn() };
});

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => ({ activeId: WORKSPACE_ID }),
}));

const apiGet = vi.mocked(api.get);
const drain = vi.mocked(fetchAllBoardTasks);

function task(id: string): TaskDto {
  return {
    id,
    boardId: BOARD_ID,
    columnId: 'column-1',
    title: id,
    description: null,
    priority: Priority.MEDIUM,
    position: 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    attachmentCount: 0,
  };
}

function member(id: string): WorkspaceMemberDto {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    userId: `user-${id}`,
    role: MemberRole.MEMBER,
    name: `Member ${id}`,
    avatarUrl: null,
  };
}

function metaResponse(path: string): unknown {
  if (path.endsWith('/columns')) {
    return [{ id: 'column-1', boardId: BOARD_ID, name: 'To Do', position: 1 }];
  }
  // The roster is a cursor page; the drain lives in `lib/member-query`.
  if (path.includes('/members')) return { items: [], nextCursor: null, hasMore: false };
  if (path.endsWith('/labels')) return [];
  return { id: BOARD_ID, name: 'Board' };
}

/** Meta endpoints all resolve; only the task drain is interesting here. */
function stubMeta(): void {
  // `api.get` is generic over its response, which a single double cannot satisfy.
  apiGet.mockImplementation((path: string) => Promise.resolve(metaResponse(path)) as never);
}

/** Stable identity: the hook re-runs its load effect whenever `filters` changes. */
const NO_FILTERS: BoardTaskFilters = {};

function renderBoardData(selectedTaskId: string | null = null) {
  return renderHook(() => useBoardData(BOARD_ID, NO_FILTERS, selectedTaskId), {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}

beforeEach(() => {
  apiGet.mockReset();
  drain.mockReset();
  stubMeta();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBoardData task streaming', () => {
  it('paints the board on the first page and appends the rest behind it', async () => {
    let releaseSecondPage = (): void => {};
    const secondPage = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });

    drain.mockImplementation(async (_ws, _board, _filters, options?: FetchBoardTasksOptions) => {
      const first: BoardTaskPage = { items: [task('a')], index: 0, hasMore: true };
      options?.onPage?.(first);
      await secondPage;
      const second: BoardTaskPage = { items: [task('b')], index: 1, hasMore: false };
      options?.onPage?.(second);
      return [...first.items, ...second.items];
    });

    const { result } = renderBoardData();

    // The skeleton is gone once the frame and page 0 are in, not when the drain ends.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks.map((item) => item.id)).toEqual(['a']);
    expect(result.current.tasksSyncing).toBe(true);

    releaseSecondPage();

    await waitFor(() => expect(result.current.tasksSyncing).toBe(false));
    expect(result.current.tasks.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('keeps a locally patched row when a later page lands', async () => {
    let releaseSecondPage = (): void => {};
    const secondPage = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });

    drain.mockImplementation(async (_ws, _board, _filters, options?: FetchBoardTasksOptions) => {
      options?.onPage?.({ items: [task('a')], index: 0, hasMore: true });
      await secondPage;
      // Page 1 repeats `a` (the API re-paged around it) and brings `b`.
      options?.onPage?.({ items: [task('a'), task('b')], index: 1, hasMore: false });
      return [task('a'), task('b')];
    });

    const { result } = renderBoardData();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Stands in for an optimistic drag landing mid-drain.
    act(() => {
      result.current.setTasks((current) =>
        current.map((item) => (item.id === 'a' ? { ...item, position: 42 } : item)),
      );
    });
    await waitFor(() => expect(result.current.tasks[0]?.position).toBe(42));

    releaseSecondPage();

    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    expect(result.current.tasks[0]?.position).toBe(42);
  });

  /**
   * The assignee filter and the assignee picker both filter this list locally, so a roster
   * that stopped at page one would quietly hide the people on page two.
   */
  it('loads the whole roster, not just the first member page', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.includes('/members')) {
        return Promise.resolve(
          path.includes('cursor=cursor-1')
            ? { items: [member('b')], nextCursor: null, hasMore: false }
            : { items: [member('a')], nextCursor: 'cursor-1', hasMore: true },
        ) as never;
      }
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.members).toHaveLength(2));
    expect(result.current.members.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('reports the load error when the drain fails', async () => {
    drain.mockRejectedValue(new Error('network'));

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.error).toBe("The board couldn't load."));
    expect(result.current.loading).toBe(false);
    // A transient failure is worth another go, so the caller keeps its retry control.
    expect(result.current.unavailable).toBe(false);
  });

  /**
   * The error screen used to be a dead end: its button called `reload`, which re-ran the two
   * fetches and never touched `error`, so a retry that *worked* left the failure on screen.
   */
  it('clears the error and paints the board when a retry succeeds', async () => {
    drain.mockRejectedValueOnce(new Error('network'));

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.error).toBe("The board couldn't load."));

    drain.mockImplementation(async (_ws, _board, _filters, options?: FetchBoardTasksOptions) => {
      options?.onPage?.({ items: [task('a')], index: 0, hasMore: false });
      return [task('a')];
    });
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.error).toBeNull());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks.map((item) => item.id)).toEqual(['a']);
    // The frame is re-read too, not just the tasks: a retry takes the *initial* branch.
    expect(result.current.board).not.toBeNull();
    expect(result.current.columns).toHaveLength(1);
  });

  /**
   * The realtime resync path (`reload`) is the socket's heal path: it keeps running behind
   * the error screen (nothing gates it on `error`), so a board that recovers on its own — the
   * API came back before the user clicked anything — must not sit on a dead end once fresher
   * data has actually landed.
   */
  it('clears the error when a realtime resync succeeds', async () => {
    drain.mockRejectedValueOnce(new Error('network'));

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.error).toBe("The board couldn't load."));

    drain.mockImplementation(async (_ws, _board, _filters, options?: FetchBoardTasksOptions) => {
      options?.onPage?.({ items: [task('a')], index: 0, hasMore: false });
      return [task('a')];
    });
    await act(() => result.current.reload());

    expect(result.current.error).toBeNull();
    expect(result.current.unavailable).toBe(false);
  });

  /** A resync that fails must leave an existing error exactly as it was — nothing got fresher. */
  it('leaves the error in place when a realtime resync fails', async () => {
    drain.mockRejectedValueOnce(new Error('network'));

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.error).toBe("The board couldn't load."));

    drain.mockRejectedValueOnce(new Error('still down'));
    await expect(act(() => result.current.reload())).rejects.toThrow();

    expect(result.current.error).toBe("The board couldn't load.");
  });

  /**
   * The first retry succeeding is covered above; a retry can fail again too, and the caller
   * (whose own button stays mounted either way) needs the failure re-reported rather than
   * left stale from the attempt before it.
   */
  it('re-sets the error when a retry fails again', async () => {
    drain.mockRejectedValueOnce(new Error('network'));

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.error).toBe("The board couldn't load."));

    drain.mockRejectedValueOnce(new Error('still down'));
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("The board couldn't load.");
    expect(result.current.unavailable).toBe(false);
  });

  /** 404 and 403 are answers, not outages — retrying re-asks a settled question. */
  it.each([404, 403])('offers no retry when the board answers %i', async (status) => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (/\/boards\/[^/]+$/.test(path)) {
        return Promise.reject(
          new ApiError({ statusCode: status, error: 'Denied', message: 'No board' }),
        ) as never;
      }
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData();

    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBe("This board doesn't exist, or you don't have access to it.");
    expect(result.current.loading).toBe(false);
  });
});

/**
 * The derived-state guard that puts the skeleton back and clears a stale failure the moment
 * the request changes, during render rather than at the top of the load effect (see its own
 * doc comment in the hook). `setUnavailable(false)` is the one line this PR added to it; the
 * rest of the guard was already here and, before this, was not under test at all.
 */
describe('useBoardData request changes while an error is showing', () => {
  it('clears a stale unavailable error and shows the skeleton again for a new board id', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (/\/boards\/[^/]+$/.test(path)) {
        return Promise.reject(
          new ApiError({ statusCode: 404, error: 'Not Found', message: 'No board' }),
        ) as never;
      }
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result, rerender } = renderHook(
      ({ boardId }: { boardId: string }) => useBoardData(boardId, NO_FILTERS, null),
      {
        initialProps: { boardId: BOARD_ID },
        wrapper: ({ children }) => (
          <NextIntlClientProvider locale="en" messages={messages}>
            {children}
          </NextIntlClientProvider>
        ),
      },
    );

    await waitFor(() => expect(result.current.unavailable).toBe(true));

    apiGet.mockReset();
    stubMeta();
    drain.mockResolvedValue([]);
    const OTHER_BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d02';
    rerender({ boardId: OTHER_BOARD_ID });

    // The guard runs synchronously during the render that notices `boardId` changed — before
    // the effect's own fetch for the new board has even started.
    expect(result.current.error).toBeNull();
    expect(result.current.unavailable).toBe(false);
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});

/** A task reached by URL that the board's own pages never brought back — filtered, or deleted. */
describe('useBoardData deep-linked task', () => {
  it('fetches the missing task and adds it to the board', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) return Promise.resolve(task('task-9')) as never;
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData('task-9');

    await waitFor(() => expect(result.current.tasks.map((item) => item.id)).toEqual(['task-9']));
    expect(result.current.panelError).toBeNull();
  });

  /** The lookup must be abortable like every other read here — it used to be the one that was not. */
  it('passes an abort signal with the lookup', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) return new Promise(() => {}) as never;
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { unmount } = renderBoardData('task-9');

    await waitFor(() =>
      expect(apiGet.mock.calls.some((call) => (call[0] as string).endsWith('/tasks/task-9'))).toBe(
        true,
      ),
    );
    const lookup = apiGet.mock.calls.find((call) => (call[0] as string).endsWith('/tasks/task-9'));
    const signal = (lookup?.[1] as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  /**
   * The three answers the panel has to be able to tell apart. Collapsing them is what put
   * "This task no longer exists" on screen while the lookup was still in flight.
   */
  it('holds the panel at loading until the task actually lands on the board', async () => {
    let answer = (): void => {};
    const lookup = new Promise<TaskDto>((resolve) => {
      answer = () => resolve(task('task-9'));
    });
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) return lookup as never;
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData('task-9');

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.panelLoading).toBe(true);
    expect(result.current.panelError).toBeNull();

    await act(async () => {
      answer();
      await lookup;
    });

    await waitFor(() => expect(result.current.panelLoading).toBe(false));
    expect(result.current.tasks.map((item) => item.id)).toEqual(['task-9']);
  });

  it('treats a 404 as gone rather than as something to retry', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) {
        return Promise.reject(
          new ApiError({ statusCode: 404, error: 'Not Found', message: 'Task not found' }),
        ) as never;
      }
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData('task-9');

    await waitFor(() => expect(result.current.panelLoading).toBe(false));
    // No message and no task: the panel renders `missing`, with no retry offered.
    expect(result.current.panelError).toBeNull();
    expect(result.current.tasks).toEqual([]);
  });

  it('reports a failure the server did not explain, and retries it on request', async () => {
    drain.mockResolvedValue([]);
    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) return Promise.reject(new Error('network')) as never;
      return Promise.resolve(metaResponse(path)) as never;
    });

    const { result } = renderBoardData('task-9');

    await waitFor(() => expect(result.current.panelError).toBe("This task couldn't load."));
    expect(result.current.panelLoading).toBe(false);
    expect(result.current.tasks).toEqual([]);

    apiGet.mockImplementation((path: string) => {
      if (path.endsWith('/tasks/task-9')) return Promise.resolve(task('task-9')) as never;
      return Promise.resolve(metaResponse(path)) as never;
    });
    act(() => result.current.retryPanelTask());

    await waitFor(() => expect(result.current.tasks.map((item) => item.id)).toEqual(['task-9']));
    expect(result.current.panelError).toBeNull();
  });

  it('asks for nothing when the board already has the task', async () => {
    drain.mockImplementation(async (_ws, _board, _filters, options?: FetchBoardTasksOptions) => {
      options?.onPage?.({ items: [task('task-9')], index: 0, hasMore: false });
      return [task('task-9')];
    });

    const { result } = renderBoardData('task-9');

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiGet.mock.calls.some((call) => (call[0] as string).endsWith('/tasks/task-9'))).toBe(
      false,
    );
    expect(result.current.panelError).toBeNull();
  });
});
