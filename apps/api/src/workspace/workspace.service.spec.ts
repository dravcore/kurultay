import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ActivityType, MemberRole } from '@kurul/shared-types';
import { APIError } from 'better-auth/api';
import type { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { auth } from '../auth/auth';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService, type WorkspaceDeletedLogLine } from './workspace.service';

// `auth.ts` opens a Postgres pool and demands DATABASE_URL / BETTER_AUTH_SECRET at import
// time, so the whole module is replaced — these tests are about what the service does with
// the plugin's answers, not about the plugin.
jest.mock('../auth/auth', () => ({
  auth: {
    api: {
      createOrganization: jest.fn(),
      updateOrganization: jest.fn(),
      deleteOrganization: jest.fn(),
    },
  },
}));

const api = auth.api as unknown as {
  createOrganization: jest.Mock;
  updateOrganization: jest.Mock;
  deleteOrganization: jest.Mock;
};

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d5a';
interface PrismaStub {
  workspace: { findUnique: jest.Mock; findFirst: jest.Mock };
  workspaceMember: { findMany: jest.Mock; findUnique: jest.Mock };
  /** `create` refuses a session belonging to a deleted account — see `common/deleted-account.ts`. */
  user: { findUnique: jest.Mock };
}

interface ActivityStub {
  record: jest.Mock;
}

function buildService(): {
  service: WorkspaceService;
  prisma: PrismaStub;
  activityService: ActivityStub;
} {
  const prisma: PrismaStub = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    // A live account by default; the deleted case has its own test below.
    user: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
  };
  const activityService: ActivityStub = {
    record: jest.fn().mockResolvedValue({ id: 'activity' }),
  };

  return {
    service: new WorkspaceService(
      prisma as unknown as PrismaService,
      activityService as unknown as ActivityService,
    ),
    prisma,
    activityService,
  };
}

const request = { headers: {} } as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WorkspaceService Better Auth error mapping', () => {
  it('maps a 401 from createOrganization to 401, not 400', async () => {
    const { service } = buildService();
    api.createOrganization.mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'session expired at handler 12' }),
    );

    const thrown = await service
      .create('usr_1', { name: 'WS', slug: 'ws' }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).message).toBe('Failed to create workspace');
  });

  it('still answers 409 when Better Auth loses the slug race', async () => {
    const { service } = buildService();
    api.createOrganization.mockRejectedValue(
      new APIError('BAD_REQUEST', {
        message: 'Organization already exists',
        code: 'ORGANIZATION_ALREADY_EXISTS',
      }),
    );

    const thrown = await service
      .create('usr_1', { name: 'WS', slug: 'ws' }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).message).toBe('Workspace slug already taken');
  });

  // `/organization/update` reports the clash under its own code, not the one `create` uses.
  it('answers 409 when updateOrganization loses the slug race', async () => {
    const { service } = buildService();
    api.updateOrganization.mockRejectedValue(
      new APIError('BAD_REQUEST', {
        message: 'Organization slug already taken',
        code: 'ORGANIZATION_SLUG_ALREADY_TAKEN',
      }),
    );

    const thrown = await service
      .update(WORKSPACE_ID, ACTOR_ID, { slug: 'taken' }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).message).toBe('Workspace slug already taken');
  });

  it('maps a 404 from updateOrganization to 404', async () => {
    const { service } = buildService();
    api.updateOrganization.mockRejectedValue(
      new APIError('NOT_FOUND', { message: 'organization row missing' }),
    );

    const thrown = await service
      .update(WORKSPACE_ID, ACTOR_ID, { name: 'Renamed' }, request)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect((thrown as NotFoundException).message).toBe('Workspace not found');
  });

  it('rethrows an unknown failure from deleteOrganization', async () => {
    const { service } = buildService();
    const failure = new Error('pool drained');
    api.deleteOrganization.mockRejectedValue(failure);

    await expect(service.remove(WORKSPACE_ID, ACTOR_ID, request)).rejects.toBe(failure);
  });
});

