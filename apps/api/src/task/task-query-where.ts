import { escapeLikePattern } from '../common/escape-like';
import type { Prisma } from '../generated/prisma';
import type { TaskQueryDto } from './dto/task-query.dto';

/**
 * The task list's filter matrix, as a Prisma predicate.
 *
 * A free function rather than a service method: it reads a DTO and returns a `where`, touches
 * neither the client nor the request, and is the one part of the list path with real
 * combinatorics in it. Out here the combinations can be enumerated in a test without standing
 * a service and a Prisma mock up first.
 *
 * Every filter is a separate entry in `AND` instead of being merged into one object. Two
 * filters that name the same field — `dueDate=null` alongside a `dueDate[gte]` range — would
 * otherwise overwrite each other silently depending on which ran last; as separate conjuncts
 * they contradict, and the request correctly returns nothing.
 */
export function buildListWhere(boardId: string, query: TaskQueryDto): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [];

  if (query.cursor) {
    and.push({ id: { gt: query.cursor } });
  }

  if (query.q) {
    // `contains` is not a literal-string match: Prisma passes `q` straight through to Postgres
    // as an `ILIKE` pattern, so an unescaped `%`/`_` the user typed keeps its SQL wildcard
    // meaning and silently widens the results (empirically confirmed against Postgres 18 — see
    // `escapeLikePattern`'s doc comment). Escaping makes the search box match what it looks
    // like it matches.
    const q = escapeLikePattern(query.q);
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  if (query.priority && query.priority.length > 0) {
    and.push({ priority: { in: query.priority } });
  }

  if (query.assigneeId && query.assigneeId.length > 0) {
    // `null` is the wire spelling of "unassigned", and it may be combined with real user ids:
    // "mine or nobody's" is one filter, not two requests.
    const wantsUnassigned = query.assigneeId.includes('null');
    const userIds = query.assigneeId.filter((id) => id !== 'null');
    const assigneeOr: Prisma.TaskWhereInput[] = [];
    if (wantsUnassigned) {
      assigneeOr.push({ assignees: { none: {} } });
    }
    if (userIds.length > 0) {
      assigneeOr.push({ assignees: { some: { userId: { in: userIds } } } });
    }
    and.push(assigneeOr.length === 1 ? assigneeOr[0]! : { OR: assigneeOr });
  }

  if (query.labelId && query.labelId.length > 0) {
    and.push({ labels: { some: { labelId: { in: query.labelId } } } });
  }

  if (query.dueDate === 'null') {
    and.push({ dueDate: null });
  }

  const dueGte = query['dueDate[gte]'];
  const dueLte = query['dueDate[lte]'];
  if (dueGte || dueLte) {
    and.push({
      dueDate: {
        ...(dueGte ? { gte: new Date(dueGte) } : {}),
        ...(dueLte ? { lte: new Date(dueLte) } : {}),
      },
    });
  }

  return {
    boardId,
    ...(and.length > 0 ? { AND: and } : {}),
  };
}
