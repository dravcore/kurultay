import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'supertest/types';
import {
  AttachmentKind,
  ColumnCategory,
  TrelloImportScope,
  TrelloImportSkipReason,
} from '@kurul/shared-types';
import type { TrelloImportReportDto, TrelloImportSkipGroupDto } from '@kurul/shared-types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp, type TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The Trello importer against exports Trello actually wrote.
 *
 * Every fixture `trello-import.e2e-spec.ts` reads was hand-written from memory
 * (`test/fixtures/trello/README.md`), so a green run there says the importer handles what this
 * repository *believes* a Trello export looks like. This file is the other half: it picks up
 * every `*.json` under `fixtures/trello/real/` at module load, imports each one through the real
 * endpoint, and checks the report and the database against counts derived from the file itself.
 * Those files are real exports that went through `scripts/anonymise-trello-export.mjs`; the
 * directory's README says how to add one.
 *
 * ## The expectations are derived, and that is a different trade-off from the sibling file
 *
 * `trello-import.e2e-spec.ts` writes its expected numbers out by hand, so that an assertion
 * cannot agree with the planner by construction. That is the right choice for a fixture whose
 * contents are known. The files here are not known in advance, so the expectations are computed
 * from the raw JSON by restating ADR 0025's rules in the plainest possible form (an archived list
 * is skipped, an unnamed card is malformed, an attachment is a link when its scheme is `http` or
 * `https`), in code that shares nothing with `src/import/`. A disagreement between that
 * restatement and the importer is exactly what the gate is looking for: it is the first place a
 * difference between Trello's schema and this repository's idea of it becomes visible, and the
 * export wins.
 *
 * ## While the directory is empty
 *
 * One visibly skipped test, named after the open `v0.3.0` gate, so a CI log shows that the gate
 * is still open rather than showing nothing at all.
 *
 * ## The guard that runs regardless
 *
 * The anonymiser is what makes committing a real export possible, so its one promise, that the
 * importer cannot tell an anonymised export from the original, is proven here on the fixture
 * this repository does have: `synthetic-full-board.json`, with a few strings added that once
 * tripped the anonymiser (see `withAnonymiserTraps`), is anonymised through the CLI (a child
 * process, because `scripts/` is ESM and Jest runs CommonJS; a shim would test the shim), both
 * files are imported, and the reports and the resulting boards are compared shape for shape.
 */

const FIXTURES = join(__dirname, 'fixtures', 'trello');
const REAL_FIXTURES = join(FIXTURES, 'real');
const ANONYMISER = join(__dirname, '..', '..', '..', 'scripts', 'anonymise-trello-export.mjs');

/** Read once, at module load, so the describe below knows whether to skip. */
const REAL_EXPORTS = readdirSync(REAL_FIXTURES)
  .filter((file) => file.endsWith('.json'))
  .sort();

