import type { Dispatch, SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import {
  ColumnCategory,
  MemberRole,
  Priority,
  type BoardDto,
  type ColumnDto,
  type LabelDto,
  type TaskDto,
  type WorkspaceMemberDto,
} from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { BoardView } from './board-view';
import { useBoardData, type UseBoardDataResult } from './use-board-data';
import { useBoardRealtime } from './use-board-realtime';
import { BoardCanvas } from './board-canvas';
import { BoardDialogs } from './board-dialogs';
import { TaskPanel } from '@/components/task/task-panel';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

const push = vi.fn();
const replace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => `/board/${BOARD_ID}`,
  useSearchParams: () => currentSearchParams,
}));

vi.mock('@/lib/auth', () => ({
  authClient: { useSession: () => ({ data: null }) },
}));

const workspaceState: { activeId: string | null; activeRole: MemberRole | null } = {
  activeId: WORKSPACE_ID,
  activeRole: MemberRole.MEMBER,
};
vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspaceContext: () => workspaceState,
}));

// This file's contract is the loading/error screen and the loaded frame's wiring — the
// socket and the mutation hook are stubbed so a test does not have to stand up a fake socket
// or an `api` double to reach either.
vi.mock('./use-board-realtime', () => ({ useBoardRealtime: vi.fn() }));

const mutations = {
  commitTaskMove: vi.fn(),
  moveColumn: vi.fn(),
  seedDefaults: vi.fn(),
  defaultsPending: false,
};
vi.mock('./use-board-mutations', () => ({
  useBoardMutations: () => mutations,
}));

vi.mock('./use-board-data', () => ({ useBoardData: vi.fn() }));
// `BoardCanvas`, `BoardDialogs` and `TaskPanel` are each their own tested surface (or, for
// `BoardCanvas`, drag-and-drop machinery this file has no business standing up). Stubbing them
// keeps this file about what `BoardView` itself decides — which state to show, and what it
// wires to which callback — captured through the props each stub was last called with.
vi.mock('./board-canvas', () => ({ BoardCanvas: vi.fn() }));
vi.mock('./board-dialogs', () => ({ BoardDialogs: vi.fn() }));
vi.mock('@/components/task/task-panel', () => ({ TaskPanel: vi.fn() }));

const mockedUseBoardData = vi.mocked(useBoardData);
const mockedUseBoardRealtime = vi.mocked(useBoardRealtime);
const mockedBoardCanvas = vi.mocked(BoardCanvas);
const mockedBoardDialogs = vi.mocked(BoardDialogs);
const mockedTaskPanel = vi.mocked(TaskPanel);

mockedBoardCanvas.mockImplementation(() => <div data-testid="board-canvas" />);
mockedBoardDialogs.mockImplementation(() => <div data-testid="board-dialogs" />);
mockedTaskPanel.mockImplementation(() => <div data-testid="task-panel" />);
mockedUseBoardRealtime.mockReturnValue({ connected: true });

function lastBoardCanvasProps(): Parameters<typeof BoardCanvas>[0] {
  const call = mockedBoardCanvas.mock.calls.at(-1);
  if (!call) throw new Error('BoardCanvas was not rendered');
  return call[0];
}

function lastBoardDialogsProps(): Parameters<typeof BoardDialogs>[0] {
  const call = mockedBoardDialogs.mock.calls.at(-1);
  if (!call) throw new Error('BoardDialogs was not rendered');
  return call[0];
}

function lastTaskPanelProps(): Parameters<typeof TaskPanel>[0] {
  const call = mockedTaskPanel.mock.calls.at(-1);
  if (!call) throw new Error('TaskPanel was not rendered');
  return call[0];
}

/** Every `setColumns`/`setTasks` call this file triggers passes an updater, never a raw value. */
function asUpdater<T>(action: SetStateAction<T> | undefined): (current: T) => T {
  if (typeof action !== 'function') throw new Error('expected a functional state update');
  return action as (current: T) => T;
}

