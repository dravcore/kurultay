import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, type Socket } from 'socket.io-client';
import {
  MemberRole,
  SocketClientEvents,
  SocketEvents,
  type TaskCreatedPayload,
} from '@kurul/shared-types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp, type TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The realtime path over a **real** Socket.io client, end to end.
 *
 * `test/realtime.e2e-spec.ts` spies on `RealtimeService.emitToBoard` and
 * `src/realtime/realtime.gateway.spec.ts` hands the gateway a mocked Prisma, so between them the
 * two halves nobody covers are precisely the ones that only exist at runtime: the **handshake**
 * (Better Auth resolving a session out of `client.handshake.headers`) and the
 * **member-removal → socket-eviction** chain (`afterRemoveMember` → `evictUserFromWorkspaceSockets`
 * → the closure `RealtimeService.attachServer` registers). Both are wired by side effect, so a
 * better-auth upgrade that changes cookie parsing, or a refactor that drops the
 * `registerWorkspaceSocketEviction` call, leaves every existing spec green while removed members
 * keep receiving board events until they happen to reconnect.
 *
 * Nothing here waits on a clock. Every wait is an event promise with a failure deadline, and the
 * *absence* of an event is only asserted after a second socket has been seen receiving that same
 * broadcast **and** a full client→server→client round trip has completed on the socket under
 * test — so "nothing arrived" means the frame was never sent, not that the assertion ran early.
 */

/** Failure budget for a single awaited socket event — a deadline, never a delay. */
const EVENT_TIMEOUT_MS = 10_000;

/** Failure budget for one request/ack round trip. */
const ACK_TIMEOUT_MS = 5_000;

/** Pause between `joinBoard` retries — enough to stop a hot loop, small next to the deadline. */
const RETRY_DELAY_MS = 50;

/** Signing up two users, seeding a board and driving two sockets outruns Jest's 5s default. */
jest.setTimeout(60_000);

/** The gateway's answer to every room-control message. */
interface RoomAck {
  ok: boolean;
  error?: string;
}

interface EventLog<T> {
  /** Every payload seen so far, in arrival order. */
  readonly received: readonly T[];
  /** Resolves with the first payload matching `predicate` — already-received ones included. */
  waitFor(predicate: (payload: T) => boolean, label: string): Promise<T>;
}

function logEvents<T>(socket: Socket, event: string): EventLog<T> {
  const received: T[] = [];
  const waiters = new Set<(payload: T) => void>();

  socket.on(event, (payload: T) => {
    received.push(payload);
    for (const notify of [...waiters]) notify(payload);
  });

  return {
    received,
    waitFor(predicate, label) {
      const already = received.find(predicate);
      if (already) return Promise.resolve(already);

      return new Promise<T>((resolve, reject) => {
        const notify = (payload: T): void => {
          if (!predicate(payload)) return;
          clearTimeout(timer);
          waiters.delete(notify);
          resolve(payload);
        };
        const timer = setTimeout(() => {
          waiters.delete(notify);
          reject(
            new Error(
              `timed out after ${EVENT_TIMEOUT_MS}ms waiting for "${event}" (${label}); ` +
                `saw ${received.length} payload(s)`,
            ),
          );
        }, EVENT_TIMEOUT_MS);
        waiters.add(notify);
      });
    },
  };
}

/**
 * A socket plus the lifecycle promises for it.
 *
 * The listeners are attached the moment the socket is created, never at the point a test decides
 * to await them: `connect` fires on its own schedule, and a `once()` registered after the fact
 * would wait for a second connection that never comes.
 */
interface TestSocket {
  socket: Socket;
  connected: Promise<void>;
  /** Resolves with the disconnect reason reported by the client. */
  disconnected: Promise<string>;
}

function withDeadline<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