/** A real export can be megabytes; the default per-test budget is sized for a request or two. */
const REAL_EXPORT_TIMEOUT_MS = 120_000;

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object entries of an array, and nothing for anything that is not an array. */
function records(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** The colours ADR 0025's table maps; anything else is reported as `(label, defaulted)`. */
const KNOWN_LABEL_COLOURS = new Set([
  'blue',
  'orange',
  'green',
  'yellow',
  'pink',
  'lime',
  'purple',
  'red',
  'sky',
  'black',
]);

function isKnownColour(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const base = value.toLowerCase().split('_')[0] ?? '';
  return KNOWN_LABEL_COLOURS.has(base);
}

/** ADR 0025: `pos` ascending, non-numeric `pos` after every numeric one, ties by Trello id. */
function byTrelloOrder(a: RawRecord, b: RawRecord): number {
  const posA = typeof a.pos === 'number' && Number.isFinite(a.pos) ? a.pos : null;
  const posB = typeof b.pos === 'number' && Number.isFinite(b.pos) ? b.pos : null;
  if (posA !== null && posB !== null && posA !== posB) return posA - posB;
  if (posA !== null && posB === null) return -1;
  if (posA === null && posB !== null) return 1;
  const idA = text(a.id) ?? '';
  const idB = text(b.id) ?? '';
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

type UrlClass = 'storable' | 'unsupportedScheme' | 'malformed';

function classifyUrl(value: unknown): UrlClass {
  if (typeof value !== 'string') return 'malformed';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? 'storable'
      : 'unsupportedScheme';
  } catch {
    return 'malformed';
  }
}

/**
 * What ADR 0025 says an import of this file must produce, computed from the file alone.
 *
 * Every number here is a count of entries in the file after one of the ADR's rules; none of it
 * reads `src/import/`. Cards are classified in the order the ADR lists the rules: archived first,
 * then unnamed, then "points at a list that is not live" (archived content if the list was
 * archived, a hole in the file otherwise).
 */
function expectationsFor(raw: RawRecord) {
  const lists = records(raw.lists);
  const cards = records(raw.cards);
  const labels = records(raw.labels);
  const checklists = records(raw.checklists);

  const liveLists = lists.filter((list) => list.closed !== true && !isBlank(list.name));
  const liveListIds = new Set(liveLists.map((list) => text(list.id)));
  const archivedListIds = new Set(
    lists.filter((list) => list.closed === true).map((list) => text(list.id)),
  );

  const cardVerdicts = cards.map((card): 'imported' | 'archived' | 'malformed' => {
    if (card.closed === true) return 'archived';
    if (isBlank(card.name)) return 'malformed';
    if (!liveListIds.has(text(card.idList))) {
      return archivedListIds.has(text(card.idList)) ? 'archived' : 'malformed';
    }
    return 'imported';
  });
  const importedCards = cards.filter((_, index) => cardVerdicts[index] === 'imported');
  const importedCardIds = new Set(importedCards.map((card) => text(card.id)));

  const importedChecklists = checklists.filter(
    (checklist) =>
      importedCardIds.has(text(checklist.idCard)) &&
      !isBlank(checklist.name) &&
      records(checklist.checkItems).length > 0,
  );
  const importedItems = importedChecklists.flatMap((checklist) =>
    records(checklist.checkItems).filter((item) => !isBlank(item.name)),
  );

  const attachmentsOnImportedCards = importedCards.flatMap((card) => records(card.attachments));
  const attachmentVerdicts = attachmentsOnImportedCards.map((attachment) =>
    classifyUrl(attachment.url),
  );

  const countWhere = <T>(rows: readonly T[], verdict: T): number =>
    rows.filter((row) => row === verdict).length;
  // Raw array lengths, not `records(...)`: the reader reports a non-object entry as a skipped
  // row too, and the sum identity below has to account for every entry the section holds.
  const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

  return {
    boardName: text(raw.name) ?? '',
    columns: liveLists.length,
    columnNamesInOrder: [...liveLists].sort(byTrelloOrder).map((list) => text(list.name)),
    archivedLists: archivedListIds.size,
    listsInFile: lengthOf(raw.lists),
    tasks: importedCards.length,
    archivedCards: countWhere(cardVerdicts, 'archived'),
    malformedCards: countWhere(cardVerdicts, 'malformed'),
    cardsInFile: lengthOf(raw.cards),
    labels: labels.length,
    defaultedLabels: labels.filter((label) => isBlank(label.name) || !isKnownColour(label.color))
      .length,
    checklists: importedChecklists.length,
    checklistsInFile: lengthOf(raw.checklists),
    checklistItems: importedItems.length,
    doneItems: importedItems.filter((item) => item.state === 'complete').length,
    attachments: countWhere(attachmentVerdicts, 'storable'),
    unsupportedSchemeAttachments: countWhere(attachmentVerdicts, 'unsupportedScheme'),
    malformedAttachments: countWhere(attachmentVerdicts, 'malformed'),
    members: lengthOf(raw.members),
    comments: records(raw.actions).filter((action) => action.type === 'commentCard').length,
  };
}

function groupFor(
  report: TrelloImportReportDto,
  scope: TrelloImportScope,
  reason: TrelloImportSkipReason,
): TrelloImportSkipGroupDto | undefined {
  return report.skipped.find((group) => group.scope === scope && group.reason === reason);
}

function countFor(
  report: TrelloImportReportDto,
  scope: TrelloImportScope,
  reason: TrelloImportSkipReason,
): number {
  return groupFor(report, scope, reason)?.count ?? 0;
}

function skippedInScope(report: TrelloImportReportDto, scope: TrelloImportScope): number {
  return report.skipped
    .filter((group) => group.scope === scope)
    .reduce((total, group) => total + group.count, 0);
}

/** The skip groups with the sample *names* replaced by how many there were. */
/**
 * The synthetic board plus the strings that once tripped the anonymiser: attachment URLs that
 * also match the e-mail shape (`mailto:`, userinfo, an `@` in the path) and a `first.last`
 * handle in a card name. The importer has a verdict on each (unsupported scheme, link, link; a
 * title of the same length) that it must reach on the original and on the anonymisation alike,
 * which is a stronger check than the transform's own unit tests can make.
 */
function withAnonymiserTraps(raw: unknown): RawRecord {
  if (!isRecord(raw)) throw new Error('synthetic-full-board.json is not an object');
  const card = records(raw.cards).find((entry) => records(entry.attachments).length > 0);
  const template = card === undefined ? undefined : records(card.attachments)[0];
  if (card === undefined || template === undefined) {
    throw new Error('synthetic-full-board.json has no card with an attachment');
  }
  card.name = 'Review PR from k.smith';
  card.attachments = [
    ...records(card.attachments),
    {
      ...template,
      id: '6512a1b7c3d4e5f601020373',
      name: 'Mail the owner',
      url: 'mailto:owner@corp.example',
    },
    {
      ...template,
      id: '6512a1b7c3d4e5f601020374',
      name: 'report.pdf',
      url: 'https://user:pw@intranet.corp.example/report.pdf',
    },
    {
      ...template,
      id: '6512a1b7c3d4e5f601020375',
      name: 'x.d.ts',
      url: 'https://github.com/org/repo/blob/main/@types/x.d.ts',
    },
  ];
  return raw;
}

function skippedShape(report: TrelloImportReportDto) {
  return report.skipped.map((group) => ({
    scope: group.scope,
    reason: group.reason,
    count: group.count,
    samples: group.samples.length,
  }));
}

describe('Trello import against real exports (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await signUp(app, { name: 'Real Import Admin' });
    const workspace = await createWorkspace(admin.agent, 'Real Imports', 'real');
    workspaceId = workspace.id;
  });

  async function importFile(path: string): Promise<TrelloImportReportDto> {
    const response = await admin.agent
      .post(`/workspaces/${workspaceId}/imports/trello`)
      .attach('file', path, 'trello.json');
    if (response.status !== 201) {
      throw new Error(
        `import of ${path} answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    return response.body as TrelloImportReportDto;
  }

  /**
   * A board, reduced to what survives anonymisation: lengths rather than words, counts rather
   * than names, order rather than positions. Two imports that agree on this agree on everything
   * the importer reads.
   */
  async function boardShape(boardId: string) {
    const board = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      include: {
        labels: { orderBy: { id: 'asc' } },
        columns: {
          orderBy: { position: 'asc' },
          include: {
            tasks: {
              orderBy: { position: 'asc' },
              include: {
                labels: true,
                attachments: { orderBy: { id: 'asc' } },
                checklists: { orderBy: { position: 'asc' }, include: { items: true } },
              },
            },
          },
        },
      },
    });
    return {
      nameLength: board.name.length,
      descriptionLength: board.description?.length ?? null,
      labels: board.labels.map((label) => label.color).sort(),
      columns: board.columns.map((column) => ({
        nameLength: column.name.length,
        category: column.category,
        tasks: column.tasks.map((task) => ({
          titleLength: task.title.length,
          descriptionLength: task.description?.length ?? null,
          dueDate: task.dueDate?.toISOString() ?? null,
          labels: task.labels.length,
          attachments: task.attachments.map((attachment) => ({
            kind: attachment.kind,
            scheme: attachment.url === null ? null : new URL(attachment.url).protocol,
          })),
          checklists: task.checklists.map((checklist) => ({
            titleLength: checklist.title.length,
            items: checklist.items.length,
            done: checklist.items.filter((item) => item.isDone).length,
          })),
        })),
      })),
    };
  }

  // ---------------------------------------------------------------------------------------
  // The anonymiser, proven on the fixture this repository does have
  // ---------------------------------------------------------------------------------------

  describe('the anonymiser', () => {
    let tempDir: string | undefined;

    afterEach(async () => {
      if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    });

    it('changes nothing the importer reads: the anonymised synthetic board imports identically', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'kurul-trello-anonymised-'));
      const originalPath = join(tempDir, 'synthetic-full-board.json');
      const anonymisedPath = join(tempDir, 'synthetic-full-board.anonymised.json');
      const fixture: unknown = JSON.parse(
        readFileSync(join(FIXTURES, 'synthetic-full-board.json'), 'utf8'),
      );
      writeFileSync(originalPath, JSON.stringify(withAnonymiserTraps(fixture), null, 2));

      // The real CLI, the way the maintainer will run it. `stdio: 'pipe'` keeps its summary out
      // of the test output while still surfacing stderr in the thrown error if it fails.
      execFileSync(
        process.execPath,
        [ANONYMISER, originalPath, anonymisedPath, '--seed', 'integration'],
        { stdio: 'pipe' },
      );

      // ## Negative control first: it *did* anonymise
      //
      // Without this block the assertions below would hold just as well for a script that
      // copied its input, which is the one failure this guard must not be blind to.
      const anonymisedText = readFileSync(anonymisedPath, 'utf8');
      const originalText = readFileSync(originalPath, 'utf8');
      for (const leak of [
        'Product Roadmap',
        'Ada Placeholder',
        'Old Sprint',
        'trello.com',
        'k.smith',
        'owner@corp.example',
        'user:pw',
        'intranet.corp.example',
        'github.com',
      ]) {
        expect(originalText).toContain(leak);
        expect(anonymisedText).not.toContain(leak);
      }

      const original = await importFile(originalPath);
      const anonymised = await importFile(anonymisedPath);

      // ## Same report
      expect(anonymised.imported).toEqual(original.imported);
      expect(skippedShape(anonymised)).toEqual(skippedShape(original));
      expect(anonymised.boardName).not.toBe(original.boardName);
      expect(anonymised.boardName).toHaveLength(original.boardName.length);

      // ## Same board, row for row, in the same order
      expect(await boardShape(anonymised.boardId)).toEqual(await boardShape(original.boardId));
      // And the shape is not vacuous: it saw the columns, cards, links and checklists it claims.
      const shape = await boardShape(original.boardId);
      expect(shape.columns).toHaveLength(3);
      expect(shape.columns.flatMap((column) => column.tasks)).toHaveLength(4);
      // Two links from the fixture, two from the traps (userinfo and an `@` in the path).
      expect(
        shape.columns.flatMap((column) => column.tasks.flatMap((task) => task.attachments)),
      ).toHaveLength(4);
      // And both e-mail-shaped non-links were refused for their scheme, not as malformed.
      expect(skippedShape(anonymised)).toContainEqual({
        scope: TrelloImportScope.Attachment,
        reason: TrelloImportSkipReason.UnsupportedScheme,
        count: 2,
        samples: 2,
      });
      expect(
        anonymised.skipped.some(
          (group) =>
            group.scope === TrelloImportScope.Attachment &&
            group.reason === TrelloImportSkipReason.Malformed,
        ),
      ).toBe(false);
      expect(
        shape.columns.flatMap((column) => column.tasks.flatMap((task) => task.checklists)),
      ).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------------------
  // The real exports, one test per file
  // ---------------------------------------------------------------------------------------

  describe('anonymised real exports', () => {
    if (REAL_EXPORTS.length === 0) {
      // `it.skip` rather than returning early, so the run *shows* the gate is still open.
      it.skip('no anonymised real Trello exports in fixtures/trello/real yet (v0.3.0 gate)', () => {
        // Drop an anonymised export into `fixtures/trello/real/` and this describe replaces
        // this line with one test per file. See the README in that directory.
      });
      return;
    }

    it.each(REAL_EXPORTS)(
      '%s imports end to end and the report agrees with the file and the database',
      async (file) => {
        const path = join(REAL_FIXTURES, file);
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (!isRecord(raw)) throw new Error(`${file} is not a JSON object`);
        const expected = expectationsFor(raw);

        const report = await importFile(path);

        const board = await prisma.board.findUniqueOrThrow({
          where: { id: report.boardId },
          include: {
            columns: { orderBy: { position: 'asc' } },
            labels: true,
            tasks: {
              include: {
                checklists: { include: { items: true } },
                attachments: true,
              },
            },
          },
        });
        const checklists = board.tasks.flatMap((task) => task.checklists);
        const items = checklists.flatMap((checklist) => checklist.items);
        const attachments = board.tasks.flatMap((task) => task.attachments);

        // ## The report describes the rows that are actually there
        expect(board.workspaceId).toBe(workspaceId);
        expect(board.name).toBe(expected.boardName);
        expect(report.imported).toEqual({
          columns: board.columns.length,
          tasks: board.tasks.length,
          labels: board.labels.length,
          checklists: checklists.length,
          checklistItems: items.length,
          attachments: attachments.length,
        });

        // ## And the rows are what the file, read by ADR 0025's rules, says they should be
        expect(report.imported).toEqual({
          columns: expected.columns,
          tasks: expected.tasks,
          labels: expected.labels,
          checklists: expected.checklists,
          checklistItems: expected.checklistItems,
          attachments: expected.attachments,
        });
        expect(board.columns.map((column) => column.name)).toEqual(expected.columnNamesInOrder);
        expect(items.filter((item) => item.isDone)).toHaveLength(expected.doneItems);

        // ## Every skip group carries the number the file accounts for
        expect(countFor(report, TrelloImportScope.List, TrelloImportSkipReason.Archived)).toBe(
          expected.archivedLists,
        );
        expect(countFor(report, TrelloImportScope.Card, TrelloImportSkipReason.Archived)).toBe(
          expected.archivedCards,
        );
        expect(countFor(report, TrelloImportScope.Card, TrelloImportSkipReason.Malformed)).toBe(
          expected.malformedCards,
        );
        expect(countFor(report, TrelloImportScope.Column, TrelloImportSkipReason.Defaulted)).toBe(
          expected.columns,
        );
        expect(countFor(report, TrelloImportScope.Label, TrelloImportSkipReason.Defaulted)).toBe(
          expected.defaultedLabels,
        );
        expect(
          countFor(report, TrelloImportScope.Attachment, TrelloImportSkipReason.UnsupportedScheme),
        ).toBe(expected.unsupportedSchemeAttachments);
        expect(
          countFor(report, TrelloImportScope.Attachment, TrelloImportSkipReason.Malformed),
        ).toBe(expected.malformedAttachments);
        expect(countFor(report, TrelloImportScope.Member, TrelloImportSkipReason.Unmappable)).toBe(
          expected.members,
        );
        expect(countFor(report, TrelloImportScope.Comment, TrelloImportSkipReason.OutOfScope)).toBe(
          expected.comments,
        );

        // ## Created plus skipped is what the file contains: nothing vanished without a row
        expect(report.imported.columns + skippedInScope(report, TrelloImportScope.List)).toBe(
          expected.listsInFile,
        );
        expect(report.imported.tasks + skippedInScope(report, TrelloImportScope.Card)).toBe(
          expected.cardsInFile,
        );
        expect(
          report.imported.checklists + skippedInScope(report, TrelloImportScope.Checklist),
        ).toBe(expected.checklistsInFile);
        expect(
          report.imported.attachments + skippedInScope(report, TrelloImportScope.Attachment),
        ).toBe(
          expected.attachments +
            expected.unsupportedSchemeAttachments +
            expected.malformedAttachments,
        );

        // ## The invariants that hold for every import, real or synthetic
        expect(board.columns.every((column) => column.category === ColumnCategory.UNSTARTED)).toBe(
          true,
        );
        expect(board.labels.every((label) => /^slot-[1-8]$/.test(label.color))).toBe(true);
        for (const attachment of attachments) {
          expect(attachment.kind).toBe(AttachmentKind.Link);
          expect(attachment.storageKey).toBeNull();
          expect(attachment.size).toBeNull();
          expect(attachment.mimeType).toBeNull();
          expect(attachment.url).toMatch(/^https?:/);
        }
      },
      REAL_EXPORT_TIMEOUT_MS,
    );
  });
});