/**
 * `renderBoard`/`renderLoadedBoard` hand back `UseBoardDataResult`, so a field read off that
 * return value is typed as the plain `Dispatch` the interface declares — the mock underneath
 * is still there at runtime, `vi.mocked` just regains the type needed to reach `.mock.calls`.
 */
function calls<T>(fn: Dispatch<SetStateAction<T>>): SetStateAction<T>[] {
  return vi.mocked(fn).mock.calls.map((call) => call[0]);
}

function boardDto(overrides: Partial<BoardDto> = {}): BoardDto {
  return {
    id: BOARD_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Launch board',
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function column(id: string, position: number): ColumnDto {
  return {
    id,
    boardId: BOARD_ID,
    name: `Column ${id}`,
    position,
    color: null,
    category: ColumnCategory.UNSTARTED,
    taskCount: 0,
  };
}

function task(id: string, columnId: string, position: number): TaskDto {
  return {
    id,
    boardId: BOARD_ID,
    columnId,
    title: id,
    description: null,
    priority: Priority.MEDIUM,
    position,
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

interface LoadedFixture {
  board: BoardDto;
  columns: ColumnDto[];
  tasks: TaskDto[];
  members: WorkspaceMemberDto[];
  labels: LabelDto[];
}

/**
 * A board with two columns and four tasks: two share a column (so the `tasksByColumn` sort
 * comparator actually runs), and one sits in a column id that is not among `columns` (so the
 * "task arrived before its column did" branch runs too).
 */
function loadedFixture(): LoadedFixture {
  return {
    board: boardDto(),
    columns: [column('col-1', 1), column('col-2', 2)],
    tasks: [
      task('task-a', 'col-1', 2000),
      task('task-b', 'col-1', 1000),
      task('task-c', 'col-2', 1000),
      task('task-orphan', 'col-missing', 500),
    ],
    members: [],
    labels: [],
  };
}

function baseResult(overrides: Partial<UseBoardDataResult>): UseBoardDataResult {
  return {
    board: null,
    columns: [],
    tasks: [],
    members: [],
    labels: [],
    loading: false,
    tasksSyncing: false,
    error: null,
    unavailable: false,
    retry: vi.fn(),
    panelLoading: false,
    panelError: null,
    retryPanelTask: vi.fn(),
    metaRefreshKey: 0,
    columnsRef: { current: [] },
    tasksRef: { current: [] },
    reloadBoardMeta: vi.fn(),
    reloadTasks: vi.fn(),
    reload: vi.fn(),
    setBoard: vi.fn(),
    setColumns: vi.fn(),
    setTasks: vi.fn(),
    setMembers: vi.fn(),
    setLabels: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    setMetaRefreshKey: vi.fn(),
    ...overrides,
  };
}

function renderBoard(
  overrides: Partial<UseBoardDataResult>,
  selectedTaskId: string | null = null,
): UseBoardDataResult & ReturnType<typeof render> {
  const data = baseResult(overrides);
  mockedUseBoardData.mockReturnValue(data);
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BoardView boardId={BOARD_ID} selectedTaskId={selectedTaskId} />
    </NextIntlClientProvider>,
  );
  return { ...data, ...view };
}

/** A loaded board whose `tasksRef` mirrors `tasks` — what the real hook keeps in sync. */
function renderLoadedBoard(
  fixture: LoadedFixture,
  overrides: Partial<UseBoardDataResult> = {},
  selectedTaskId: string | null = null,
): UseBoardDataResult & ReturnType<typeof render> {
  return renderBoard(
    { ...fixture, tasksRef: { current: fixture.tasks }, ...overrides },
    selectedTaskId,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentSearchParams = new URLSearchParams();
  workspaceState.activeId = WORKSPACE_ID;
  workspaceState.activeRole = MemberRole.MEMBER;
  mockedUseBoardRealtime.mockReturnValue({ connected: true });
});

/**
 * Pins the contract the hook and the placeholder only enforce separately: 404/403 leaves the
 * user on the not-found copy with no dead-end button, everything else gets a way to try again.
 * Nothing rendered `BoardView` under test before this — the wiring from `unavailable` to a
 * missing retry control was covered by the hook's own state and a typecheck only.
 */
describe('BoardView load-error contract', () => {
  it('omits Try again and shows the not-found copy for a 404/403 load', () => {
    renderBoard({
      error: "This board doesn't exist, or you don't have access to it.",
      unavailable: true,
    });

    expect(
      screen.getByText("This board doesn't exist, or you don't have access to it."),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to boards' })).toBeDefined();
  });

  it('offers Try again for a transient load failure', () => {
    renderBoard({ error: "The board couldn't load.", unavailable: false });

    expect(screen.getByText("The board couldn't load.")).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('calls retry, not reload, when Try again is clicked', () => {
    const data = renderBoard({ error: "The board couldn't load.", unavailable: false });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(data.retry).toHaveBeenCalledTimes(1);
    expect(data.reload).not.toHaveBeenCalled();
  });
});

describe('BoardView loading state', () => {
  it('shows the topbar and column skeletons before the board settles', () => {
    const { container } = renderBoard({ loading: true });

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
  });
});

describe('BoardView loaded frame', () => {
  it('renders the board title and forwards columns and tasks to the canvas', () => {
    const fixture = loadedFixture();
    renderLoadedBoard(fixture);

    expect(screen.getByText('Launch board')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Back to boards' })).toBeDefined();
    expect(screen.getByTestId('board-canvas')).toBeDefined();

    const canvasProps = lastBoardCanvasProps();
    expect(canvasProps.columns).toHaveLength(2);
    expect(canvasProps.tasksByColumn.get('col-1')).toHaveLength(2);
    // Sorted by position: task-b (1000) before task-a (2000).
    expect(canvasProps.tasksByColumn.get('col-1')?.map((entry) => entry.id)).toEqual([
      'task-b',
      'task-a',
    ]);
    // A task whose column never arrived still gets its own bucket.
    expect(canvasProps.tasksByColumn.get('col-missing')).toHaveLength(1);
  });

  it('shows the reconnecting banner when the realtime socket is disconnected', () => {
    mockedUseBoardRealtime.mockReturnValue({ connected: false });

    renderLoadedBoard(loadedFixture());

    expect(screen.getByText('Reconnecting…')).toBeDefined();
  });

  it('omits the reconnecting banner once the socket is back', () => {
    renderLoadedBoard(loadedFixture());

    expect(screen.queryByText('Reconnecting…')).toBeNull();
  });

  it('shows the loading-more banner while later task pages are still streaming in', () => {
    renderLoadedBoard(loadedFixture(), { tasksSyncing: true });

    expect(screen.getByText('Loading the rest of the tasks…')).toBeDefined();
  });

  it('omits the board menu for a role that cannot manage columns', () => {
    renderLoadedBoard(loadedFixture());

    expect(screen.queryByRole('button', { name: 'Board actions' })).toBeNull();
  });

  it('shows the board menu for a role that can manage columns', () => {
    workspaceState.activeRole = MemberRole.ADMIN;

    renderLoadedBoard(loadedFixture());

    expect(screen.getByRole('button', { name: 'Board actions' })).toBeDefined();
  });
});

describe('BoardView empty states', () => {
  it('lets a role that can manage columns create one or seed the defaults', () => {
    workspaceState.activeRole = MemberRole.ADMIN;
    const fixture = loadedFixture();

    renderLoadedBoard({ ...fixture, columns: [], tasks: [] });

    expect(screen.getByText('This board has no columns')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Use default columns' }));
    expect(mutations.seedDefaults).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    expect(lastBoardDialogsProps().dialogs.createColumnOpen).toBe(true);
  });

  it('shows the forbidden copy instead of create controls for a role that cannot', () => {
    const fixture = loadedFixture();

    renderLoadedBoard({ ...fixture, columns: [], tasks: [] });

    expect(
      screen.getByText('You need admin access to change columns. Ask a workspace owner.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
  });

  it('shows the filter empty state when active filters match no tasks, and can clear them', () => {
    currentSearchParams = new URLSearchParams('q=urgent');
    const fixture = loadedFixture();

    renderLoadedBoard({ ...fixture, tasks: [] });

    const emptyState = screen.getByText('No tasks match these filters').closest('div');
    if (!emptyState) throw new Error('empty state container not found');
    expect(screen.queryByTestId('board-canvas')).toBeNull();

    // The active-filters chip bar renders its own "Clear filters" control; this one is the
    // empty state's, so the query is scoped to it rather than picking either match.
    const clearButton = screen
      .getAllByRole('button', { name: 'Clear filters' })
      .find((button) => emptyState.contains(button));
    if (!clearButton) throw new Error('empty state Clear filters button not found');
    fireEvent.click(clearButton);

    expect(replace).toHaveBeenCalledWith(`/board/${BOARD_ID}`, { scroll: false });
  });
});

describe('BoardView task panel', () => {
  it('opens the panel for the selected task and passes it through', () => {
    const fixture = loadedFixture();

    renderLoadedBoard(fixture, {}, 'task-a');

    expect(screen.getByTestId('task-panel')).toBeDefined();
    expect(lastTaskPanelProps().task?.id).toBe('task-a');
  });

  it('omits the panel when no task is selected', () => {
    renderLoadedBoard(loadedFixture());

    expect(screen.queryByTestId('task-panel')).toBeNull();
  });

  it('omits the panel and the dialogs without an active workspace', () => {
    workspaceState.activeId = null;

    renderLoadedBoard(loadedFixture(), {}, 'task-a');

    expect(screen.queryByTestId('task-panel')).toBeNull();
    expect(screen.queryByTestId('board-dialogs')).toBeNull();
  });

  it('replaces a task already on the board when the panel reports a whole update', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture, {}, 'task-a');

    const patched = { ...task('task-a', 'col-1', 2000), title: 'Renamed' };
    act(() => lastTaskPanelProps().onUpdated(patched));

    const updater = asUpdater(calls(data.setTasks)[0]);
    const next = updater(fixture.tasks);
    expect(next.find((entry) => entry.id === 'task-a')?.title).toBe('Renamed');
    expect(next).toHaveLength(fixture.tasks.length);
  });

  it('leaves the array alone when the updater can no longer find the patched task', () => {
    // Defensive branch: `tasksRef` said the task was there, but the array this updater is
    // handed at commit time no longer has it.
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture, {}, 'task-a');

    act(() => lastTaskPanelProps().onUpdated({ ...task('task-a', 'col-1', 2000), title: 'X' }));

    const updater = asUpdater(calls(data.setTasks)[0]);
    const withoutIt = fixture.tasks.filter((entry) => entry.id !== 'task-a');
    expect(updater(withoutIt)).toBe(withoutIt);
  });

  it('appends a brand-new whole task the board never loaded', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture, {}, 'task-a');
    const brandNew = task('task-new', 'col-1', 3000);

    act(() => lastTaskPanelProps().onUpdated(brandNew));

    const updater = asUpdater(calls(data.setTasks)[0]);
    const next = updater(fixture.tasks);
    expect(next).toHaveLength(fixture.tasks.length + 1);
    expect(next.at(-1)?.id).toBe('task-new');
  });

  it('does not duplicate a whole task the array already grew to include', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture, {}, 'task-a');
    const brandNew = task('task-new', 'col-1', 3000);

    act(() => lastTaskPanelProps().onUpdated(brandNew));

    const updater = asUpdater(calls(data.setTasks)[0]);
    const already = [...fixture.tasks, brandNew];
    expect(updater(already)).toBe(already);
  });

  it('reloads instead of guessing when a thin patch names a task the board never loaded', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture, {}, 'task-a');

    act(() => lastTaskPanelProps().onUpdated({ id: 'task-unknown', title: 'Not enough' }));

    expect(data.reload).toHaveBeenCalledTimes(1);
    expect(data.setTasks).not.toHaveBeenCalled();
  });

  it('opens the delete-task dialog for the selected task from the panel', () => {
    const fixture = loadedFixture();
    renderLoadedBoard(fixture, {}, 'task-a');

    act(() => lastTaskPanelProps().onRequestDelete());

    expect(lastBoardDialogsProps().dialogs.deleteTask?.id).toBe('task-a');
  });
});

describe('BoardView dialog wiring', () => {
  it('passes the last column id so a new column appends after it', () => {
    const fixture = loadedFixture();
    renderLoadedBoard(fixture);

    expect(lastBoardDialogsProps().lastColumnId).toBe('col-2');
  });

  it('appends a column created from the dialog', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture);

    act(() => lastBoardDialogsProps().onColumnCreated(column('col-new', 3)));

    const updater = asUpdater(calls(data.setColumns)[0]);
    expect(updater(fixture.columns)).toHaveLength(3);
  });

  it('replaces a saved column in place', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture);
    const saved = { ...column('col-1', 1), name: 'Renamed column' };

    act(() => lastBoardDialogsProps().onColumnSaved(saved));

    const updater = asUpdater(calls(data.setColumns)[0]);
    const next = updater(fixture.columns);
    expect(next.find((entry) => entry.id === 'col-1')?.name).toBe('Renamed column');
  });

  it('drops a deleted column and its tasks together', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture);

    act(() => lastBoardDialogsProps().onColumnDeleted('col-1'));

    const columnsUpdater = asUpdater(calls(data.setColumns)[0]);
    expect(columnsUpdater(fixture.columns)).toHaveLength(1);

    const tasksUpdater = asUpdater(calls(data.setTasks)[0]);
    expect(tasksUpdater(fixture.tasks).every((entry) => entry.columnId !== 'col-1')).toBe(true);
  });

  it('appends a task created from the dialog', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture);

    act(() => lastBoardDialogsProps().onTaskCreated(task('task-new', 'col-1', 5000)));

    const updater = asUpdater(calls(data.setTasks)[0]);
    expect(updater(fixture.tasks)).toHaveLength(fixture.tasks.length + 1);
  });

  it('drops the deleted task and returns to the board when it was the selected one', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture, {}, 'task-a');

    act(() => lastBoardDialogsProps().onTaskDeleted('task-a'));

    const updater = asUpdater(calls(data.setTasks)[0]);
    expect(updater(fixture.tasks).some((entry) => entry.id === 'task-a')).toBe(false);
    expect(push).toHaveBeenCalledWith(`/board/${BOARD_ID}`);
  });

  it('drops a deleted task without navigating when it was not the selected one', () => {
    const fixture = loadedFixture();
    const data = renderLoadedBoard(fixture, {}, 'task-a');

    act(() => lastBoardDialogsProps().onTaskDeleted('task-b'));

    const updater = asUpdater(calls(data.setTasks)[0]);
    expect(updater(fixture.tasks).some((entry) => entry.id === 'task-b')).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('BoardView canvas wiring', () => {
  it('forwards column actions from the canvas to the dialogs controller', () => {
    workspaceState.activeRole = MemberRole.ADMIN;
    const fixture = loadedFixture();
    renderLoadedBoard(fixture);

    act(() => lastBoardCanvasProps().onOpenColumnSettings(fixture.columns[0]!));
    expect(lastBoardDialogsProps().dialogs.columnSettings?.id).toBe('col-1');

    act(() => lastBoardCanvasProps().onDeleteColumn(fixture.columns[1]!));
    expect(lastBoardDialogsProps().dialogs.deleteColumn?.id).toBe('col-2');

    act(() => lastBoardCanvasProps().onAddTask('col-1'));
    expect(lastBoardDialogsProps().dialogs.createTaskColumnId).toBe('col-1');

    act(() => lastBoardCanvasProps().onCreateColumn());
    expect(lastBoardDialogsProps().dialogs.createColumnOpen).toBe(true);
  });

  it('moves a column through the mutations hook', () => {
    const fixture = loadedFixture();
    renderLoadedBoard(fixture);

    act(() => lastBoardCanvasProps().onMoveColumn(fixture.columns[0]!, 1));

    expect(mutations.moveColumn).toHaveBeenCalledWith(fixture.columns[0], 1);
  });
});
