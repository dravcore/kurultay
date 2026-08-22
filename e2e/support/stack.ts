import { randomUUID } from 'node:crypto';
import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import type {
  AttachmentDto,
  BoardDto,
  ColumnDto,
  InvitationDto,
  TaskDto,
  UserDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@kurul/shared-types';
import { API_URL, WEB_URL } from '../stack-env';
import { extractLink, openMailbox, type Mailbox } from './mailpit';

/**
 * Building a scenario's starting position over HTTP.
 *
 * Everything a test needs *before* the behaviour it is actually testing — an account, a
 * confirmed address, a workspace, a board, three cards — is created through the public API
 * rather than through the UI. Driving that setup with clicks would make every scenario also a
 * test of registration, workspace creation and the task dialog, so a change to any of those
 * would turn every scenario red at once and none of them would be telling the truth about
 * what broke. It is also the difference between a suite that finishes in one minute and one
 * that finishes in six.
 *
 * The one exception is deliberate: scenario 3 sends its invitation through the settings UI,
 * because sending the invitation *is* the behaviour under test there.
 *
 * No Prisma client and no direct database access. The suite is a black-box client of a
 * running stack, which is what lets it catch the wiring — CORS, cookies, socket auth, mail —
 * that in-process tests are blind to by construction.
 */

/** Distinct per call, and short enough to keep a slug inside its 48-character limit. */
function uniqueId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12);
}

export type TestUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  /** An API context carrying this user's session cookie. */
  api: APIRequestContext;
};

/**
 * Better Auth's default minimum is eight characters; this is fixed rather than random so a
 * failed sign-in in a trace is obviously not a wrong-password problem.
 */
const PASSWORD = 'playwright-e2e-password';

export class Stack {
  private readonly contexts: APIRequestContext[] = [];
  private mailbox: Mailbox | null = null;

  /**
   * Registers a user and returns a signed-in API context for them.
   *
   * `confirmEmail` goes the long way round on purpose — sign-up sends a verification mail,
   * the suite reads it out of Mailpit and follows the link. Setting `emailVerified` directly
   * would be one line, and would skip the only check anyone has that the verification mail
   * carries a link that works.
   */
  async createUser(options: { confirmEmail?: boolean } = {}): Promise<TestUser> {
    const suffix = uniqueId();
    const email = `e2e-${suffix}@kurul.test`;
    const name = `E2E ${suffix}`;
    const api = await this.newApiContext();

    const signUp = await api.post('/auth/sign-up/email', {
      data: { email, password: PASSWORD, name },
    });
    expect(signUp.ok(), `sign-up failed: ${signUp.status()} ${await signUp.text()}`).toBe(true);

    if (options.confirmEmail) {
      await this.confirmEmail(api, email);
    }

    const me = await api.get('/me');
    expect(me.ok(), `GET /me failed: ${me.status()} ${await me.text()}`).toBe(true);
    const user = (await me.json()) as UserDto;

    return { id: user.id, name, email, password: PASSWORD, api };
  }

  private async confirmEmail(api: APIRequestContext, email: string): Promise<void> {
    const body = await this.mail().then((mailbox) =>
      mailbox.waitForMessage(email, 'Confirm your email address'),
    );
    const link = extractLink(body, '/auth/verify-email');

    // `maxRedirects: 0` so the assertion lands on the API's own answer. Better Auth reports a
    // bad token by redirecting to the web app with `?error=…` and a 200-looking page — a
    // followed redirect would make a broken link indistinguishable from a working one.
    const verified = await api.get(link, { maxRedirects: 0 });
    const location = verified.headers().location ?? '';
    expect(
      location,
      `verification link was rejected (redirected to ${location || '<nothing>'})`,
    ).not.toContain('error=');

    // Better Auth caches the session payload in a cookie for 60 seconds, so the context is
    // still presenting `emailVerified: false` at this point. Signing in again is what makes
    // the freshly confirmed address visible to the invitation guard.
    const signIn = await api.post('/auth/sign-in/email', {
      data: { email, password: PASSWORD },
    });
    expect(signIn.ok(), `re-sign-in after confirmation failed: ${signIn.status()}`).toBe(true);
  }

