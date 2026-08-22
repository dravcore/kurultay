import { Priority } from '@kurul/shared-types';
import { DEFAULT_PAGE_LIMIT } from '../common/pagination/page-limit';
import type { TaskQueryDto } from './dto/task-query.dto';
import { buildListWhere } from './task-query-where';

const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';
const USER_A = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d61';
const USER_B = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d62';
const LABEL_A = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d80';
const LABEL_B = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d81';

/** A validated query with only the fields a case cares about set. */
function query(overrides: Partial<TaskQueryDto> = {}): TaskQueryDto {
  return { limit: DEFAULT_PAGE_LIMIT, ...overrides } as TaskQueryDto;
}

describe('buildListWhere', () => {
  it('scopes to the board and adds nothing when no filter is given', () => {
    expect(buildListWhere(BOARD_ID, query())).toEqual({ boardId: BOARD_ID });
  });

  describe('individual filters', () => {
    it('walks the cursor forward by id, never by position', () => {
      expect(buildListWhere(BOARD_ID, query({ cursor: USER_A })).AND).toEqual([
        { id: { gt: USER_A } },
      ]);
    });

    it('searches title and description case-insensitively', () => {
      expect(buildListWhere(BOARD_ID, query({ q: 'login' })).AND).toEqual([
        {
          OR: [
            { title: { contains: 'login', mode: 'insensitive' } },
            { description: { contains: 'login', mode: 'insensitive' } },
          ],
        },
      ]);
    });

    // Prisma's `contains` is not a literal-string match — see `escapeLikePattern`'s doc comment
    // for the empirical proof that an unescaped `%`/`_` keeps its SQL `ILIKE` wildcard meaning.
    it('escapes % and _ in the search string so they match literally', () => {
      expect(buildListWhere(BOARD_ID, query({ q: '50%_off' })).AND).toEqual([
        {
          OR: [
            { title: { contains: '50\\%\\_off', mode: 'insensitive' } },
            { description: { contains: '50\\%\\_off', mode: 'insensitive' } },
          ],
        },
      ]);
    });

    it('treats several priorities as a membership test', () => {
      expect(
        buildListWhere(BOARD_ID, query({ priority: [Priority.HIGH, Priority.URGENT] })).AND,
      ).toEqual([{ priority: { in: [Priority.HIGH, Priority.URGENT] } }]);
    });

    it('matches any of the given labels', () => {
      expect(buildListWhere(BOARD_ID, query({ labelId: [LABEL_A, LABEL_B] })).AND).toEqual([
        { labels: { some: { labelId: { in: [LABEL_A, LABEL_B] } } } },
      ]);
    });

    it('reads dueDate=null as "has no due date"', () => {
      expect(buildListWhere(BOARD_ID, query({ dueDate: 'null' })).AND).toEqual([{ dueDate: null }]);
    });

    it('collapses a two-sided due range into one bound', () => {
      expect(
        buildListWhere(
          BOARD_ID,
          query({
            'dueDate[gte]': '2026-01-01T00:00:00.000Z',
            'dueDate[lte]': '2026-12-31T00:00:00.000Z',
          }),
        ).AND,
      ).toEqual([
        {
          dueDate: {
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lte: new Date('2026-12-31T00:00:00.000Z'),
          },
        },
      ]);
    });

    it('keeps a one-sided due range one-sided', () => {
      expect(
        buildListWhere(BOARD_ID, query({ 'dueDate[gte]': '2026-01-01T00:00:00.000Z' })).AND,
      ).toEqual([{ dueDate: { gte: new Date('2026-01-01T00:00:00.000Z') } }]);
    });
  });

  describe('assignee filter', () => {
    it('matches any of the given users', () => {
      expect(buildListWhere(BOARD_ID, query({ assigneeId: [USER_A, USER_B] })).AND).toEqual([
        { assignees: { some: { userId: { in: [USER_A, USER_B] } } } },
      ]);
    });

    it('reads the literal null as unassigned, with no OR wrapper', () => {
      expect(buildListWhere(BOARD_ID, query({ assigneeId: ['null'] })).AND).toEqual([
        { assignees: { none: {} } },
      ]);
    });

    it('reads null mixed with ids as "unassigned or theirs"', () => {
      expect(buildListWhere(BOARD_ID, query({ assigneeId: ['null', USER_A] })).AND).toEqual([
        {
          OR: [{ assignees: { none: {} } }, { assignees: { some: { userId: { in: [USER_A] } } } }],
        },
      ]);
    });
  });

  describe('empty and absent values', () => {
    // The DTO's transform drops empty lists to `undefined`, but a caller inside the process
    // can still hand over `[]` — and an empty `in` matches nothing, which would silently turn
    // "no filter" into "no results".
    it.each([
      ['priority', { priority: [] }],
      ['assigneeId', { assigneeId: [] }],
      ['labelId', { labelId: [] }],
    ])('ignores an empty %s list rather than matching nothing', (_name, overrides) => {
      expect(buildListWhere(BOARD_ID, query(overrides))).toEqual({ boardId: BOARD_ID });
    });

    it('ignores an empty search string', () => {
      expect(buildListWhere(BOARD_ID, query({ q: '' }))).toEqual({ boardId: BOARD_ID });
    });

    it('ignores a dueDate value other than the literal null', () => {
      expect(buildListWhere(BOARD_ID, query({ dueDate: 'soon' }))).toEqual({ boardId: BOARD_ID });
    });
  });

  describe('combinations', () => {
    it('conjoins every active filter in request order', () => {
      const where = buildListWhere(
        BOARD_ID,
        query({
          cursor: USER_A,
          q: 'login',
          priority: [Priority.HIGH],
          assigneeId: [USER_B],
          labelId: [LABEL_A],
          dueDate: 'null',
          'dueDate[gte]': '2026-01-01T00:00:00.000Z',
        }),
      );

      expect(where.boardId).toBe(BOARD_ID);
      expect(where.AND).toHaveLength(7);
    });

    // Two conjuncts naming the same column contradict instead of overwriting each other. A
    // single merged `dueDate` object would have kept whichever branch wrote last, which turns
    // a nonsensical request into a plausible-looking answer.
    it('keeps dueDate=null and a due range as separate, contradictory conjuncts', () => {
      const where = buildListWhere(
        BOARD_ID,
        query({ dueDate: 'null', 'dueDate[lte]': '2026-12-31T00:00:00.000Z' }),
      );

      expect(where.AND).toEqual([
        { dueDate: null },
        { dueDate: { lte: new Date('2026-12-31T00:00:00.000Z') } },
      ]);
    });
  });
});
