'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslations } from 'next-intl';
import type {
  BoardDto,
  ColumnDto,
  LabelDto,
  TaskDto,
  WorkspaceMemberDto,
} from '@kurul/shared-types';
import { api, apiStatus } from '@/lib/api';
import { fetchAllWorkspaceMembers } from '@/lib/member-query';
import { fetchAllBoardTasks, type BoardTaskFilters } from '@/lib/task-query';
import { useApiResource } from '@/lib/use-api-resource';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';

export type UseBoardDataResult = {
  board: BoardDto | null;
  columns: ColumnDto[];
  tasks: TaskDto[];
  members: WorkspaceMemberDto[];
  labels: LabelDto[];
  loading: boolean;
  /** True while task pages are still draining behind an already-painted board. */
  tasksSyncing: boolean;
  error: string | null;
  /**
   * The last board load failed with 404/403: the board is not there, or not ours. There is
   * nothing to retry, so the caller must offer a way out instead of a `Try again` button.
   */
  unavailable: boolean;
  /**
   * Runs the initial load again from a failed state: clears the error, puts the skeleton back
   * and re-enters the effect below. Distinct from `reload`, which is the realtime resync path
   * and must keep refreshing a *painted* board silently, without a skeleton — though it clears
   * the same error/unavailable flags on success, so a resync that lands behind a dead-end
   * screen heals it too.
   */
  retry: () => void;
  /** The deep-linked task has not arrived yet — neither on the board nor from its own fetch. */
  panelLoading: boolean;
  /** A retryable failure to read the deep-linked task. `null` when it is simply not there. */
  panelError: string | null;
  retryPanelTask: () => void;
  metaRefreshKey: number;
  columnsRef: React.MutableRefObject<ColumnDto[]>;
  tasksRef: React.MutableRefObject<TaskDto[]>;
  reloadBoardMeta: (signal?: AbortSignal) => Promise<void>;
  reloadTasks: (signal?: AbortSignal) => Promise<void>;
  /** The realtime resync path. Clears `error`/`unavailable` on success; leaves them on failure. */
  reload: (signal?: AbortSignal) => Promise<void>;
  setBoard: Dispatch<SetStateAction<BoardDto | null>>;
  setColumns: Dispatch<SetStateAction<ColumnDto[]>>;
  setTasks: Dispatch<SetStateAction<TaskDto[]>>;
  setMembers: Dispatch<SetStateAction<WorkspaceMemberDto[]>>;
  setLabels: Dispatch<SetStateAction<LabelDto[]>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMetaRefreshKey: Dispatch<SetStateAction<number>>;
};

