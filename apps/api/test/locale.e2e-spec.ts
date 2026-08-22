import { INestApplication } from '@nestjs/common';
import { MemberRole } from '@kurul/shared-types';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The locale preference end to end: stored on the user, exposed on `/me`, and consumed by the
 * two things ADR 0018 lets the API be locale-aware about — content it writes on the user's
 * behalf, and the bulk column seed.
 */
describe('Locale preference (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('GET/PATCH /me', () => {
    it('starts null, because a fresh account has not chosen a language', async () => {
      const user = await signUp(app);

      // Null is not English: an unset user follows Accept-Language, and seeding the column
      // with 'en' at sign-up would make that link of the chain unreachable.
      await user.agent
        .get('/me')
        .expect(200)
        .expect(({ body }) => expect(body.locale).toBeNull());
    });

    it('stores a chosen language and reports it back immediately', async () => {
      const user = await signUp(app);

      await user.agent
        .patch('/me')
        .send({ locale: 'en' })
        .expect(200)
        .expect(({ body }) => expect(body.locale).toBe('en'));

      // Read back on a fresh request: Better Auth caches the session user in a cookie for
      // 60 seconds, so a locale served off the session would still say null here.
      await user.agent
        .get('/me')
        .expect(200)
        .expect(({ body }) => expect(body.locale).toBe('en'));
    });

    it('clears the preference back to following the browser', async () => {
      const user = await signUp(app);
      await user.agent.patch('/me').send({ locale: 'en' }).expect(200);

      await user.agent
        .patch('/me')
        .send({ locale: null })
        .expect(200)
        .expect(({ body }) => expect(body.locale).toBeNull());
    });

    it('leaves the stored value alone when the field is omitted', async () => {
      const user = await signUp(app);
      await user.agent.patch('/me').send({ locale: 'en' }).expect(200);

      await user.agent
        .patch('/me')
        .send({})
        .expect(200)
        .expect(({ body }) => expect(body.locale).toBe('en'));
    });

    it('rejects a language the app does not ship', async () => {
      const user = await signUp(app);

      // The column has no CHECK constraint by design, so the DTO is the only thing keeping
      // an unloadable tag out of the database.
      await user.agent.patch('/me').send({ locale: 'zz' }).expect(400);
      await user.agent.patch('/me').send({ locale: 'en-GB' }).expect(400);
    });

    it('rejects a field the endpoint does not accept', async () => {
      const user = await signUp(app);

      // `forbidNonWhitelisted` — a client must not be able to reach `email` through here.
      await user.agent.patch('/me').send({ email: 'attacker@example.com' }).expect(400);
    });

    it('refuses an unauthenticated write', async () => {
      const { default: request } = await import('supertest');
      await request(app.getHttpServer()).patch('/me').send({ locale: 'en' }).expect(401);
    });
  });

  describe('board seeding', () => {
    it('names a new board’s columns in the creator’s language', async () => {
      const owner = await signUp(app);
      const workspace = await createWorkspace(owner.agent, 'Seed', `seed-${Date.now()}`);
      await owner.agent.patch('/me').send({ locale: 'en' }).expect(200);

      const board = await owner.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .set('Accept-Language', 'zz')
        .send({ name: 'Product' })
        .expect(201);

      const columns = await owner.agent
        .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
        .expect(200);

      // The stored preference outranks the header — the header is only the fallback for a
      // user who never chose.
      expect(columns.body.map((column: { name: string }) => column.name)).toEqual([
        'To Do',
        'In Progress',
        'Done',
      ]);
    });

    it('falls back to Accept-Language for a user who never chose', async () => {
      const owner = await signUp(app);
      const workspace = await createWorkspace(owner.agent, 'Header', `header-${Date.now()}`);

      const board = await owner.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .set('Accept-Language', 'en-GB,en;q=0.9')
        .send({ name: 'Product' })
        .expect(201);

      const columns = await owner.agent
        .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
        .expect(200);

      expect(columns.body.map((column: { name: string }) => column.name)).toEqual([
        'To Do',
        'In Progress',
        'Done',
      ]);
    });
  });

  describe('POST boards/:boardId/columns/defaults', () => {
    async function emptyBoard(
      agent: ReturnType<typeof signUp> extends Promise<infer U> ? U : never,
    ) {
      const workspace = await createWorkspace(agent.agent, 'Defaults', `def-${Date.now()}`);
      const board = await agent.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .send({ name: 'Product' })
        .expect(201);

      const columns = await agent.agent
        .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
        .expect(200);
      for (const column of columns.body as { id: string }[]) {
        await agent.agent.delete(`/workspaces/${workspace.id}/columns/${column.id}`).expect(204);
      }

      return { workspaceId: workspace.id as string, boardId: board.body.id as string };
    }

    it('seeds the whole set in one request, with categories intact', async () => {
      const owner = await signUp(app);
      const { workspaceId, boardId } = await emptyBoard(owner);

      const seeded = await owner.agent
        .post(`/workspaces/${workspaceId}/boards/${boardId}/columns/defaults`)
        .expect(201);

      expect(
        seeded.body.map((column: { name: string; category: string; position: number }) => ({
          name: column.name,
          category: column.category,
          position: column.position,
        })),
      ).toEqual([
        { name: 'To Do', category: 'UNSTARTED', position: 1000 },
        { name: 'In Progress', category: 'STARTED', position: 2000 },
        // ADR 0019: the dashboard reads the category, so a translated Done column still
        // counts. Seeding must not be the thing that breaks that.
        { name: 'Done', category: 'COMPLETED', position: 3000 },
      ]);
      expect(seeded.body.every((column: { taskCount: number }) => column.taskCount === 0)).toBe(
        true,
      );
    });

    it('lists the same columns it returned', async () => {
      const owner = await signUp(app);
      const { workspaceId, boardId } = await emptyBoard(owner);

      const seeded = await owner.agent
        .post(`/workspaces/${workspaceId}/boards/${boardId}/columns/defaults`)
        .expect(201);
      const listed = await owner.agent
        .get(`/workspaces/${workspaceId}/boards/${boardId}/columns`)
        .expect(200);

      expect(listed.body).toEqual(seeded.body);
    });

    it('refuses a second seed rather than doubling the columns', async () => {
      const owner = await signUp(app);
      const { workspaceId, boardId } = await emptyBoard(owner);

      await owner.agent
        .post(`/workspaces/${workspaceId}/boards/${boardId}/columns/defaults`)
        .expect(201);
      await owner.agent
        .post(`/workspaces/${workspaceId}/boards/${boardId}/columns/defaults`)
        .expect(409);

      const listed = await owner.agent
        .get(`/workspaces/${workspaceId}/boards/${boardId}/columns`)
        .expect(200);
      expect(listed.body).toHaveLength(3);
    });

    it('refuses a board that still has its original columns', async () => {
      const owner = await signUp(app);
      const workspace = await createWorkspace(owner.agent, 'Fresh', `fresh-${Date.now()}`);
      const board = await owner.agent
        .post(`/workspaces/${workspace.id}/boards`)
        .send({ name: 'Product' })
        .expect(201);

      await owner.agent
        .post(`/workspaces/${workspace.id}/boards/${board.body.id}/columns/defaults`)
        .expect(409);
    });

    it('gates on the same roles as creating a single column', async () => {
      const owner = await signUp(app, { name: 'Owner' });
      const member = await signUp(app, { name: 'Member' });
      const guest = await signUp(app, { name: 'Guest' });
      const { workspaceId, boardId } = await emptyBoard(owner);

      const memberMe = await member.agent.get('/me').expect(200);
      const guestMe = await guest.agent.get('/me').expect(200);
      await addMember(prisma, workspaceId, memberMe.body.id as string, MemberRole.MEMBER);
      await addMember(prisma, workspaceId, guestMe.body.id as string, MemberRole.GUEST);

      // MEMBER cannot create a column, so it must not be able to create three.
      await member.agent
        .post(`/workspaces/${workspaceId}/boards/${boardId}/columns/defaults`)
        .expect(403);
      await guest.agent
        .post(`/workspaces/${workspaceId}/boards/${boardId}/columns/defaults`)
        .expect(403);
    });

    it('returns 404 across tenants, without revealing the board exists', async () => {
      const ownerA = await signUp(app, { name: 'Owner A' });
      const ownerB = await signUp(app, { name: 'Owner B' });
      const { boardId } = await emptyBoard(ownerA);
      const workspaceB = await createWorkspace(ownerB.agent, 'B', `b-${Date.now()}`);

      await ownerB.agent
        .post(`/workspaces/${workspaceB.id}/boards/${boardId}/columns/defaults`)
        .expect(404);
    });
  });
});
