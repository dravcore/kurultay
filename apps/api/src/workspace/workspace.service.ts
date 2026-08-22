import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType } from '@kurul/shared-types';
import type { CursorPage, WorkspaceDto, WorkspaceMemberDto } from '@kurul/shared-types';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { auth } from '../auth/auth';
import { betterAuthErrorCode, rethrowBetterAuthError } from '../auth/better-auth-error';
import { assertAccountNotDeleted } from '../common/deleted-account';
import { fieldChanges } from '../common/field-changes';
import { stdoutWriter, type LogWriter } from '../common/logging/json-log';
import { toCursorPage } from '../common/pagination/cursor-page';
import { MAX_PAGE_LIMIT } from '../common/pagination/page-limit';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkspaceDto } from './dto/create-workspace.dto';
import type { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import type { WorkspaceMemberQueryDto } from './dto/workspace-member-query.dto';
import { memberInclude, toMemberDto } from './workspace-member.mapper';

/**
 * The Better Auth organization codes that mean "this slug is already in use".
 *
 * The plugin does not use one code for both routes: `/organization/create` reports
 * `ORGANIZATION_ALREADY_EXISTS`, while `/organization/update` reports
 * `ORGANIZATION_SLUG_ALREADY_TAKEN` (a uniqueness check the route only grew in
 * better-auth 1.6). Both are the same uniqueness violation to us, and
 * `docs/api-conventions.md` answers that with a `409`, so both are matched here.
 */
/**
 * The audit record of a workspace deletion, as a log aggregator receives it.
 *
 * Deliberately *not* an `ActivityType`: that constant is the set of values written to
 * `Activity.type`, and this event is never written there — see `WorkspaceService.remove` for
 * why it cannot be. It goes down the same JSON-line transport the access log and the retention
 * sweep use (`common/logging/json-log.ts`), so `docker logs | jq 'select(.event ==
 * "workspace.deleted")'` reads it without a regex, exactly as `type = ANY(...)` reads the rest
 * of the trail out of Postgres.
 *
 * `warn`, not `info`: this is the one line in the file whose absence cannot be noticed later,
 * because the tenant it describes no longer exists to be compared against.
 */
export interface WorkspaceDeletedLogLine {
  ts: string;
  level: 'warn';
  event: 'workspace.deleted';
  workspaceId: string;
  actorId: string;
  /** Null only if the row vanished between the pre-read and the delete. */
  name: string | null;
  slug: string | null;
  memberCount: number | null;
  boardCount: number | null;
}

const SLUG_CONFLICT_CODES = new Set([
  'ORGANIZATION_ALREADY_EXISTS',
  'ORGANIZATION_SLUG_ALREADY_TAKEN',
]);

/** True when the failure is Better Auth reporting a slug uniqueness violation. */
function isSlugConflict(error: unknown): boolean {
  const code = betterAuthErrorCode(error);
  return code !== undefined && SLUG_CONFLICT_CODES.has(code);
}

@Injectable()
export class WorkspaceService {
  /**
   * Test seam, matching `CleanupWorker`: production writes the JSON line to stdout, the spec
   * swaps in a collector so it can assert on what an aggregator would actually receive. Not a
   * constructor parameter because Nest resolves those by type and a function type has no
   * provider to resolve to.
   */
  private write: LogWriter = stdoutWriter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  /** @internal — for tests. */
  setLogWriter(write: LogWriter): void {
    this.write = write;
  }

  private headersFrom(request: Request): Headers {
    return fromNodeHeaders(request.headers);
  }

  private toWorkspaceDto(row: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
  }): WorkspaceDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listForUser(userId: string): Promise<WorkspaceDto[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => this.toWorkspaceDto(m.workspace));
  }

  /**
   * Creates a workspace, with the caller as its OWNER.
   *
   * The deleted-account check is the reason `userId` is no longer unused. This is one of the
   * two writes in the API that are not workspace-scoped, and it is the dangerous one: an
   * account deleted by an instance administrator keeps a working session cookie for up to 60
   * seconds (Better Auth's `session.cookieCache` answers without a database read), and creating
   * a workspace is the one thing in that window that would give the tombstone a membership
   * again — an anonymised row with no credentials, sitting as the sole owner of a live tenant.
   * See `common/deleted-account.ts` for why the check is here rather than in `SessionAuthGuard`.
   */
  async create(userId: string, dto: CreateWorkspaceDto, request: Request): Promise<WorkspaceDto> {
    await assertAccountNotDeleted(this.prisma, userId);

    const existing = await this.prisma.workspace.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('Workspace slug already taken');
    }

    try {
      const created = await auth.api.createOrganization({
        body: {
          name: dto.name,
          slug: dto.slug,
          keepCurrentActiveOrganization: false,
        },
        headers: this.headersFrom(request),
      });

      if (!created) {
        throw new BadRequestException('Failed to create workspace');
      }

      return this.toWorkspaceDto({
        id: created.id,
        name: created.name,
        slug: created.slug,
        createdAt: new Date(created.createdAt),
      });
    } catch (error) {
      // The Prisma pre-check above catches the ordinary case; this covers the race where
      // the slug is taken between that read and the write. Better Auth reports it as a
      // `400`, but `docs/api-conventions.md` makes a uniqueness violation a `409`.
      if (isSlugConflict(error)) {
        throw new ConflictException('Workspace slug already taken');
      }
      rethrowBetterAuthError(error, 'Failed to create workspace');
    }
  }

  async getById(workspaceId: string): Promise<WorkspaceDto> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return this.toWorkspaceDto(workspace);
  }

  async update(
    workspaceId: string,
    actorId: string,
    dto: UpdateWorkspaceDto,
    request: Request,
  ): Promise<WorkspaceDto> {
    // Read before the write, because the plugin only ever hands back the new values. The slug
    // is what every invitation link and bookmark in circulation is built from, so "who changed
    // it, and away from what" is the question this row has to answer.
    const before = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, slug: true },
    });

    if (dto.slug !== undefined) {
      const clash = await this.prisma.workspace.findFirst({
        where: { slug: dto.slug, NOT: { id: workspaceId } },
      });
      if (clash) {
        throw new ConflictException('Workspace slug already taken');
      }
    }

    try {
      const updated = await auth.api.updateOrganization({
        body: {
          organizationId: workspaceId,
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          },
        },
        headers: this.headersFrom(request),
      });

      if (!updated) {
        throw new NotFoundException('Workspace not found');
      }

      // After the plugin call, not before: Better Auth owns this write (ADR 0004) and there is
      // no transaction spanning the two, so recording first would leave an entry describing a
      // rename that the uniqueness check downstream refused.
      await this.activityService.record(this.prisma, {
        workspaceId,
        userId: actorId,
        type: ActivityType.WorkspaceUpdated,
        payload: {
          name: updated.name,
          slug: updated.slug,
          // `before` is null only if the workspace vanished between the read above and here,
          // in which case the plugin would have failed; an empty change set is the honest
          // answer rather than a fabricated `from`.
          changes: before ? fieldChanges(before, updated, ['name', 'slug']) : {},
        },
      });

      return this.toWorkspaceDto({
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        createdAt: new Date(updated.createdAt),
      });
    } catch (error) {
      if (isSlugConflict(error)) {
        throw new ConflictException('Workspace slug already taken');
      }
      rethrowBetterAuthError(error, 'Failed to update workspace', {
        404: 'Workspace not found',
      });
    }
  }

  /**
   * Deletes the workspace, and leaves the only record of it that can survive the deletion.
   *
   * There is no `workspace.deleted` activity row, and there cannot be one: `Activity` cascades
   * on `workspaceId`, so the entry would be deleted by the statement it describes — along with
   * every board, task, comment and audit row the tenant ever wrote. Writing one anyway would be
   * worse than writing none, because it would look like coverage in a table where nothing
   * remains to be read.
   *
   * So the record goes to the JSON log instead (`WorkspaceDeletedLogLine`), and the details are
   * gathered *before* the call: afterwards the row is gone and even the workspace's name cannot
   * be looked up. The counts are what turn "workspace X was deleted" into something an incident
   * responder can size — an empty trial tenant and a workspace with forty members and nine
   * boards are otherwise the same line. `docs/architecture.md` ("Audit trail") records this as
   * the one event that lives in the log rather than in the table.
   */
  async remove(workspaceId: string, actorId: string, request: Request): Promise<void> {
    const doomed = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        name: true,
        slug: true,
        _count: { select: { members: true, boards: true } },
      },
    });

    try {
      await auth.api.deleteOrganization({
        body: { organizationId: workspaceId },
        headers: this.headersFrom(request),
      });
    } catch (error) {
      rethrowBetterAuthError(error, 'Failed to delete workspace', {
        404: 'Workspace not found',
      });
    }

    const line: WorkspaceDeletedLogLine = {
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'workspace.deleted',
      workspaceId,
      actorId,
      name: doomed?.name ?? null,
      slug: doomed?.slug ?? null,
      memberCount: doomed?._count.members ?? null,
      boardCount: doomed?._count.boards ?? null,
    };
    this.write(JSON.stringify(line));
  }

  /**
   * One cursor page of the workspace roster.
   *
   * This used to be a plain array behind `take: 1000`, which meant the 1001st member simply
   * did not exist as far as any client could tell. Paging by `id` (UUIDv7, so ascending id
   * is ascending join time — the order the array had) makes the remainder reachable instead
   * of invisible: the response says `hasMore`, and the caller decides what to do about it.
   */
  async listMembers(
    workspaceId: string,
    query: WorkspaceMemberQueryDto,
  ): Promise<CursorPage<WorkspaceMemberDto>> {
    const limit = query.limit ?? MAX_PAGE_LIMIT;

    const rows = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      include: memberInclude,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    return toCursorPage(rows, limit, toMemberDto);
  }

  /**
   * The caller's own membership.
   *
   * The shell only ever wanted the signed-in user's role, and paying for the whole roster to
   * run `.find()` over it is exactly what made the truncation above load-bearing. This is the
   * single indexed row that question actually needs.
   */
  async getMembership(workspaceId: string, userId: string): Promise<WorkspaceMemberDto> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: memberInclude,
    });

    if (!member) {
      throw new NotFoundException('Workspace member not found');
    }

    return toMemberDto(member);
  }
}