  async createWorkspace(user: TestUser): Promise<WorkspaceDto> {
    const suffix = uniqueId();
    const response = await user.api.post('/workspaces', {
      data: { name: `E2E Workspace ${suffix}`, slug: `e2e-${suffix}` },
    });
    expect(
      response.ok(),
      `workspace creation failed: ${response.status()} ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as WorkspaceDto;
  }

  /**
   * A board plus the three columns the API seeds with it (To Do / In Progress / Done), in
   * position order.
   */
  async createBoard(
    user: TestUser,
    workspaceId: string,
  ): Promise<{ board: BoardDto; columns: ColumnDto[] }> {
    const created = await user.api.post(`/workspaces/${workspaceId}/boards`, {
      data: { name: `E2E Board ${uniqueId()}` },
    });
    expect(created.ok(), `board creation failed: ${created.status()} ${await created.text()}`).toBe(
      true,
    );
    const board = (await created.json()) as BoardDto;

    const columnsResponse = await user.api.get(
      `/workspaces/${workspaceId}/boards/${board.id}/columns`,
    );
    expect(columnsResponse.ok(), `column fetch failed: ${columnsResponse.status()}`).toBe(true);
    const columns = (await columnsResponse.json()) as ColumnDto[];
    expect(
      columns.length,
      'board creation is expected to seed three default columns',
    ).toBeGreaterThanOrEqual(3);

    return { board, columns };
  }

  /**
   * Appends a task to a column.
   *
   * `afterTaskId` is threaded through rather than relying on creation order: `Task.position`
   * is a Float produced by fractional indexing, and "created later" is not by itself a
   * promise about where a card lands. Naming the predecessor makes the starting order an
   * assertion the setup makes, not one the test inherits.
   */
  async createTask(
    user: TestUser,
    workspaceId: string,
    boardId: string,
    columnId: string,
    title: string,
    afterTaskId?: string,
  ): Promise<TaskDto> {
    const response = await user.api.post(`/workspaces/${workspaceId}/boards/${boardId}/tasks`, {
      data: afterTaskId ? { title, columnId, afterTaskId } : { title, columnId },
    });
    expect(
      response.ok(),
      `task creation failed: ${response.status()} ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as TaskDto;
  }

  /** Creates <titles> in order, each after the previous one. */
  async createTasks(
    user: TestUser,
    workspaceId: string,
    boardId: string,
    columnId: string,
    titles: string[],
  ): Promise<TaskDto[]> {
    const created: TaskDto[] = [];
    let previousId: string | undefined;
    for (const title of titles) {
      const task = await this.createTask(user, workspaceId, boardId, columnId, title, previousId);
      created.push(task);
      previousId = task.id;
    }
    return created;
  }

  async invite(
    inviter: TestUser,
    workspaceId: string,
    email: string,
    role: 'ADMIN' | 'MEMBER' | 'GUEST' = 'MEMBER',
  ): Promise<InvitationDto> {
    const response = await inviter.api.post(`/workspaces/${workspaceId}/invitations`, {
      data: { email, role },
    });
    expect(
      response.ok(),
      `invitation creation failed: ${response.status()} ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as InvitationDto;
  }

  /**
   * Makes <user> a member of <workspaceId> the way a real person becomes one: an invitation
   * addressed to them, accepted by them. The shortcut (inserting a `workspaceMember` row)
   * would skip the verified-address rule the accept endpoint enforces, and a scenario built
   * on a membership the product would have refused to grant is not testing the product.
   */
  async addMember(
    inviter: TestUser,
    workspaceId: string,
    user: TestUser,
    role: 'ADMIN' | 'MEMBER' | 'GUEST' = 'MEMBER',
  ): Promise<WorkspaceMemberDto> {
    const invitation = await this.invite(inviter, workspaceId, user.email, role);
    const accepted = await user.api.post(
      `/workspaces/${workspaceId}/invitations/${invitation.id}/accept`,
    );
    expect(
      accepted.ok(),
      `invitation accept failed: ${accepted.status()} ${await accepted.text()}`,
    ).toBe(true);
    return (await accepted.json()) as WorkspaceMemberDto;
  }

  /** Assigning a task to someone else is what produces an `assignment` notification. */
  async assign(
    actor: TestUser,
    workspaceId: string,
    taskId: string,
    userId: string,
  ): Promise<void> {
    const response = await actor.api.post(`/workspaces/${workspaceId}/tasks/${taskId}/assignees`, {
      data: { userId },
    });
    expect(response.ok(), `assignment failed: ${response.status()} ${await response.text()}`).toBe(
      true,
    );
  }

  /**
   * What the *server* thinks is attached to a task.
   *
   * The attachment scenario does everything through the browser, so every one of its
   * assertions is on the DOM — and a DOM assertion cannot tell "the row was deleted" from
   * "the row was removed from a list in React state and the request never happened". This
   * read is the second opinion: it goes over HTTP with the user's own session, so it also
   * proves the endpoint answers the same thing a reload would.
   *
   * `GET .../attachments` returns a plain array and not a cursor page (decision D11), so
   * there is nothing to unwrap here — if that ever changes, this is where it breaks.
   */
  async listAttachments(
    user: TestUser,
    workspaceId: string,
    taskId: string,
  ): Promise<AttachmentDto[]> {
    const response = await user.api.get(`/workspaces/${workspaceId}/tasks/${taskId}/attachments`);
    expect(
      response.ok(),
      `attachment list failed: ${response.status()} ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as AttachmentDto[];
  }

  /** Reads a task back from the API — used to verify what the *server* stored, not the DOM. */
  async getTask(user: TestUser, workspaceId: string, taskId: string): Promise<TaskDto> {
    const response = await user.api.get(`/workspaces/${workspaceId}/tasks/${taskId}`);
    expect(response.ok(), `task fetch failed: ${response.status()}`).toBe(true);
    return (await response.json()) as TaskDto;
  }

  async mail(): Promise<Mailbox> {
    this.mailbox ??= await openMailbox();
    return this.mailbox;
  }

  private async newApiContext(): Promise<APIRequestContext> {
    const context = await playwrightRequest.newContext({
      baseURL: API_URL,
      // Better Auth rejects a credentialed request whose `Origin` it cannot vouch for
      // (`MISSING_OR_NULL_ORIGIN`, 403) — its CSRF defence, and it fires as soon as a request
      // carries a session cookie. A browser always sends this header; Playwright's API client
      // does not, so the suite states it explicitly. It has to be `WEB_URL`, the one entry in
      // the API's `trustedOrigins`, which means this header is also a live check that the
      // suite's ports and the API's `WEB_URL` agree.
      extraHTTPHeaders: { Origin: WEB_URL },
    });
    this.contexts.push(context);
    return context;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.contexts.map((context) => context.dispose()));
    await this.mailbox?.dispose();
  }
}
