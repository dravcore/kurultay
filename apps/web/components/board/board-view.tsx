'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TaskDto } from '@kurul/shared-types';
import { authClient } from '@/lib/auth';
import { canMutateColumns, canMutateLabels, canMutateTasks } from '@/lib/board-permissions';
import {
  countActiveFilters,
  hasActiveFilters,
  mergeFiltersIntoSearchParams,
  parseFiltersFromSearchParams,
  type BoardTaskFilters,
} from '@/lib/task-query';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Topbar } from '@/components/layout/topbar';
import { TaskPanel } from '@/components/task/task-panel';
import { buildTaskDndAnnouncements } from '@/components/task/task-dnd-announcements';
import { useBoardTaskDnd } from '@/components/task/use-board-task-dnd';
import { BoardCanvas } from './board-canvas';
import { BoardDialogs } from './board-dialogs';
import { BoardFilters } from './board-filters';
import {
  BoardColumnsEmptyState,
  BoardErrorState,
  BoardFilterEmptyState,
  BoardLoadingState,
} from './board-placeholders';
import { useBoardData } from './use-board-data';
import { useBoardDialogs } from './use-board-dialogs';
import { useBoardMutations } from './use-board-mutations';
import { useBoardRealtime, type BoardDndHandle } from './use-board-realtime';

interface BoardViewProps {
  boardId: string;
  selectedTaskId?: string | null;
}

type TaskPatch = Partial<TaskDto> & Pick<TaskDto, 'id'>;

/**
 * Panel patches carry only the fields that changed, so one for a row the board never loaded
 * is only safe to insert when it happens to be a whole task. `position` is what makes this
 * matter: a row without it sorts as `NaN` and lands anywhere in its column.
 */
function isWholeTask(patch: TaskPatch): patch is TaskDto {
  return (
    typeof patch.title === 'string' &&
    typeof patch.boardId === 'string' &&
    typeof patch.columnId === 'string' &&
    Number.isFinite(patch.position) &&
    Array.isArray(patch.assignees) &&
    Array.isArray(patch.labels)
  );
}

/**
 * Board orchestrator: owns the URL-derived filters and the selected task, and wires the
 * data, realtime, mutation and dialog layers to the canvas.
 */
