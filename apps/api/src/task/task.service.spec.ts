import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ActivityType, SocketEvents } from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { MIN_GAP } from '../common/position/fractional-index';
import { NotificationMailer } from '../notification/notification-mailer';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskAssigneeService } from './task-assignee.service';
import { TaskEventsService } from './task-events.service';
import { TaskLabelService } from './task-label.service';
import { buildListWhere } from './task-query-where';
import { TaskReadService } from './task-read.service';
import { TaskService } from './task.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const COLUMN_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const OTHER_BOARD_COLUMN = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d52';
const USER_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';

function taskRow(
  overrides: Partial<{
    id: string;
    boardId: string;
    columnId: string;
    title: string;
    position: number;
    dueDate: Date | null;
    estimatedMinutes: number | null;
  }> = {},
) {
  const now = new Date('2026-01-01');
  return {
    id: overrides.id ?? '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60',
    boardId: overrides.boardId ?? BOARD_ID,
    columnId: overrides.columnId ?? COLUMN_ID,
    title: overrides.title ?? 'Task',
    description: null,
    priority: 'MEDIUM' as const,
    position: overrides.position ?? 1000,
    dueDate: overrides.dueDate ?? null,
    estimatedMinutes: overrides.estimatedMinutes ?? null,
    createdById: USER_ID,
    createdAt: now,
    updatedAt: now,
    assignees: [] as Array<{ user: { id: string; name: string; avatarUrl: string | null } }>,
    labels: [] as Array<{ label: { id: string; boardId: string; name: string; color: string } }>,
    // Both includes carry a `checklists` array; the detail shape is the wider of the two, so a
    // fixture built with it satisfies whichever mapper the code under test reaches for.
    checklists: [] as Array<{
      id: string;
      title: string;
      position: number;
      items: Array<{ id: string; content: string; isDone: boolean; position: number }>;
    }>,
  };
}