export function useBoardData(
  boardId: string,
  filters: BoardTaskFilters,
  selectedTaskId: string | null = null,
): UseBoardDataResult {
  const t = useTranslations('app.board');
  const tErrors = useTranslations('app.errors');
  const { activeId } = useWorkspaceContext();

  const [board, setBoard] = useState<BoardDto | null>(null);
  const [columns, setColumns] = useState<ColumnDto[]>([]);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberDto[]>([]);
  const [labels, setLabels] = useState<LabelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksSyncing, setTasksSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [metaRefreshKey, setMetaRefreshKey] = useState(0);
  /** Bumped by `retry`; part of the load effect's deps, which is what re-runs it. */
  const [retryToken, setRetryToken] = useState(0);

  const columnsRef = useRef<ColumnDto[]>([]);
  const tasksRef = useRef<TaskDto[]>([]);
  const loadedBoardIdRef = useRef<string | null>(null);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const reloadBoardMeta = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!activeId) return;
      const [nextBoard, nextColumns, nextMembers, nextLabels] = await Promise.all([
        api.get<BoardDto>(`/workspaces/${activeId}/boards/${boardId}`, { signal }),
        api.get<ColumnDto[]>(`/workspaces/${activeId}/boards/${boardId}/columns`, { signal }),
        fetchAllWorkspaceMembers(activeId, { signal }),
        api.get<LabelDto[]>(`/workspaces/${activeId}/boards/${boardId}/labels`, { signal }),
      ]);
      if (signal?.aborted) return;
      setBoard(nextBoard);
      setColumns(nextColumns);
      setMembers(nextMembers);
      setLabels(nextLabels);
    },
    [activeId, boardId],
  );

  /**
   * Streams the task pages into state instead of waiting for the whole drain: page 0
   * replaces the board (it is the fresh truth the caller asked for), later pages only add
   * the ids they bring. Appending rather than replacing is what keeps an optimistic drag or
   * a realtime patch applied mid-drain from being overwritten by a page that was already
   * in flight when it happened.
   */
  const drainTasks = useCallback(
    async (signal?: AbortSignal, onFirstPage?: () => void): Promise<void> => {
      if (!activeId) return;
      setTasksSyncing(true);
      try {
        await fetchAllBoardTasks(activeId, boardId, filters, {
          init: { signal },
          onPage: ({ items, index }) => {
            if (signal?.aborted) return;
            if (index === 0) {
              setTasks(items);
              onFirstPage?.();
              return;
            }
            setTasks((current) => {
              const known = new Set(current.map((task) => task.id));
              const added = items.filter((task) => !known.has(task.id));
              return added.length > 0 ? [...current, ...added] : current;
            });
          },
        });
      } finally {
        if (!signal?.aborted) setTasksSyncing(false);
      }
    },
    [activeId, boardId, filters],
  );

  const reloadTasks = useCallback(
    (signal?: AbortSignal): Promise<void> => drainTasks(signal),
    [drainTasks],
  );

  /**
   * The realtime resync path: refreshes a board that is already on screen, silently, without
   * the skeleton or the `loadedBoardIdRef` reset `retry` does (see below).
   *
   * A successful resync still doubles as a heal path, though: the socket keeps running behind
   * an error screen (it is wired above the `error` check in `BoardView`), so a board that
   * failed to load and then recovers on its own — the API came back, the join happened to
   * land after all — must not sit on the dead-end screen once fresher data has actually
   * arrived. Clearing `error`/`unavailable` here, after the fetches resolve, is what lets that
   * happen. A *failed* resync must not touch either: the `catch` below never runs on failure,
   * so an existing error is left exactly as it was for the caller (who already swallows the
   * rejection) to ask again later.
   */
  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      await Promise.all([reloadBoardMeta(signal), reloadTasks(signal)]);
      if (signal?.aborted) return;
      setError(null);
      setUnavailable(false);
    },
    [reloadBoardMeta, reloadTasks],
  );

  /**
   * The board load stays on a hand-rolled controller rather than `useApiResource`.
   *
   * The hook models one value arriving once: a single `T`, set when the promise resolves.
   * This load is five values arriving at three different times — the frame (board, columns,
   * members, labels) and the first task page together decide when the skeleton comes down,
   * while the remaining pages keep streaming into the same `tasks` array behind an already
   * painted board. There is no `T` whose single assignment expresses that, and folding the
   * pages into one resolved value would put the skeleton back up until the last page landed,
   * which is the regression this streaming shape exists to avoid.
   */
  /**
   * Put the load status back the moment the request changes, during render rather than at the
   * top of the effect below.
   *
   * The effect used to open with `setLoading(true)` / `setError(null)`, which cost a second
   * render every time the board or the filters changed and left one frame in between showing
   * the *previous* request's error over a board that was already being replaced.
   *
   * The skeleton comes back only for a board that is not on screen: a new board, or a retry
   * after the last attempt at this one failed — which is what `error !== null` says, and is
   * the same condition as the `loadedBoardIdRef` miss the effect used to test. A filter change
   * on a board that did paint keeps it painted while the tasks re-drain behind it.
   */
  const [syncedRequest, setSyncedRequest] = useState({ activeId, boardId, filters });
  if (
    activeId &&
    (syncedRequest.activeId !== activeId ||
      syncedRequest.boardId !== boardId ||
      syncedRequest.filters !== filters)
  ) {
    const isNewBoard = syncedRequest.activeId !== activeId || syncedRequest.boardId !== boardId;
    setSyncedRequest({ activeId, boardId, filters });
    if (isNewBoard || error !== null) setLoading(true);
    setError(null);
    setUnavailable(false);
  }

  /**
   * The way back from the error screen.
   *
   * `reload` clears the same failure on success (see its own doc comment), but deliberately
   * does nothing else here: it is what the realtime resync calls behind a board that is
   * already on screen, where putting the skeleton back on every reconnect would be the
   * regression. So retrying is its own path — clear the failure, put the skeleton back,
   * forget that this board ever loaded (so the effect takes the *initial* branch and re-reads
   * the frame, not just the tasks) and bump the token the effect is keyed on.
   *
   * Returns `void` rather than a promise on purpose: the awaiting happens inside the effect,
   * which already has the catch. A caller wiring this to a button cannot leave a rejection
   * unhandled.
   */
  const retry = useCallback((): void => {
    loadedBoardIdRef.current = null;
    setError(null);
    setUnavailable(false);
    setLoading(true);
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    const isInitial = loadedBoardIdRef.current !== boardId;
    void (async () => {
      const reveal = (): void => {
        if (!controller.signal.aborted) setLoading(false);
      };
      try {
        if (isInitial) {
          let firstPageArrived = (): void => {};
          const firstPage = new Promise<void>((resolve) => {
            firstPageArrived = resolve;
          });
          const metaDone = reloadBoardMeta(controller.signal);
          const tasksDone = drainTasks(controller.signal, firstPageArrived);
          // The frame (columns) plus the first page is enough to paint the board; the
          // remaining pages stream in behind it instead of holding the skeleton up.
          void Promise.all([metaDone, firstPage]).then(reveal, () => {
            // Failure is reported by the await below.
          });
          await Promise.all([metaDone, tasksDone]);
        } else {
          await reloadTasks(controller.signal);
        }
        if (!controller.signal.aborted) {
          loadedBoardIdRef.current = boardId;
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          // 404 and 403 are answers, not outages: the board is gone, or it was never ours.
          // Retrying re-asks a question the server has already settled, so they get their own
          // message and the caller drops the retry control.
          const status = apiStatus(caught);
          const gone = status === 404 || status === 403;
          setUnavailable(gone);
          setError(gone ? t('unavailable') : t('loadError'));
        }
      } finally {
        reveal();
      }
    })();
    return () => controller.abort();
  }, [activeId, boardId, filters, retryToken, drainTasks, reloadBoardMeta, reloadTasks, t]);

  /**
   * A deep-linked task the board never loaded — filtered out, or on a page still draining.
   * `null` once it is on the board, which is also what keeps the panel from re-requesting a
   * row it can already read out of `tasks`.
   */
  // Read from `tasks` rather than `tasksRef`: a ref is invisible to rendering, so the memo
  // below could not see the row arriving and went on handing back a fetcher for a task that
  // was already on the board. Reduced to a boolean first so the memo's identity — which is
  // what decides whether `useApiResource` refetches — does not change with every task page
  // that drains in.
  const hasSelectedTask =
    selectedTaskId !== null && tasks.some((task) => task.id === selectedTaskId);

  const fetchSelectedTask = useMemo(() => {
    if (!activeId || !selectedTaskId || loading || hasSelectedTask) return null;
    return (signal: AbortSignal): Promise<TaskDto> =>
      api.get<TaskDto>(`/workspaces/${activeId}/tasks/${selectedTaskId}`, { signal });
  }, [activeId, selectedTaskId, loading, hasSelectedTask]);

  /**
   * Whether the last failure was the server saying the row is not there.
   *
   * `useApiResource` reports one message per failure, but the panel has to tell a task that is
   * gone (nothing to retry) from a load that broke (worth another go), and only the caught
   * error knows which. Never read while `fetchedTaskError` is `null`, so it does not need
   * clearing on success — the two are written in the same pass.
   */
  const [selectedTaskGone, setSelectedTaskGone] = useState(false);

  // The fetched row is not read back off the resource — `onSuccess` folds it straight into
  // `tasks`, which is the one list the board and the panel both render from.
  const { error: fetchedTaskError, reload: retryPanelTask } = useApiResource<TaskDto | null>(
    fetchSelectedTask,
    null,
    tErrors('taskLoad'),
    {
      onError: (caught) => setSelectedTaskGone(apiStatus(caught) === 404),
      // Folded in as the row arrives rather than from an effect watching the resolved value.
      // The effect version needed a second render to do the merge, and `panelLoading` is keyed
      // on the row being *in* `tasks` — so the frame in between was one where the fetch had
      // succeeded and the panel still said the task was on its way.
      onSuccess: (task) => {
        if (!task) return;
        setTasks((current) =>
          current.some((item) => item.id === task.id) ? current : [...current, task],
        );
      },
    },
  );

  // No request in flight means no failure to report — a task that is already on the board
  // must not inherit the error left over from the last one that was not.
  const panelError = fetchSelectedTask && !selectedTaskGone ? fetchedTaskError : null;

  /**
   * Still on its way. Keyed on the row reaching `tasks` rather than on the hook's own
   * `loading`, so that "arrived" means the same thing here as it does to the panel rendering
   * from `tasks` — one source, not two flags that can disagree for a frame.
   */
  const panelLoading = fetchSelectedTask !== null && fetchedTaskError === null && !hasSelectedTask;

  return {
    board,
    columns,
    tasks,
    members,
    labels,
    loading,
    tasksSyncing,
    error,
    unavailable,
    retry,
    panelLoading,
    panelError,
    retryPanelTask,
    metaRefreshKey,
    columnsRef,
    tasksRef,
    reloadBoardMeta,
    reloadTasks,
    reload,
    setBoard,
    setColumns,
    setTasks,
    setMembers,
    setLabels,
    setLoading,
    setError,
    setMetaRefreshKey,
  };
}