describe('WorkspaceService.listForUser', () => {
  it('maps each membership to the workspace it belongs to, oldest join first', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        workspace: {
          id: WORKSPACE_ID,
          name: 'Acme',
          slug: 'acme',
          createdAt: new Date('2026-01-01'),
        },
      },
      {
        workspace: {
          id: 'other-workspace',
          name: 'Other',
          slug: 'other',
          createdAt: new Date('2026-02-01'),
        },
      },
    ]);

    const workspaces = await service.listForUser(ACTOR_ID);

    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
      where: { userId: ACTOR_ID },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(workspaces).toEqual([
      { id: WORKSPACE_ID, name: 'Acme', slug: 'acme', createdAt: '2026-01-01T00:00:00.000Z' },
      {
        id: 'other-workspace',
        name: 'Other',
        slug: 'other',
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ]);
  });

  it('returns an empty list for a user with no memberships', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceMember.findMany.mockResolvedValue([]);

    await expect(service.listForUser(ACTOR_ID)).resolves.toEqual([]);
  });
});

describe('WorkspaceService.create', () => {
  it('refuses a slug already taken, without ever calling Better Auth', async () => {
    const { service, prisma } = buildService();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'existing', slug: 'acme' });

    await expect(
      service.create(ACTOR_ID, { name: 'Acme', slug: 'acme' }, request),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(api.createOrganization).not.toHaveBeenCalled();
  });

  it('creates the workspace when the slug is free', async () => {
    const { service, prisma } = buildService();
    prisma.workspace.findUnique.mockResolvedValue(null);
    api.createOrganization.mockResolvedValue({
      id: WORKSPACE_ID,
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date('2026-01-01'),
    });

    const created = await service.create(ACTOR_ID, { name: 'Acme', slug: 'acme' }, request);

    expect(api.createOrganization).toHaveBeenCalledWith({
      body: { name: 'Acme', slug: 'acme', keepCurrentActiveOrganization: false },
      headers: expect.any(Headers),
    });
    expect(created).toEqual({
      id: WORKSPACE_ID,
      name: 'Acme',
      slug: 'acme',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('rejects a plugin response with no organization, rather than returning an empty workspace', async () => {
    const { service, prisma } = buildService();
    prisma.workspace.findUnique.mockResolvedValue(null);
    api.createOrganization.mockResolvedValue(null);

    await expect(
      service.create(ACTOR_ID, { name: 'Acme', slug: 'acme' }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * The one window ADR 0026 leaves open, closed at the one place it matters.
   *
   * An account deleted by an instance administrator keeps a working session cookie for up to
   * 60 seconds, because Better Auth's `session.cookieCache` answers without a database read.
   * Every workspace-scoped route already answers `404` in that window — the memberships are
   * gone — and this is the write that would hand the tombstone a fresh one, as the sole OWNER
   * of a live tenant.
   */
  it('refuses to create a workspace for an account that has been deleted', async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValue({ deletedAt: new Date('2026-08-15') });

    await expect(
      service.create(ACTOR_ID, { name: 'Acme', slug: 'acme' }, request),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // Refused before Better Auth is asked to create anything, so there is no organization to
    // clean up after: the check is a gate, not a compensating action.
    expect(api.createOrganization).not.toHaveBeenCalled();
  });
});

describe('WorkspaceService.getById', () => {
  it('returns the workspace when it exists', async () => {
    const { service, prisma } = buildService();
    prisma.workspace.findUnique.mockResolvedValue({
      id: WORKSPACE_ID,
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date('2026-01-01'),
    });

    await expect(service.getById(WORKSPACE_ID)).resolves.toEqual({
      id: WORKSPACE_ID,
      name: 'Acme',
      slug: 'acme',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('404s when the workspace does not exist', async () => {
    const { service, prisma } = buildService();
    prisma.workspace.findUnique.mockResolvedValue(null);

    await expect(service.getById(WORKSPACE_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkspaceService.update slug uniqueness pre-check', () => {
  it('refuses a slug already used by another workspace, without calling Better Auth', async () => {
    const { service, prisma } = buildService();
    prisma.workspace.findFirst.mockResolvedValue({ id: 'clash' });

    await expect(
      service.update(WORKSPACE_ID, ACTOR_ID, { slug: 'taken' }, request),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.workspace.findFirst).toHaveBeenCalledWith({
      where: { slug: 'taken', NOT: { id: WORKSPACE_ID } },
    });
    expect(api.updateOrganization).not.toHaveBeenCalled();
  });

  it('rejects a plugin response with no organization, rather than returning an empty workspace', async () => {
    const { service } = buildService();
    api.updateOrganization.mockResolvedValue(null);

    await expect(
      service.update(WORKSPACE_ID, ACTOR_ID, { name: 'Renamed' }, request),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkspaceService audit trail', () => {
  it('records a slug change with the value it replaced', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.workspace.findUnique.mockResolvedValue({ name: 'Acme', slug: 'acme' });
    api.updateOrganization.mockResolvedValue({
      id: WORKSPACE_ID,
      name: 'Acme',
      slug: 'acme-2',
      createdAt: new Date('2026-01-01'),
    });

    await service.update(WORKSPACE_ID, ACTOR_ID, { slug: 'acme-2' }, request);

    // Every invitation link in circulation is built from the slug, so the old value is the
    // half of this record that matters.
    expect(activityService.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: ACTOR_ID,
        type: ActivityType.WorkspaceUpdated,
        payload: expect.objectContaining({
          changes: { slug: { from: 'acme', to: 'acme-2' } },
        }),
      }),
    );
  });

  it('writes no entry when the update is refused', async () => {
    const { service, activityService } = buildService();
    api.updateOrganization.mockRejectedValue(
      new APIError('NOT_FOUND', { message: 'organization row missing' }),
    );

    await expect(
      service.update(WORKSPACE_ID, ACTOR_ID, { name: 'Renamed' }, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(activityService.record).not.toHaveBeenCalled();
  });

  it('logs the deletion instead of writing an activity row the cascade would eat', async () => {
    const { service, prisma, activityService } = buildService();
    prisma.workspace.findUnique.mockResolvedValue({
      name: 'Acme',
      slug: 'acme',
      _count: { members: 41, boards: 9 },
    });
    api.deleteOrganization.mockResolvedValue(undefined);
    const lines: string[] = [];
    service.setLogWriter((line) => lines.push(line));

    await service.remove(WORKSPACE_ID, ACTOR_ID, request);

    // `Activity.workspaceId` cascades, so a row here would delete itself. The JSON line is the
    // only record that can outlive the tenant — asserted after a round trip through
    // `JSON.stringify`, because that string is what a log aggregator actually receives.
    expect(activityService.record).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!) as WorkspaceDeletedLogLine;
    expect(line).toMatchObject({
      level: 'warn',
      event: 'workspace.deleted',
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      name: 'Acme',
      slug: 'acme',
      // The size of what was destroyed, read before the delete because nothing can count it
      // afterwards.
      memberCount: 41,
      boardCount: 9,
    });
    expect(Date.parse(line.ts)).not.toBeNaN();
  });

  it('does not log a deletion that never happened', async () => {
    const { service, prisma } = buildService();
    prisma.workspace.findUnique.mockResolvedValue({
      name: 'Acme',
      slug: 'acme',
      _count: { members: 1, boards: 0 },
    });
    api.deleteOrganization.mockRejectedValue(
      new APIError('NOT_FOUND', { message: 'organization row missing' }),
    );
    const lines: string[] = [];
    service.setLogWriter((line) => lines.push(line));

    await expect(service.remove(WORKSPACE_ID, ACTOR_ID, request)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(lines).toEqual([]);
  });
});

interface MemberRow {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  user: { name: string; avatarUrl: string | null };
}

/**
 * Ids that sort the way UUIDv7 does: the suffix counts up with join order, so a lexical
 * `id > cursor` walk over these rows is the same walk Postgres does over real ones.
 */
function memberRow(index: number, workspaceId = WORKSPACE_ID): MemberRow {
  const suffix = String(index).padStart(12, '0');
  return {
    id: `0198e2c0-9a1b-7f04-8c3d-${suffix}`,
    workspaceId,
    userId: `user-${suffix}`,
    role: MemberRole.MEMBER,
    user: { name: `Member ${index}`, avatarUrl: null },
  };
}

/** Stands in for Postgres: honours `where.id.gt`, `orderBy id asc` and `take`. */
function stubRoster(prisma: PrismaStub, rows: MemberRow[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  prisma.workspaceMember.findMany.mockImplementation(
    (args: { where: { workspaceId: string; id?: { gt: string } }; take: number }) => {
      const after = args.where.id?.gt;
      const matching = sorted.filter(
        (row) => row.workspaceId === args.where.workspaceId && (!after || row.id > after),
      );
      return Promise.resolve(matching.slice(0, args.take));
    },
  );
}

describe('WorkspaceService.listMembers', () => {
  it('walks by id and over-fetches one row to answer hasMore', async () => {
    const { service, prisma } = buildService();
    stubRoster(prisma, [memberRow(1), memberRow(2), memberRow(3)]);

    const page = await service.listMembers(WORKSPACE_ID, { limit: 2 });

    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID },
        orderBy: { id: 'asc' },
        take: 3,
      }),
    );
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(page.items[1]?.id);
  });

  it('scopes the cursor to the workspace and reads past it', async () => {
    const { service, prisma } = buildService();
    stubRoster(prisma, [memberRow(1), memberRow(2)]);
    const cursor = memberRow(1).id;

    const page = await service.listMembers(WORKSPACE_ID, { limit: 50, cursor });

    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, id: { gt: cursor } },
      }),
    );
    expect(page.items.map((member) => member.id)).toEqual([memberRow(2).id]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('closes the last page instead of dangling a cursor', async () => {
    const { service, prisma } = buildService();
    stubRoster(prisma, [memberRow(1)]);

    const page = await service.listMembers(WORKSPACE_ID, { limit: 50 });

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  /**
   * The regression this endpoint exists for: the old `take: 1000` returned members 1..1000
   * and silently pretended the rest were not there. Draining the cursor must reach all of
   * them, once each.
   */
  it('reaches every member of a workspace larger than the old 1000-row cap', async () => {
    const { service, prisma } = buildService();
    const total = 1500;
    stubRoster(
      prisma,
      Array.from({ length: total }, (_, index) => memberRow(index + 1)),
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page: Awaited<ReturnType<typeof service.listMembers>> = await service.listMembers(
        WORKSPACE_ID,
        { limit: 100, cursor },
      );
      seen.push(...page.items.map((member) => member.userId));
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen[0]).toBe(memberRow(1).userId);
    expect(seen[total - 1]).toBe(memberRow(total).userId);
  });

  it('leaves another workspace out of the page', async () => {
    const { service, prisma } = buildService();
    stubRoster(prisma, [memberRow(1), memberRow(2, 'other-workspace')]);

    const page = await service.listMembers(WORKSPACE_ID, { limit: 50 });

    expect(page.items.map((member) => member.workspaceId)).toEqual([WORKSPACE_ID]);
  });
});

describe('WorkspaceService.getMembership', () => {
  it("reads the caller's own row instead of the roster", async () => {
    const { service, prisma } = buildService();
    const row = memberRow(7);
    prisma.workspaceMember.findUnique.mockResolvedValue(row);

    const member = await service.getMembership(WORKSPACE_ID, row.userId);

    expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: row.userId } },
      }),
    );
    expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled();
    expect(member).toEqual({
      id: row.id,
      workspaceId: WORKSPACE_ID,
      userId: row.userId,
      role: MemberRole.MEMBER,
      name: row.user.name,
      avatarUrl: null,
    });
  });

  it('404s when the user is not a member', async () => {
    const { service } = buildService();

    await expect(service.getMembership(WORKSPACE_ID, 'stranger')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