export function BoardView({ boardId, selectedTaskId = null }: BoardViewProps): React.ReactElement {
  const t = useTranslations('app.board');
  const tTask = useTranslations('app.board.task');
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeId, activeRole } = useWorkspaceContext();
  const dialogs = useBoardDialogs();
  const [entranceDone, setEntranceDone] = useState(false);
  const dndRef = useRef<BoardDndHandle | null>(null);

  const filterKey = searchParams.toString();
  const filters = useMemo(
    () => parseFiltersFromSearchParams(new URLSearchParams(filterKey)),
    [filterKey],
  );
  const filtersActive = hasActiveFilters(filters);

  const {
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
    reload,
    setColumns,
    setTasks,
    setMetaRefreshKey,
  } = useBoardData(boardId, filters, selectedTaskId);

  const canMutateColumnsFlag = canMutateColumns(activeRole);
  const canMutateTasksFlag = canMutateTasks(activeRole);
  const canMutateLabelsFlag = canMutateLabels(activeRole);

  const selectedTask = useMemo(
    () => (selectedTaskId ? (tasks.find((task) => task.id === selectedTaskId) ?? null) : null),
    [selectedTaskId, tasks],
  );

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, TaskDto[]>();
    for (const column of columns) {
      map.set(column.id, []);
    }
    for (const task of tasks) {
      const list = map.get(task.columnId);
      if (list) list.push(task);
      else map.set(task.columnId, [task]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    }
    return map;
  }, [columns, tasks]);

  useEffect(() => {
    if (loading || entranceDone) return;
    const timeout = window.setTimeout(() => setEntranceDone(true), columns.length * 40 + 250);
    return () => window.clearTimeout(timeout);
  }, [loading, entranceDone, columns.length]);

  const applyFilters = useCallback(
    (next: BoardTaskFilters): void => {
      const params = mergeFiltersIntoSearchParams(
        new URLSearchParams(searchParams.toString()),
        next,
      );
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const applyTaskPatch = useCallback(
    (patch: TaskPatch): void => {
      if (!tasksRef.current.some((task) => task.id === patch.id)) {
        // A patch too thin to stand on its own gets refetched instead of guessed at, so the
        // board never holds a task row the API did not hand it whole.
        if (!isWholeTask(patch)) {
          void reload();
          return;
        }
        setTasks((current) =>
          current.some((task) => task.id === patch.id) ? current : [...current, patch],
        );
        return;
      }
      setTasks((current) => {
        const index = current.findIndex((task) => task.id === patch.id);
        if (index < 0) return current;
        const next = [...current];
        next[index] = { ...current[index]!, ...patch };
        return next;
      });
    },
    [reload, setTasks, tasksRef],
  );

  const { commitTaskMove, moveColumn, seedDefaults, defaultsPending } = useBoardMutations({
    boardId,
    columnsRef,
    tasksRef,
    setColumns,
    setTasks,
    reload,
  });

  const dnd = useBoardTaskDnd(tasks, canMutateTasksFlag, commitTaskMove);
  const dndAccessibility = useMemo(
    () => ({
      announcements: buildTaskDndAnnouncements(tasks, columns, tTask),
      screenReaderInstructions: { draggable: tTask('dnd.instructions') },
    }),
    [tasks, columns, tTask],
  );
  useEffect(() => {
    dndRef.current = { cancelDrag: dnd.cancelDrag, isDragging: dnd.isDragging };
  }, [dnd.cancelDrag, dnd.isDragging]);

  const { connected: socketConnected } = useBoardRealtime({
    boardId,
    loading,
    currentUserId,
    selectedTaskId,
    dndRef,
    tasksRef,
    setTasks,
    setColumns,
    setMetaRefreshKey,
    reload,
  });

  if (loading) {
    return <BoardLoadingState />;
  }

  if (error || !board) {
    // A board that is gone or not ours has nothing to try again, so it gets the message and
    // the way out only. Everything else gets `retry`, which re-runs the load *and* clears the
    // error — the old wiring called `reload`, which left this screen up on success.
    return <BoardErrorState message={error} onRetry={unavailable ? undefined : retry} />;
  }

  const panelOpen = selectedTaskId !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Topbar
        title={board.name}
        leading={
          <Button asChild variant="ghost" size="icon-sm" aria-label={t('backToBoards')}>
            <Link href="/dashboard">
              <ArrowLeft />
            </Link>
          </Button>
        }
        actions={
          <div className="flex items-center gap-2">
            {canMutateColumnsFlag ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t('boardMenu')}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={dialogs.openCreateColumn}>
                    <Plus />
                    {t('column.createAction')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        }
      />

      {/*
        The filter bar, and with it the board's two status lines.

        `Reconnecting…` and `Loading the rest of the tasks…` used to sit in the topbar's action
        slot. At 360px that bar is a hamburger, a back arrow, a title and an overflow menu —
        three 44px targets and whatever is left — and a sentence dropped in beside them either
        wrapped inside a fixed-height bar or squeezed the board's name to nothing. Here they
        wrap onto their own line when the row runs out of width and cost the title nothing.

        It is also where `docs/design.md` §5 says they belong: "a quiet inline 'Reconnecting…'
        bar, never a blocking overlay". Same live regions, same wording, one row lower.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
        <BoardFilters filters={filters} members={members} labels={labels} onChange={applyFilters} />
        {!socketConnected ? (
          <span className="text-micro text-muted-foreground max-md:w-full" aria-live="polite">
            {t('realtime.reconnecting')}
          </span>
        ) : null}
        {/* The board paints on the first page; later pages stream in behind it. */}
        {tasksSyncing ? (
          <span className="text-micro text-muted-foreground max-md:w-full" aria-live="polite">
            {t('loadingMore')}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {columns.length === 0 ? (
            <BoardColumnsEmptyState
              canMutateColumns={canMutateColumnsFlag}
              defaultsPending={defaultsPending}
              onCreateColumn={dialogs.openCreateColumn}
              onSeedDefaults={() => void seedDefaults()}
            />
          ) : filtersActive && tasks.length === 0 ? (
            <BoardFilterEmptyState
              activeFilterCount={countActiveFilters(filters)}
              onClearFilters={() => applyFilters({})}
            />
          ) : (
            <BoardCanvas
              boardId={boardId}
              columns={columns}
              tasksByColumn={tasksByColumn}
              selectedTaskId={selectedTaskId}
              canMutateColumns={canMutateColumnsFlag}
              canMutateTasks={canMutateTasksFlag}
              entranceDone={entranceDone}
              dnd={dnd}
              accessibility={dndAccessibility}
              onCreateColumn={dialogs.openCreateColumn}
              onOpenColumnSettings={dialogs.openColumnSettings}
              onDeleteColumn={dialogs.openDeleteColumn}
              onMoveColumn={(column, direction) => void moveColumn(column, direction)}
              onAddTask={dialogs.openCreateTask}
            />
          )}
        </div>

        {panelOpen && activeId ? (
          <TaskPanel
            workspaceId={activeId}
            boardId={boardId}
            task={selectedTask}
            canMutate={canMutateTasksFlag}
            canManageLabels={canMutateLabelsFlag}
            members={members}
            labels={labels}
            loading={panelLoading}
            loadError={panelError}
            onRetryLoad={retryPanelTask}
            metaRefreshKey={metaRefreshKey}
            onUpdated={applyTaskPatch}
            onRequestDelete={() => {
              if (selectedTask) dialogs.openDeleteTask(selectedTask);
            }}
          />
        ) : null}
      </div>

      {activeId ? (
        <BoardDialogs
          dialogs={dialogs}
          workspaceId={activeId}
          boardId={boardId}
          lastColumnId={columns.at(-1)?.id}
          onColumnCreated={(column) => setColumns((current) => [...current, column])}
          onColumnSaved={(column) =>
            setColumns((current) => current.map((item) => (item.id === column.id ? column : item)))
          }
          onColumnDeleted={(columnId) => {
            setColumns((current) => current.filter((item) => item.id !== columnId));
            setTasks((current) => current.filter((task) => task.columnId !== columnId));
          }}
          onTaskCreated={(task) => setTasks((current) => [...current, task])}
          onTaskDeleted={(taskId) => {
            setTasks((current) => current.filter((task) => task.id !== taskId));
            if (selectedTaskId === taskId) {
              router.push(`/board/${boardId}`);
            }
          }}
        />
      ) : null}
    </div>
  );
}