describe('Realtime socket handshake and eviction (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let origin: string;
  const openSockets: Socket[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    // `createTestApp` binds the server on an ephemeral loopback port; a real client needs the
    // port that was actually assigned, which is only knowable from the bound address.
    const address = app.getHttpServer().address() as AddressInfo | string | null;
    if (!address || typeof address === 'string') {
      throw new Error(`expected a bound TCP address, received ${JSON.stringify(address)}`);
    }
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    for (const socket of openSockets) socket.disconnect();
    openSockets.length = 0;
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterEach(() => {
    for (const socket of openSockets) socket.disconnect();
    openSockets.length = 0;
  });

  /**
   * A raw sign-in whose `Set-Cookie` headers are folded into one `Cookie` value.
   *
   * The suite's `TestUser.agent` keeps its cookies inside superagent's jar, which the Socket.io
   * client cannot read — the handshake needs the header itself.
   */
  async function sessionCookie(user: TestUser): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: user.email, password: user.password })
      .expect(200);

    const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
    expect(Array.isArray(setCookie)).toBe(true);
    // Two today — the session token and the cookie cache — but the count is Better Auth's
    // business; what this spec depends on is that the session token is among them.
    expect(setCookie!.length).toBeGreaterThan(0);

    const header = setCookie!.map((cookie) => cookie.split(';')[0]).join('; ');
    expect(header).toContain('better-auth.session_token=');
    return header;
  }

  function openSocket(cookie?: string): TestSocket {
    const socket = io(origin, {
      // Node's WebSocket transport is the only one that carries `extraHeaders`, and it is also
      // the transport that reaches the gateway through an HTTP upgrade rather than through
      // Express — which is exactly how a browser client arrives.
      transports: ['websocket'],
      extraHeaders: cookie ? { Cookie: cookie } : undefined,
      // A reconnect would paper over the very disconnect one of these tests asserts on.
      reconnection: false,
      forceNew: true,
    });
    openSockets.push(socket);

    const connected = new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error: Error) =>
        reject(new Error(`connect_error: ${error.message}`)),
      );
    });
    // Nothing awaits `connected` in the unauthenticated test, and an unobserved rejection would
    // crash the worker rather than fail an assertion.
    void connected.catch(() => undefined);

    const disconnected = new Promise<string>((resolve) => {
      socket.once('disconnect', (reason: string) => resolve(reason));
    });

    return { socket, connected, disconnected };
  }

  /**
   * `board:join`, retried while the gateway still answers `unauthenticated`.
   *
   * `handleConnection` resolves the session **asynchronously** after Socket.io has already
   * accepted the connection and Nest has already bound the message handlers, so a client that
   * emits the instant it sees `connect` can be served before `client.data.userId` exists. That
   * is a property of the gateway as written (measured here, not assumed), and a test that
   * emitted once would be a coin flip. The retry is bounded by a deadline and paced by the round
   * trip itself — there is no sleep — and it cannot hide a broken handshake: an unauthenticated
   * socket is disconnected outright, which makes the ack time out instead of answering.
   */
  async function joinBoard(open: TestSocket, boardId: string): Promise<RoomAck> {
    const deadline = Date.now() + EVENT_TIMEOUT_MS;
    for (;;) {
      const ack = (await open.socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(SocketClientEvents.BOARD_JOIN, { boardId })) as RoomAck;
      if (ack.error !== 'unauthenticated' || Date.now() >= deadline) return ack;
      // The handshake resolves the session on its own schedule; re-emitting the instant an
      // unauthenticated ack lands would hot-loop hundreds of emits over the deadline for what
      // is really a wait on one background promise. A short pause between attempts costs
      // nothing against the deadline and keeps a real regression from flooding the socket.
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  /** Signs up a user, adds them to `workspaceId` at `role`, and returns them with their id. */
  async function joinAs(
    workspaceId: string,
    role: MemberRole,
    name: string,
  ): Promise<TestUser & { id: string }> {
    const user = await signUp(app, { name });
    const me = await user.agent.get('/me').expect(200);
    await addMember(prisma, workspaceId, me.body.id as string, role);
    return { ...user, id: me.body.id as string };
  }

  interface SeededBoard {
    workspaceId: string;
    boardId: string;
    columnId: string;
  }

  async function seedBoard(owner: TestUser, label: string): Promise<SeededBoard> {
    const workspace = await createWorkspace(owner.agent, 'Socket WS', label);
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Main' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id as string}/columns`)
      .expect(200);

    expect(Array.isArray(columns.body)).toBe(true);
    expect(columns.body.length).toBeGreaterThan(0);

    return {
      workspaceId: workspace.id,
      boardId: board.body.id as string,
      columnId: columns.body[0].id as string,
    };
  }

  async function createTask(owner: TestUser, board: SeededBoard, title: string): Promise<string> {
    const task = await owner.agent
      .post(`/workspaces/${board.workspaceId}/boards/${board.boardId}/tasks`)
      .send({ title, columnId: board.columnId })
      .expect(201);
    return task.body.id as string;
  }

  it('disconnects a handshake that carries no session cookie', async () => {
    const anonymous = openSocket();

    const reason = await withDeadline(
      anonymous.disconnected,
      'server disconnect',
      EVENT_TIMEOUT_MS,
    );

    // `client.disconnect(true)` in `handleConnection` is what the client reports back as
    // 'io server disconnect' — a transport-level drop (network blip, client-initiated close)
    // would report a different reason, so pinning this value proves the *server* evicted the
    // handshake rather than merely that some disconnect, of any origin, took place.
    expect(reason).toBe('io server disconnect');
    expect(anonymous.socket.connected).toBe(false);
  });

  it('delivers a board event to a member socket that joined the board room', async () => {
    const owner = await signUp(app, { name: 'Board Owner' });
    const board = await seedBoard(owner, 'sock-join');
    const member = await joinAs(board.workspaceId, MemberRole.MEMBER, 'Board Member');

    const open = openSocket(await sessionCookie(member));
    await withDeadline(open.connected, 'member socket connect', EVENT_TIMEOUT_MS);

    const created = logEvents<TaskCreatedPayload>(open.socket, SocketEvents.TASK_CREATED);

    expect(await joinBoard(open, board.boardId)).toEqual({ ok: true });

    const taskId = await createTask(owner, board, 'Ship it');
    const payload = await created.waitFor((event) => event.taskId === taskId, 'task:created');

    expect(created.received).toHaveLength(1);
    expect(payload).toEqual(
      expect.objectContaining({
        workspaceId: board.workspaceId,
        boardId: board.boardId,
        taskId,
        actorId: expect.any(String),
      }),
    );
    // The session survived the handshake rather than the socket being tolerated anonymously.
    expect(open.socket.connected).toBe(true);
  });

  it('stops delivering board events to a member socket once the membership is revoked', async () => {
    const owner = await signUp(app, { name: 'Evictor' });
    const board = await seedBoard(owner, 'sock-evict');
    const member = await joinAs(board.workspaceId, MemberRole.MEMBER, 'Evicted');

    // Two sockets in the same board room. The owner's is the witness: once *it* has seen a
    // broadcast, that broadcast has demonstrably been fanned out, so the member's silence is a
    // fact about room membership rather than about how long the test happened to wait.
    const memberOpen = openSocket(await sessionCookie(member));
    const ownerOpen = openSocket(await sessionCookie(owner));
    await withDeadline(
      Promise.all([memberOpen.connected, ownerOpen.connected]),
      'both sockets connect',
      EVENT_TIMEOUT_MS,
    );

    const memberEvents = logEvents<TaskCreatedPayload>(
      memberOpen.socket,
      SocketEvents.TASK_CREATED,
    );
    const ownerEvents = logEvents<TaskCreatedPayload>(ownerOpen.socket, SocketEvents.TASK_CREATED);

    expect(await joinBoard(memberOpen, board.boardId)).toEqual({ ok: true });
    expect(await joinBoard(ownerOpen, board.boardId)).toEqual({ ok: true });

    // Baseline: the pipe is live *before* the removal, so the silence afterwards can only be the
    // removal. Without it, the closing `toHaveLength(1)` would pass just as happily on a socket
    // that never received anything at all.
    const beforeId = await createTask(owner, board, 'Before removal');
    await memberEvents.waitFor((event) => event.taskId === beforeId, 'baseline task:created');
    expect(memberEvents.received).toHaveLength(1);

    await owner.agent.delete(`/workspaces/${board.workspaceId}/members/${member.id}`).expect(204);

    const afterId = await createTask(owner, board, 'After removal');
    await ownerEvents.waitFor((event) => event.taskId === afterId, 'witness task:created');

    // A full client→server→client round trip on the socket under test: any frame the server had
    // already written to it has been read by the time this ack comes back. The ack itself is the
    // membership check the gateway runs on join, which the removal must now fail.
    expect(
      await memberOpen.socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(SocketClientEvents.BOARD_JOIN, { boardId: board.boardId }),
    ).toEqual({ ok: false, error: 'board not found' });

    // Still connected — the socket was evicted from the room, not hung up on, so an empty log
    // cannot be explained away by a dead connection.
    expect(memberOpen.socket.connected).toBe(true);
    expect(ownerEvents.received).toHaveLength(2);
    expect(memberEvents.received).toHaveLength(1);
    expect(memberEvents.received.map((event) => event.taskId)).toEqual([beforeId]);
  });
});
