import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  ACTIVATION_EVENTS,
  ACTIVATION_WINDOW_DAYS,
  ActivationEvent,
  ColumnCategory,
  MemberRole,
  UsagePingKind,
} from '@kurul/shared-types';
import type { ActivationFunnelDto, ActivationStepDto } from '@kurul/shared-types';
import { INSTANCE_ADMIN_EMAILS_ENV } from '../src/common/guards/instance-admin.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, confirmEmail, createWorkspace, signUp, type TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The activation funnel (audit PM-07), driven through the real HTTP surface.
 *
 * The unit specs prove the pieces; this suite proves the thing the finding actually asked for —
 * that a solo maintainer can walk a person through onboarding and then *read the drop-offs*
 * without instrumenting a single new write. Nine of the eleven steps here are answered from
 * rows the product wrote for its own reasons, so a regression in this suite means a derivation
 * broke, not that a counter was forgotten.
 *
 * Two properties get their own tests because they are the ones a reviewer would otherwise have
 * to take on trust: who is allowed to read these numbers, and that the funnel counts *people*
 * rather than events.
 */
describe('Activation funnel (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const savedAdmins = process.env[INSTANCE_ADMIN_EMAILS_ENV];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (savedAdmins === undefined) delete process.env[INSTANCE_ADMIN_EMAILS_ENV];
    else process.env[INSTANCE_ADMIN_EMAILS_ENV] = savedAdmins;
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    delete process.env[INSTANCE_ADMIN_EMAILS_ENV];
  });

  /**
   * Makes `user` the instance operator for the rest of the current test.
   *
   * `InstanceAdminGuard` requires `emailVerified` as well as list membership (a real operator's
   * account has been through mailbox verification), so listing the address is not enough on its
   * own — `confirmEmail` also re-signs the agent in so its session cookie agrees with the
   * database (see its doc comment). The guard's own unit spec covers the denial half of this
   * (`refuses a listed address whose email is not yet verified`); every e2e admin fixture here
   * models the state a real operator is actually in.
   */
  async function asInstanceAdmin(user: TestUser): Promise<void> {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = user.email;
    await confirmEmail(app, prisma, user);
  }

  async function funnel(user: TestUser): Promise<ActivationFunnelDto> {
    const response = await user.agent.get('/instance/activation').expect(200);
    return response.body as ActivationFunnelDto;
  }

  function step(dto: ActivationFunnelDto, event: ActivationEvent): ActivationStepDto {
    const found = dto.steps.find((candidate) => candidate.event === event);
    if (!found) throw new Error(`funnel has no step for ${event}`);
    return found;
  }

  async function userIdOf(user: TestUser): Promise<string> {
    const response = await user.agent.get('/me').expect(200);
    return response.body.id as string;
  }

  /**
   * Waits until at least `count` pings of this kind exist.
   *
   * `UsagePingService.recordQuietly` is deliberately not awaited by the handler that triggers
   * it — that is the property that keeps a metrics table from being able to slow down or fail a
   * board load — so a `200` is not evidence the row is there yet. Every assertion that reads a
   * ping-derived number has to wait for the write it depends on; skipping this passed on a fast
   * developer machine and failed on CI, which is the only interesting kind of flake.
   */
  async function waitForPings(kind: UsagePingKind, count: number): Promise<void> {
    await waitFor(async () => (await prisma.usagePing.count({ where: { kind } })) >= count);
  }

  // ---------------------------------------------------------------------------------------
  // Who may read it
  // ---------------------------------------------------------------------------------------

  /**
   * The default, and the property the whole boundary exists for: on an install where nobody
   * has written `INSTANCE_ADMIN_EMAILS` into `.env`, instance-wide numbers are readable by
   * nobody at all — including the account that owns every workspace on the box.
   *
   * Falsification: make `InstanceAdminGuard.canActivate` return `true` when the list is empty
   * and this test fails with a 200.
   */
  it('is readable by nobody when INSTANCE_ADMIN_EMAILS is unset', async () => {
    const owner = await signUp(app);
    await createWorkspace(owner.agent, 'Solo', 'solo');

    await owner.agent.get('/instance/activation').expect(403);
  });

  /**
   * The PR #188 lesson, applied forwards: a workspace role must never widen what somebody can
   * see beyond their tenant. `OWNER` is the highest role the product has and it buys nothing
   * here, because on an open-registration install anybody can mint themselves one by creating
   * a workspace.
   */
  it('is not readable by a workspace OWNER who is not the instance operator', async () => {
    const operator = await signUp(app);
    const owner = await signUp(app);
    await createWorkspace(owner.agent, 'Not yours', 'notyours');
    await asInstanceAdmin(operator);

    await owner.agent.get('/instance/activation').expect(403);
    await operator.agent.get('/instance/activation').expect(200);
  });

  it('needs a session at all', async () => {
    await request(app.getHttpServer()).get('/instance/activation').expect(401);
  });

  // ---------------------------------------------------------------------------------------
  // The funnel itself
  // ---------------------------------------------------------------------------------------

  /**
   * One person walks the whole of onboarding; a second accepts their invitation. Every
   * assertion below is a step the finding named, in the order the finding named them, and each
   * number is checked *after the act that should have moved it* — a funnel whose steps are only
   * asserted at the end cannot tell "the query is right" from "the query counts everything".
   */
  it('counts all eleven steps from what onboarding already writes', async () => {
    const operator = await signUp(app, { name: 'Operator' });
    await asInstanceAdmin(operator);

    // --- user_registered ---------------------------------------------------------------
    const founder = await signUp(app, { name: 'Founder' });
    const teammate = await signUp(app, { name: 'Teammate' });
    expect(step(await funnel(operator), ActivationEvent.UserRegistered).count).toBe(3);

    // Nobody has done anything yet. The funnel must say so rather than defaulting to the
    // number above — this is the assertion that catches a `COUNT(*)` where a `FILTER` belongs.
    const beforeAnything = await funnel(operator);
    expect(step(beforeAnything, ActivationEvent.WorkspaceCreated).count).toBe(0);
    expect(step(beforeAnything, ActivationEvent.BoardCreated).count).toBe(0);
    expect(step(beforeAnything, ActivationEvent.FirstTaskCreated).count).toBe(0);
    expect(step(beforeAnything, ActivationEvent.FirstDrag).count).toBe(0);
    expect(step(beforeAnything, ActivationEvent.InviteSent).count).toBe(0);
    expect(step(beforeAnything, ActivationEvent.InviteAccepted).count).toBe(0);
    expect(step(beforeAnything, ActivationEvent.DashboardViewed).count).toBe(0);
    expect(step(beforeAnything, ActivationEvent.WauBoardView).count).toBe(0);
    expect(step(beforeAnything, ActivationEvent.TaskCompleted).count).toBe(0);

    // --- workspace_created --------------------------------------------------------------
    const workspace = await createWorkspace(founder.agent, 'Activation', 'activation');
    expect(step(await funnel(operator), ActivationEvent.WorkspaceCreated).count).toBe(1);

    // --- board_created ------------------------------------------------------------------
    const board = await founder.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Launch' })
      .expect(201);
    const boardId = board.body.id as string;
    expect(step(await funnel(operator), ActivationEvent.BoardCreated).count).toBe(1);

    const columns = await founder.agent
      .get(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
      .expect(200);
    const firstColumnId = columns.body[0].id as string;

    // --- first_task_created -------------------------------------------------------------
    const task = await founder.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
      .send({ title: 'Write the README', columnId: firstColumnId })
      .expect(201);
    const taskId = task.body.id as string;
    expect(step(await funnel(operator), ActivationEvent.FirstTaskCreated).count).toBe(1);

    // --- first_drag ---------------------------------------------------------------------
    // A move into a column that is *not* completed: `first_drag` must move, `task_completed`
    // must not. Two steps read the same activity type and only the payload separates them.
    const inProgress = await founder.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
      .send({ name: 'In progress', category: ColumnCategory.STARTED })
      .expect(201);
    await founder.agent
      .patch(`/workspaces/${workspace.id}/tasks/${taskId}/position`)
      .send({ columnId: inProgress.body.id as string })
      .expect(200);

    const afterDrag = await funnel(operator);
    expect(step(afterDrag, ActivationEvent.FirstDrag).count).toBe(1);
    expect(step(afterDrag, ActivationEvent.TaskCompleted).count).toBe(0);

    // --- invite_sent ---------------------------------------------------------------------
    const invitation = await founder.agent
      .post(`/workspaces/${workspace.id}/invitations`)
      .send({ email: teammate.email, role: MemberRole.MEMBER })
      .expect(201);
    expect(step(await funnel(operator), ActivationEvent.InviteSent).count).toBe(1);

    // --- invite_accepted -------------------------------------------------------------
    // The actor on `invitation.accepted` is the invitee, not the inviter (ADR 0013 requires a
    // confirmed address first), so this step counts a *different* person from `invite_sent`.
    await confirmEmail(app, prisma, teammate);
    await teammate.agent
      .post(`/workspaces/${workspace.id}/invitations/${invitation.body.id as string}/accept`)
      .expect(200);
    expect(step(await funnel(operator), ActivationEvent.InviteAccepted).count).toBe(1);

    // --- dashboard_viewed ----------------------------------------------------------------
    // The only two steps whose write the request does not wait for, so the assertion has to.
    // The response returning is not evidence the ping landed — that is the whole design — and
    // reading the funnel straight afterwards is a race this suite lost on CI while passing
    // locally, which is exactly the class of flake `waitForPings` exists to remove.
    await founder.agent.get(`/workspaces/${workspace.id}/dashboard/summary`).expect(200);
    await waitForPings(UsagePingKind.DashboardView, 1);
    expect(step(await funnel(operator), ActivationEvent.DashboardViewed).count).toBe(1);

    // --- wau_board_view -------------------------------------------------------------------
    await founder.agent.get(`/workspaces/${workspace.id}/boards/${boardId}`).expect(200);
    await teammate.agent.get(`/workspaces/${workspace.id}/boards/${boardId}`).expect(200);
    await waitForPings(UsagePingKind.BoardView, 2);
    expect(step(await funnel(operator), ActivationEvent.WauBoardView).count).toBe(2);

    // --- task_completed --------------------------------------------------------------------
    const done = await founder.agent
      .post(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
      .send({ name: 'Shipped', category: ColumnCategory.COMPLETED })
      .expect(201);
    await founder.agent
      .patch(`/workspaces/${workspace.id}/tasks/${taskId}/position`)
      .send({ columnId: done.body.id as string })
      .expect(200);
    expect(step(await funnel(operator), ActivationEvent.TaskCompleted).count).toBe(1);

    // --- smtp_configured ---------------------------------------------------------------
    // Asserted as a contract rather than a value: CI leaves SMTP_HOST unset, a developer
    // running against docker-compose.dev.yml points it at Mailpit, and the same reasoning
    // `config.e2e-spec.ts` documents applies — it must agree with `GET /config`, always.
    const config = await operator.agent.get('/config').expect(200);
    expect(step(await funnel(operator), ActivationEvent.SmtpConfigured).count).toBe(
      config.body.mailEnabled === true ? 1 : 0,
    );
  });

  /**
   * The funnel is a funnel, not a scoreboard.
   *
   * One enthusiastic user creating four boards and eight tasks must not make the instance look
   * like it has more people getting past those steps than it has people. `COUNT(DISTINCT
   * "userId")` is the property, and dropping the `DISTINCT` turns these `1`s into `4` and `8`.
   */
  it('counts distinct people, never events', async () => {
    const operator = await signUp(app);
    await asInstanceAdmin(operator);
    const founder = await signUp(app);
    const workspace = await createWorkspace(founder.agent, 'Busy', 'busy');

    for (let index = 0; index < 4; index += 1) {
      const board = await founder.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .send({ name: `Board ${index}` })
        .expect(201);
      const boardId = board.body.id as string;
      const columns = await founder.agent
        .get(`/workspaces/${workspace.id}/boards/${boardId}/columns`)
        .expect(200);

      for (let card = 0; card < 2; card += 1) {
        await founder.agent
          .post(`/workspaces/${workspace.id}/boards/${boardId}/tasks`)
          .send({ title: `Card ${index}-${card}`, columnId: columns.body[0].id as string })
          .expect(201);
      }

      // Four board views by one person on one day, which must remain one WAU.
      await founder.agent.get(`/workspaces/${workspace.id}/boards/${boardId}`).expect(200);
    }

    await waitForPings(UsagePingKind.BoardView, 1);
    const dto = await funnel(operator);
    expect(step(dto, ActivationEvent.BoardCreated).count).toBe(1);
    expect(step(dto, ActivationEvent.FirstTaskCreated).count).toBe(1);
    expect(step(dto, ActivationEvent.WauBoardView).count).toBe(1);
  });

  /**
   * The dedupe, checked in the table rather than through the funnel — the count above would
   * also pass if the rows were piling up and `DISTINCT` were hiding it. What must not happen is
   * a row per page view: that would be a browsing history, which is the thing `model UsagePing`
   * promises it is not.
   */
  it('stores one usage row per person, workspace, kind and day however often they look', async () => {
    const founder = await signUp(app);
    const workspace = await createWorkspace(founder.agent, 'Repeat', 'repeat');
    const board = await founder.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Board' })
      .expect(201);

    for (let visit = 0; visit < 5; visit += 1) {
      await founder.agent
        .get(`/workspaces/${workspace.id}/boards/${board.body.id as string}`)
        .expect(200);
      await founder.agent.get(`/workspaces/${workspace.id}/dashboard/summary`).expect(200);
    }

    // Both kinds have to have landed before "there are exactly two rows" means anything —
    // waiting for a total of two would be satisfied by two board views and no dashboard one.
    await waitForPings(UsagePingKind.BoardView, 1);
    await waitForPings(UsagePingKind.DashboardView, 1);

    const rows = await prisma.usagePing.findMany();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.kind))).toEqual(
      new Set([UsagePingKind.BoardView, UsagePingKind.DashboardView]),
    );
    for (const row of rows) {
      expect(row.userId).toEqual(expect.any(String));
      expect(row.workspaceId).toBe(workspace.id);
    }
  });

  // ---------------------------------------------------------------------------------------
  // The North Star
  // ---------------------------------------------------------------------------------------

  /**
   * Weekly Active *Team* Workspaces, which is the number the roadmap says this work exists to
   * make measurable for the first time.
   *
   * Four workspaces, one of each kind the metric has to tell apart:
   *
   *  - **solo** — one member, active. A to-do list. Counts as a weekly active workspace and
   *    must not count as a team one.
   *  - **quiet** — two members, nobody active this week. A team on paper only.
   *  - **lonely** — two members, only *one* of them active. The case the metric exists for and
   *    the only one a `>= 1` in place of `>= 2` would let through: it is a workspace that looks
   *    like a team from the member list and is one person's to-do list in practice.
   *  - **team** — two members, both active. The only one that counts.
   *
   * Get the `>= 2 members` and `>= 2 actives` conditions the wrong way round and `solo`,
   * `quiet` or `lonely` leaks into the headline number.
   */
  it('counts a workspace as a weekly active team only when two of its members were active', async () => {
    const operator = await signUp(app);
    await asInstanceAdmin(operator);

    const alone = await signUp(app);
    const soloWorkspace = await createWorkspace(alone.agent, 'Solo', 'solo');
    const soloBoard = await alone.agent
      .post(`/workspaces/${soloWorkspace.id}/boards`)
      .send({ name: 'Mine' })
      .expect(201);
    await alone.agent
      .get(`/workspaces/${soloWorkspace.id}/boards/${soloBoard.body.id as string}`)
      .expect(200);

    const quietOwner = await signUp(app);
    const quietWorkspace = await createWorkspace(quietOwner.agent, 'Quiet', 'quiet');
    const quietMember = await signUp(app);
    await addMember(prisma, quietWorkspace.id, await userIdOf(quietMember), MemberRole.MEMBER);

    // Two members, one of them busy, the other never showing up. The whole point of the "team"
    // in the metric's name is that this does not count.
    const lonelyOwner = await signUp(app);
    const lonelyWorkspace = await createWorkspace(lonelyOwner.agent, 'Lonely', 'lonely');
    const absentee = await signUp(app);
    await addMember(prisma, lonelyWorkspace.id, await userIdOf(absentee), MemberRole.MEMBER);
    const lonelyBoard = await lonelyOwner.agent
      .post(`/workspaces/${lonelyWorkspace.id}/boards`)
      .send({ name: 'Alone together' })
      .expect(201);
    await lonelyOwner.agent
      .get(`/workspaces/${lonelyWorkspace.id}/boards/${lonelyBoard.body.id as string}`)
      .expect(200);

    const lead = await signUp(app);
    const teamWorkspace = await createWorkspace(lead.agent, 'Team', 'team');
    const engineer = await signUp(app);
    await addMember(prisma, teamWorkspace.id, await userIdOf(engineer), MemberRole.MEMBER);
    const teamBoard = await lead.agent
      .post(`/workspaces/${teamWorkspace.id}/boards`)
      .send({ name: 'Roadmap' })
      .expect(201);
    // One member writes, the other only looks — the union of the two traces is exactly why
    // `UsagePing` exists, and why a `Activity`-only metric would report this team as dead.
    await engineer.agent
      .get(`/workspaces/${teamWorkspace.id}/boards/${teamBoard.body.id as string}`)
      .expect(200);

    await waitForPings(UsagePingKind.BoardView, 3);

    const { northStar } = await funnel(operator);
    expect(northStar).toEqual({
      // `team` only. `lonely` has the members and half the activity, and is the reason this is
      // not simply "workspaces with two members that saw any activity".
      weeklyActiveTeamWorkspaces: 1,
      // `solo`, `lonely` and `team` saw activity; `quiet` has members but no traces at all.
      weeklyActiveWorkspaces: 3,
      teamWorkspaces: 3,
      windowDays: ACTIVATION_WINDOW_DAYS,
    });
  });

  /**
   * Activity that happened before the window must not keep a workspace looking alive — the
   * "weekly" in the metric's name is the whole of its value. Backdated in the database because
   * the alternative is a test that waits eight days.
   */
  it('drops a team out of the weekly count once its traces age past the window', async () => {
    const operator = await signUp(app);
    await asInstanceAdmin(operator);
    const lead = await signUp(app);
    const workspace = await createWorkspace(lead.agent, 'Stale', 'stale');
    const engineer = await signUp(app);
    await addMember(prisma, workspace.id, await userIdOf(engineer), MemberRole.MEMBER);
    const board = await lead.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Old' })
      .expect(201);
    await engineer.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id as string}`)
      .expect(200);

    await waitForPings(UsagePingKind.BoardView, 1);
    expect((await funnel(operator)).northStar.weeklyActiveTeamWorkspaces).toBe(1);

    const longAgo = new Date(Date.now() - (ACTIVATION_WINDOW_DAYS + 3) * 24 * 60 * 60 * 1000);
    await prisma.activity.updateMany({ data: { createdAt: longAgo } });
    await prisma.usagePing.updateMany({ data: { day: longAgo } });

    const { northStar } = await funnel(operator);
    expect(northStar.weeklyActiveTeamWorkspaces).toBe(0);
    expect(northStar.weeklyActiveWorkspaces).toBe(0);
    // Membership is not a trace, so the ceiling is unchanged — which is the context that stops
    // a zero being read as "we lost the team".
    expect(northStar.teamWorkspaces).toBe(1);
  });

  /**
   * A workspace kept alive by somebody who has left is not an active team. `member.removed`
   * deliberately does not delete `Activity` rows — that is the audit trail's whole point — so
   * without the join back to *current* membership those traces would count forever.
   *
   * Three members on purpose: the leaver has to be removable while the workspace still has two
   * members afterwards. With only two, removing one drops the workspace below the "team"
   * threshold and the count goes to zero for a reason that has nothing to do with the join —
   * which is exactly how this test failed to catch a `LEFT JOIN` in place of the `INNER JOIN`
   * when it was first written. Here, after the removal the workspace still has two members and
   * only one of them is active, so the join is the only thing standing between 1 and 0.
   */
  it('ignores traces left by people who are no longer members', async () => {
    const operator = await signUp(app);
    await asInstanceAdmin(operator);
    const lead = await signUp(app);
    const workspace = await createWorkspace(lead.agent, 'Departed', 'departed');
    const quiet = await signUp(app);
    await addMember(prisma, workspace.id, await userIdOf(quiet), MemberRole.MEMBER);
    const leaver = await signUp(app);
    const leaverId = await userIdOf(leaver);
    await addMember(prisma, workspace.id, leaverId, MemberRole.MEMBER);
    // `lead` writes (creating the board) and `leaver` reads — two active members, one team.
    const board = await lead.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Shared' })
      .expect(201);
    await leaver.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id as string}`)
      .expect(200);

    await waitForPings(UsagePingKind.BoardView, 1);
    expect((await funnel(operator)).northStar.weeklyActiveTeamWorkspaces).toBe(1);

    await lead.agent.delete(`/workspaces/${workspace.id}/members/${leaverId}`).expect(204);

    const { northStar } = await funnel(operator);
    expect(northStar.weeklyActiveTeamWorkspaces).toBe(0);
    // Still two members, so it is still a team workspace on paper — the ceiling is unchanged
    // and only the activity count moved. That is what makes this test about the join.
    expect(northStar.teamWorkspaces).toBe(1);
    expect(northStar.weeklyActiveWorkspaces).toBe(1);
  });

  // ---------------------------------------------------------------------------------------
  // The document
  // ---------------------------------------------------------------------------------------

  /**
   * The web funnel renders `steps` in the order it receives them and labels each one from its
   * `event`, so the contract is the list, the order and the units — not just the numbers.
   */
  it('returns every declared step exactly once, in the declared order, with its unit', async () => {
    const operator = await signUp(app);
    await asInstanceAdmin(operator);

    const dto = await funnel(operator);

    expect(dto.steps.map((entry) => entry.event)).toEqual([...ACTIVATION_EVENTS]);
    expect(dto.steps).toHaveLength(11);
    expect(Date.parse(dto.generatedAt)).not.toBeNaN();

    // Exactly one step is not a headcount, and the payload has to say which — a reader who
    // subtracts across `smtp_configured` gets a number that means nothing.
    const instanceSteps = dto.steps.filter((entry) => entry.unit === 'instance');
    expect(instanceSteps.map((entry) => entry.event)).toEqual([ActivationEvent.SmtpConfigured]);

    const windowed = dto.steps.filter((entry) => entry.window === 'rolling-week');
    expect(windowed.map((entry) => entry.event)).toEqual([ActivationEvent.WauBoardView]);
  });
});

/**
 * Waits for a fire-and-forget insert to land.
 *
 * The usage pings are deliberately not awaited by the handler that triggers them, so a spec
 * that reads the table immediately after the response is racing the insert. Polling a
 * condition is the honest way to wait for one: a fixed `sleep` is either flaky on a loaded
 * machine or slow on every run.
 */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for a usage ping to be written');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