describe('TaskService', () => {
  function buildService() {
    const activityService = {
      record: jest.fn().mockResolvedValue({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80' }),
    };
    const notificationService = {
      createAssignment: jest.fn().mockResolvedValue(null),
      createMention: jest.fn().mockResolvedValue(null),
      emitUnreadChanged: jest.fn(),
    };
    const prisma = {
      board: {
        findFirst: jest.fn().mockResolvedValue({ id: BOARD_ID, workspaceId: WORKSPACE_ID }),
      },
      column: {
        findFirst: jest.fn().mockResolvedValue({ id: COLUMN_ID, boardId: BOARD_ID }),
      },
      task: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      taskAssignee: {
        create: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      taskLabel: {
        create: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      label: {
        findFirst: jest.fn(),
      },
      // The attachment count is its own scoped statement rather than an `include`
      // (`attachment-count.ts`), so it is its own delegate here. Defaults say "no attachments",
      // which is what every fixture in this file describes; the tests that care override them.
      attachment: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      workspaceMember: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    const realtimeMock = { emitToBoard: jest.fn() };
    const realtime =
      realtimeMock as unknown as import('../realtime/realtime.service').RealtimeService;
    const prismaService = prisma as unknown as PrismaService;
    const activity = activityService as unknown as ActivityService;
    const notifications = notificationService as unknown as NotificationService;
    const taskRead = new TaskReadService(prismaService);
    const taskEvents = new TaskEventsService(taskRead, realtime);
    const notificationMailer = { sendForCreated: jest.fn().mockResolvedValue(undefined) };
    const assignees = new TaskAssigneeService(
      prismaService,
      activity,
      notifications,
      taskRead,
      taskEvents,
      notificationMailer as unknown as NotificationMailer,
    );
    const labels = new TaskLabelService(prismaService, taskRead, taskEvents);
    return {
      service: new TaskService(prismaService, activity, realtime, assignees, labels, taskRead),
      prisma,
      activityService,
      notificationService,
      notificationMailer,
      realtime,
      realtimeMock,
    };
  }

  it('appends a created task after the final existing position', async () => {
    const { service, prisma } = buildService();
    prisma.task.findMany.mockResolvedValue([taskRow({ id: 'last', position: 3000 })]);
    prisma.task.create.mockResolvedValue(taskRow({ id: 'new', position: 4000, title: 'New' }));

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
        title: 'New',
        columnId: COLUMN_ID,
      }),
    ).resolves.toMatchObject({ position: 4000, title: 'New' });

    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 4000, createdById: USER_ID }),
      }),
    );
    // The siblings are read for their ordering, so that is all the query may ask for.
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { columnId: COLUMN_ID },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true },
    });
  });

  it('places the first task in an empty column at the base gap', async () => {
    const { service, prisma } = buildService();
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.create.mockResolvedValue(taskRow({ id: 'solo', position: 1000 }));

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
        title: 'Solo',
        columnId: COLUMN_ID,
      }),
    ).resolves.toMatchObject({ position: 1000 });

    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 1000 }) }),
    );
  });

  it('inserts between neighbors on create when afterTaskId is set', async () => {
    const { service, prisma } = buildService();
    const a = taskRow({ id: 'a', position: 1000 });
    const b = taskRow({ id: 'b', position: 2000 });
    prisma.task.findMany.mockResolvedValue([a, b]);
    prisma.task.create.mockResolvedValue(taskRow({ id: 'mid', position: 1500 }));

    await service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
      title: 'Mid',
      columnId: COLUMN_ID,
      afterTaskId: 'a',
    });

    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 1500 }) }),
    );
  });

  it('returns 404 when a task is outside the workspace', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(null);
    await expect(
      service.get(WORKSPACE_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects moving a task onto a column from another board', async () => {
    const { service, prisma } = buildService();
    const task = taskRow({ id: 't1' });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(task),
          findMany: jest.fn().mockResolvedValue([task]),
          update: jest.fn(),
        },
        column: {
          findFirst: jest.fn().mockResolvedValue({
            id: OTHER_BOARD_COLUMN,
            boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d70',
          }),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
        attachment: { count: jest.fn().mockResolvedValue(0) },
      }),
    );

    await expect(
      service.move(WORKSPACE_ID, 't1', ACTOR_ID, { columnId: OTHER_BOARD_COLUMN }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a task as its own neighbor', async () => {
    const { service, prisma } = buildService();
    const task = taskRow({ id: 't1' });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(task),
          findMany: jest.fn().mockResolvedValue([task]),
          update: jest.fn(),
        },
        column: {
          findFirst: jest.fn().mockResolvedValue({ id: COLUMN_ID, boardId: BOARD_ID }),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
        attachment: { count: jest.fn().mockResolvedValue(0) },
      }),
    );

    // The service owns this check — resolveMoveNeighbors never sees the case, because the
    // moved task is filtered out of `remaining` before the helper is called.
    const rejected = service.move(WORKSPACE_ID, 't1', ACTOR_ID, {
      columnId: COLUMN_ID,
      afterTaskId: 't1',
    });
    await expect(rejected).rejects.toBeInstanceOf(BadRequestException);
    await expect(rejected).rejects.toThrow('A task cannot be its own neighbor');
  });

  it('rebalances when the insertion gap is exhausted', async () => {
    const { service, prisma } = buildService();
    const tight = [
      taskRow({ id: 'a', position: 1000 }),
      taskRow({ id: 'b', position: 1000 + MIN_GAP / 2 }),
    ];
    const moving = taskRow({ id: 'c', position: 5000, columnId: 'other' });

    let updateCall: { where: { id: string }; data: { position: number; columnId: string } } | null =
      null;
    const writeOrder: string[] = [];
    // Both mocks resolve on a later tick, so a `Promise.all` would interleave start/settle and
    // the log would not read as two completed statements in order.
    let lockSeen = false;
    const executeRaw = jest.fn().mockImplementation(async () => {
      if (!lockSeen) {
        lockSeen = true;
        return 0;
      }
      writeOrder.push('siblings:start');
      await Promise.resolve();
      writeOrder.push('siblings:done');
      return 2;
    });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(moving),
          findMany: jest.fn().mockResolvedValue(tight),
          update: jest.fn().mockImplementation(async ({ where, data }) => {
            updateCall = { where, data };
            writeOrder.push('moved:start');
            await Promise.resolve();
            writeOrder.push('moved:done');
            return { ...moving, ...data, id: where.id };
          }),
        },
        column: {
          findFirst: jest.fn().mockResolvedValue({ id: COLUMN_ID, boardId: BOARD_ID }),
        },
        $executeRaw: executeRaw,
        attachment: { count: jest.fn().mockResolvedValue(0) },
      }),
    );

    const result = await service.move(WORKSPACE_ID, 'c', ACTOR_ID, {
      columnId: COLUMN_ID,
      beforeTaskId: 'a',
    });

    expect(updateCall).toEqual({
      where: { id: 'c', board: { workspaceId: WORKSPACE_ID } },
      data: { position: 2000, columnId: COLUMN_ID },
    });
    expect(result.position).toBe(2000);
    expect(result.columnId).toBe(COLUMN_ID);
    // Column FOR UPDATE + sibling rebalance write.
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const [, ids, positions, columnId] = executeRaw.mock.calls[1]!;
    expect(ids).toEqual(['a', 'b']);
    expect(positions).toEqual([1000, 3000]);
    expect(columnId).toBe(COLUMN_ID);
    // An interactive transaction is one connection: the rebalance writes run one after the
    // other, so a failure names a statement and leaves a state that can be reasoned about.
    expect(writeOrder).toEqual(['moved:start', 'moved:done', 'siblings:start', 'siblings:done']);
  });

  /** Wire up the $transaction mock the way move() consumes it. */
  function mockMoveTx(
    prisma: ReturnType<typeof buildService>['prisma'],
    options: {
      task?: ReturnType<typeof taskRow> | null;
      siblings?: Array<ReturnType<typeof taskRow>>;
      column?: { id: string; boardId: string } | null;
    } = {},
  ): {
    updates: Array<{ id: string; position?: number; columnId?: string }>;
    siblingQuery: jest.Mock;
  } {
    const updates: Array<{ id: string; position?: number; columnId?: string }> = [];
    const movedTask = options.task === undefined ? taskRow({ id: 't1' }) : options.task;
    const siblingQuery = jest.fn().mockResolvedValue(options.siblings ?? []);
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: jest.fn().mockResolvedValue(movedTask),
          findMany: siblingQuery,
          update: jest.fn().mockImplementation(({ where, data }) => {
            updates.push({ id: where.id as string, ...data });
            return Promise.resolve({ ...(movedTask ?? taskRow({ id: 't1' })), ...data });
          }),
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            updates.push({ id: where.id as string, ...data });
            return Promise.resolve({ count: 1 });
          }),
        },
        column: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              options.column === undefined ? { id: COLUMN_ID, boardId: BOARD_ID } : options.column,
            ),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
        attachment: { count: jest.fn().mockResolvedValue(0) },
      }),
    );
    return { updates, siblingQuery };
  }

  it('returns 404 on create when afterTaskId does not exist in the target column', async () => {
    const { service, prisma } = buildService();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findMany: jest.fn().mockResolvedValue([taskRow({ id: 'a', position: 1000 })]),
          create: jest.fn(),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
        attachment: { count: jest.fn().mockResolvedValue(0) },
      }),
    );

    await expect(
      service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
        title: 'Orphan',
        columnId: COLUMN_ID,
        afterTaskId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rebalances the whole column when a create hits an exhausted gap', async () => {
    const { service, prisma } = buildService();
    const a = taskRow({ id: 'a', position: 1000 });
    const b = taskRow({ id: 'b', position: 1000 + MIN_GAP / 2 });

    let createdPosition: number | undefined;
    let lockSeen = false;
    const executeRaw = jest.fn().mockImplementation(async () => {
      if (!lockSeen) {
        lockSeen = true;
        return 0;
      }
      return 2;
    });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findMany: jest.fn().mockResolvedValue([a, b]),
          create: jest.fn().mockImplementation(({ data }) => {
            createdPosition = data.position as number;
            return Promise.resolve(taskRow({ id: 'new', position: data.position as number }));
          }),
        },
        $executeRaw: executeRaw,
        attachment: { count: jest.fn().mockResolvedValue(0) },
      }),
    );

    const result = await service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
      title: 'Wedge',
      columnId: COLUMN_ID,
      afterTaskId: 'a',
    });

    expect(executeRaw).toHaveBeenCalledTimes(2);
    const [, ids, positions, columnId] = executeRaw.mock.calls[1]!;
    expect(ids).toEqual(['a', 'b']);
    expect(positions).toEqual([1000, 3000]);
    expect(columnId).toBe(COLUMN_ID);
    expect(createdPosition).toBe(2000);
    expect(result.position).toBe(2000);
  });

  it('appends to the end of the target column when no neighbors are given', async () => {
    const { service, prisma } = buildService();
    const moving = taskRow({ id: 'moving', position: 500, columnId: 'other' });
    const { updates, siblingQuery } = mockMoveTx(prisma, {
      task: moving,
      siblings: [taskRow({ id: 'a', position: 1000 })],
    });

    const result = await service.move(WORKSPACE_ID, 'moving', ACTOR_ID, { columnId: COLUMN_ID });

    expect(updates).toEqual([{ id: 'moving', columnId: COLUMN_ID, position: 2000 }]);
    expect(result.position).toBe(2000);
    // The siblings are read for their ordering, so that is all the query may ask for — the
    // moved task's own row is the one read in full.
    expect(siblingQuery).toHaveBeenCalledWith({
      where: { columnId: COLUMN_ID },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true },
    });
  });

  it('moves into an empty column at the base gap', async () => {
    const { service, prisma } = buildService();
    const moving = taskRow({ id: 'moving', position: 500, columnId: 'other' });
    const { updates } = mockMoveTx(prisma, { task: moving, siblings: [] });

    const result = await service.move(WORKSPACE_ID, 'moving', ACTOR_ID, { columnId: COLUMN_ID });

    expect(updates).toEqual([{ id: 'moving', columnId: COLUMN_ID, position: 1000 }]);
    expect(result.position).toBe(1000);
  });

  it('inserts between the before neighbor and its successor without touching siblings', async () => {
    const { service, prisma } = buildService();
    const moving = taskRow({ id: 'moving', position: 9000 });
    const { updates } = mockMoveTx(prisma, {
      task: moving,
      siblings: [
        taskRow({ id: 'a', position: 1000 }),
        taskRow({ id: 'b', position: 2000 }),
        moving,
      ],
    });

    const result = await service.move(WORKSPACE_ID, 'moving', ACTOR_ID, {
      columnId: COLUMN_ID,
      beforeTaskId: 'a',
      afterTaskId: 'b',
    });

    expect(updates).toEqual([{ id: 'moving', columnId: COLUMN_ID, position: 1500 }]);
    expect(result.position).toBe(1500);
  });

  it('returns 404 on move when the task is outside the workspace', async () => {
    const { service, prisma } = buildService();
    mockMoveTx(prisma, { task: null });

    await expect(
      service.move(WORKSPACE_ID, 'ghost', ACTOR_ID, { columnId: COLUMN_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 on move when the target column is outside the workspace', async () => {
    const { service, prisma } = buildService();
    mockMoveTx(prisma, { column: null });

    await expect(
      service.move(WORKSPACE_ID, 't1', ACTOR_ID, { columnId: COLUMN_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 on move when a neighbor id is not in the target column', async () => {
    const { service, prisma } = buildService();
    mockMoveTx(prisma, {
      task: taskRow({ id: 't1' }),
      siblings: [taskRow({ id: 't1' }), taskRow({ id: 'a', position: 2000 })],
    });

    await expect(
      service.move(WORKSPACE_ID, 't1', ACTOR_ID, { columnId: COLUMN_ID, beforeTaskId: 'foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 on move when beforeTaskId and afterTaskId are not adjacent', async () => {
    const { service, prisma } = buildService();
    mockMoveTx(prisma, {
      task: taskRow({ id: 'moving', position: 9000 }),
      siblings: [
        taskRow({ id: 'a', position: 1000 }),
        taskRow({ id: 'b', position: 2000 }),
        taskRow({ id: 'c', position: 3000 }),
      ],
    });

    await expect(
      service.move(WORKSPACE_ID, 'moving', ACTOR_ID, {
        columnId: COLUMN_ID,
        beforeTaskId: 'a',
        afterTaskId: 'c',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears dueDate and estimatedMinutes when the payload sets them to null', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(
      taskRow({ id: 't1', dueDate: new Date('2026-03-01'), estimatedMinutes: 90 }),
    );
    prisma.task.update.mockResolvedValue(taskRow({ id: 't1' }));

    await service.update(WORKSPACE_ID, 't1', ACTOR_ID, { dueDate: null, estimatedMinutes: null });

    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1', board: { workspaceId: WORKSPACE_ID } },
        data: { dueDate: null, estimatedMinutes: null },
      }),
    );
  });

  it('writes nothing when the payload repeats what is already stored', async () => {
    const { service, prisma, activityService, realtimeMock } = buildService();
    const stored = taskRow({ id: 't1', title: 'Task', dueDate: new Date('2026-03-01') });
    prisma.task.findFirst.mockResolvedValue(stored);

    const result = await service.update(WORKSPACE_ID, 't1', ACTOR_ID, {
      title: 'Task',
      dueDate: '2026-03-01T00:00:00.000Z',
      priority: 'MEDIUM',
    });

    // `updatedAt` is what "last activity" reads, so a no-op PATCH must not move it.
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(activityService.record).not.toHaveBeenCalled();
    expect(realtimeMock.emitToBoard).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 't1',
      title: 'Task',
      updatedAt: stored.updatedAt.toISOString(),
    });
  });

  it('writes nothing for an empty payload', async () => {
    const { service, prisma, realtimeMock } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));

    await service.update(WORKSPACE_ID, 't1', ACTOR_ID, {});

    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(realtimeMock.emitToBoard).not.toHaveBeenCalled();
  });

  it('records the activity and announces the change on a real edit', async () => {
    const { service, prisma, activityService, realtimeMock } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1', title: 'Task' }));
    prisma.task.update.mockResolvedValue(taskRow({ id: 't1', title: 'Renamed' }));

    await service.update(WORKSPACE_ID, 't1', ACTOR_ID, { title: 'Renamed' });

    expect(activityService.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: ActivityType.TaskUpdated,
        payload: { title: 'Renamed', changes: { title: 'Renamed' } },
      }),
    );
    expect(realtimeMock.emitToBoard).toHaveBeenCalledWith(BOARD_ID, SocketEvents.TASK_UPDATED, {
      workspaceId: WORKSPACE_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      taskId: 't1',
    });
  });

  it('returns 404 and writes nothing when updating a task in another workspace', async () => {
    const { service, prisma, realtimeMock } = buildService();
    prisma.task.findFirst.mockResolvedValue(null);

    await expect(
      service.update(WORKSPACE_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99', ACTOR_ID, {
        title: 'Hijacked',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(realtimeMock.emitToBoard).not.toHaveBeenCalled();
  });

  it('leaves omitted fields out of the update payload entirely', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.task.update.mockResolvedValue(taskRow({ id: 't1', title: 'Renamed' }));

    await service.update(WORKSPACE_ID, 't1', ACTOR_ID, { title: 'Renamed' });

    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: 'Renamed' } }),
    );
  });

  it('rejects assigning a user who is not a workspace member with 422', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.workspaceMember.findFirst.mockResolvedValue(null);

    await expect(
      service.addAssignee(WORKSPACE_ID, 't1', ACTOR_ID, { userId: USER_ID }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.taskAssignee.create).not.toHaveBeenCalled();
  });

  it('emails the new assignee once their notification row is stored', async () => {
    const { service, prisma, notificationService, notificationMailer } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.workspaceMember.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.taskAssignee.create.mockResolvedValue({ taskId: 't1', userId: USER_ID });
    notificationService.createAssignment.mockResolvedValue({ id: 'n1' });

    await service.addAssignee(WORKSPACE_ID, 't1', ACTOR_ID, { userId: USER_ID });

    expect(notificationMailer.sendForCreated).toHaveBeenCalledWith([
      {
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        actorId: ACTOR_ID,
        type: 'assignment',
        taskId: 't1',
      },
    ]);
  });

  it('sends no email when the actor assigned themselves, because no row was stored', async () => {
    const { service, prisma, notificationService, notificationMailer } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.workspaceMember.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.taskAssignee.create.mockResolvedValue({ taskId: 't1', userId: ACTOR_ID });
    notificationService.createAssignment.mockResolvedValue(null);

    await service.addAssignee(WORKSPACE_ID, 't1', ACTOR_ID, { userId: ACTOR_ID });

    expect(notificationMailer.sendForCreated).not.toHaveBeenCalled();
  });

  it('maps a duplicate assignee to 409', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.workspaceMember.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.taskAssignee.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.addAssignee(WORKSPACE_ID, 't1', ACTOR_ID, { userId: USER_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 when removing an assignee who is not assigned', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.taskAssignee.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.removeAssignee(WORKSPACE_ID, 't1', ACTOR_ID, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.taskAssignee.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 't1', userId: USER_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
    });
  });

  it('rejects attaching a label from another board with 422', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.label.findFirst.mockResolvedValue(null);

    await expect(
      service.addLabel(WORKSPACE_ID, 't1', USER_ID, {
        labelId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.taskLabel.create).not.toHaveBeenCalled();
  });

  it('maps a duplicate task label to 409', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.label.findFirst.mockResolvedValue({ id: 'l1', boardId: BOARD_ID });
    prisma.taskLabel.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.addLabel(WORKSPACE_ID, 't1', USER_ID, {
        labelId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 when removing a label that is not attached to the task', async () => {
    const { service, prisma } = buildService();
    prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
    prisma.taskLabel.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.removeLabel(WORKSPACE_ID, 't1', USER_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.taskLabel.deleteMany).toHaveBeenCalledWith({
      where: {
        taskId: 't1',
        labelId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80',
        task: { board: { workspaceId: WORKSPACE_ID } },
      },
    });
  });

  describe('remove', () => {
    it('records the deletion as a workspace stub before dropping the row', async () => {
      const { service, prisma, activityService, realtimeMock } = buildService();
      const task = taskRow({ id: 't1', title: 'Doomed' });
      prisma.task.findFirst.mockResolvedValue(task);
      prisma.task.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.remove(WORKSPACE_ID, 't1', ACTOR_ID)).resolves.toBeUndefined();

      // Activity.task is SetNull on delete, so the payload has to carry the id itself.
      expect(activityService.record).toHaveBeenCalledWith(prisma, {
        workspaceId: WORKSPACE_ID,
        taskId: null,
        userId: ACTOR_ID,
        type: ActivityType.TaskDeleted,
        payload: {
          taskId: 't1',
          title: 'Doomed',
          columnId: COLUMN_ID,
          boardId: BOARD_ID,
        },
      });
      // The delete predicate carries the tenant scope, not just the id.
      expect(prisma.task.deleteMany).toHaveBeenCalledWith({
        where: { id: 't1', board: { workspaceId: WORKSPACE_ID } },
      });
      expect(realtimeMock.emitToBoard).toHaveBeenCalledWith(BOARD_ID, SocketEvents.TASK_DELETED, {
        workspaceId: WORKSPACE_ID,
        boardId: BOARD_ID,
        actorId: ACTOR_ID,
        taskId: 't1',
      });
    });

    it('scopes the lookup to the workspace and returns 404 outside it', async () => {
      const { service, prisma, activityService, realtimeMock } = buildService();
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(WORKSPACE_ID, '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99', ACTOR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d99',
            board: { workspaceId: WORKSPACE_ID },
          },
        }),
      );
      expect(prisma.task.deleteMany).not.toHaveBeenCalled();
      expect(activityService.record).not.toHaveBeenCalled();
      expect(realtimeMock.emitToBoard).not.toHaveBeenCalled();
    });

    it('leaves the row in place and stays silent when the delete fails', async () => {
      const { service, prisma, realtimeMock } = buildService();
      prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
      prisma.task.deleteMany.mockRejectedValue(new Error('deadlock'));

      await expect(service.remove(WORKSPACE_ID, 't1', ACTOR_ID)).rejects.toThrow('deadlock');

      // The transaction rolled back, so no client may be told the task is gone.
      expect(realtimeMock.emitToBoard).not.toHaveBeenCalled();
    });

    it('returns 404 when the scoped delete matches no row', async () => {
      const { service, prisma, realtimeMock } = buildService();
      // The row passed the in-transaction check but left the workspace before the write —
      // the scoped predicate is what catches it, and 404 is the cross-tenant answer.
      prisma.task.findFirst.mockResolvedValue(taskRow({ id: 't1' }));
      prisma.task.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(WORKSPACE_ID, 't1', ACTOR_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(realtimeMock.emitToBoard).not.toHaveBeenCalled();
    });

    it('reads the task inside the transaction, not before it', async () => {
      const { service, prisma } = buildService();
      const tx = {
        task: {
          findFirst: jest.fn().mockResolvedValue(taskRow({ id: 't1' })),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => callback(tx));

      await service.remove(WORKSPACE_ID, 't1', ACTOR_ID);

      // Reading outside the transaction reopens the window between check and delete.
      expect(prisma.task.findFirst).not.toHaveBeenCalled();
      expect(tx.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1', board: { workspaceId: WORKSPACE_ID } },
        }),
      );
    });
  });

  describe('list filters and cursor', () => {
    it('returns a cursor page and walks by id', async () => {
      const { service, prisma } = buildService();
      const a = taskRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d61' });
      const b = taskRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d62' });
      const c = taskRow({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d63' });
      prisma.task.findMany.mockResolvedValue([a, b, c]);

      const page = await service.list(WORKSPACE_ID, BOARD_ID, { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe(b.id);
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { boardId: BOARD_ID },
          orderBy: { id: 'asc' },
          take: 3,
        }),
      );
    });

    // The filter matrix itself is covered in task-query-where.spec.ts, against the function
    // rather than through a Prisma mock. What is left to prove here is that `list` hands the
    // query to it and passes the result on unaltered.
    it('queries with the predicate the filter builder produced', async () => {
      const { service, prisma } = buildService();
      prisma.task.findMany.mockResolvedValue([]);
      const query = { limit: 50, q: 'login', priority: ['HIGH' as const] };

      await service.list(WORKSPACE_ID, BOARD_ID, query);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: buildListWhere(BOARD_ID, query) }),
      );
    });
  });

  /**
   * The attachment badge's number, and the one thing about it that is not obvious.
   *
   * This count used to ride the include as `_count: { select: { attachments: true } }`, which
   * reads like the cheap option and is not: Prisma compiles it to an aggregate over the whole
   * `Attachment` table, scoped to no board, no workspace and no page. Measured on the seeded
   * 1 000-task board, the first page went from 0.070 ms / 13 buffers to 19.878 ms / 2 509 once
   * the table held 100 000 rows belonging to tasks that page never returns — the regression
   * P2-8 exists to prevent. `attachment-count.ts` carries the full numbers.
   *
   * So the assertion worth having is not "the number is right" (it would be right either way)
   * but **what the read is scoped to**. Asserted against the delegate rather than by parsing
   * emitted SQL: the shape of Prisma's SQL is Prisma's to change, while "the aggregate names
   * the ids this page returned" is the property that has to survive.
   */
  describe('attachment counts', () => {
    const A = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d61';
    const B = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d62';

    it('aggregates only over the tasks the page returned, never the whole table', async () => {
      const { service, prisma } = buildService();
      prisma.task.findMany.mockResolvedValue([taskRow({ id: A }), taskRow({ id: B })]);

      await service.list(WORKSPACE_ID, BOARD_ID, { limit: 50 });

      expect(prisma.attachment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['taskId'],
          where: { taskId: { in: [A, B] } },
        }),
      );
    });

    it('carries a per-task count, and 0 for a task with none', async () => {
      const { service, prisma } = buildService();
      prisma.task.findMany.mockResolvedValue([taskRow({ id: A }), taskRow({ id: B })]);
      prisma.attachment.groupBy.mockResolvedValue([{ taskId: A, _count: { _all: 3 } }]);

      const page = await service.list(WORKSPACE_ID, BOARD_ID, { limit: 50 });

      expect(page.items.map((task) => [task.id, task.attachmentCount])).toEqual([
        [A, 3],
        [B, 0],
      ]);
    });

    it('does not let another board’s task bleed into a count', async () => {
      // The aggregate answers for whatever ids it is given, so an id the page never returned
      // must not appear in the answer either. A grouping row for a foreign task is dropped
      // because the map is read by the page's own ids, not merged into it.
      const { service, prisma } = buildService();
      const foreign = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1dff';
      prisma.task.findMany.mockResolvedValue([taskRow({ id: A })]);
      prisma.attachment.groupBy.mockResolvedValue([
        { taskId: foreign, _count: { _all: 9 } },
        { taskId: A, _count: { _all: 1 } },
      ]);

      const page = await service.list(WORKSPACE_ID, BOARD_ID, { limit: 50 });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.attachmentCount).toBe(1);
    });

    it('spends no query at all on an empty page', async () => {
      const { service, prisma } = buildService();
      prisma.task.findMany.mockResolvedValue([]);

      await service.list(WORKSPACE_ID, BOARD_ID, { limit: 50 });

      // `IN ()` is a round trip whose answer is already known.
      expect(prisma.attachment.groupBy).not.toHaveBeenCalled();
    });

    it('counts a single task by its own id on a detail read', async () => {
      const { service, prisma } = buildService();
      prisma.task.findFirst.mockResolvedValue(taskRow({ id: A }));
      prisma.attachment.count.mockResolvedValue(2);

      const task = await service.get(WORKSPACE_ID, A);

      expect(prisma.attachment.count).toHaveBeenCalledWith({ where: { taskId: A } });
      expect(task.attachmentCount).toBe(2);
    });

    it('gives a freshly created task 0 without asking the database', async () => {
      const { service, prisma } = buildService();
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.create.mockResolvedValue(taskRow({ id: A }));

      const created = await service.create(WORKSPACE_ID, BOARD_ID, USER_ID, {
        title: 'New',
        columnId: COLUMN_ID,
      });

      expect(created.attachmentCount).toBe(0);
      expect(prisma.attachment.count).not.toHaveBeenCalled();
      expect(prisma.attachment.groupBy).not.toHaveBeenCalled();
    });
  });
});
