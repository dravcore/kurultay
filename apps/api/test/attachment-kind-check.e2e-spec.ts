import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

const CONSTRAINT_NAME = 'Attachment_kind_fields_check';

/** One raw `Attachment` row, written past every application-level guard. */
interface RawAttachment {
  kind: 'FILE' | 'LINK';
  storageKey: string | null;
  mimeType: string | null;
  size: number | null;
  url: string | null;
}

/**
 * `Attachment_kind_fields_check` is a CHECK constraint, and Prisma's schema language has no way
 * to say `CHECK`. It exists only in
 * `migrations/20260818120000_attachment_kind_check/migration.sql` and as a comment on the
 * `AttachmentKind` enum — the same shape ADR 0017 describes for the due-soon partial index, and
 * the same reason its guard test exists.
 *
 * What the constraint carries is ADR 0024's central claim: `kind` is the column the nullability
 * of `storageKey`, `mimeType`, `size` and `url` is *derived from*, so a row with both a URL and a
 * storage key — or with neither — must be unwritable. Nothing else notices if the constraint goes.
 * Every application write path satisfies it already, so dropping it breaks no test and no request;
 * it only re-opens the door the ADR named, "an importer running a bulk insert at three in the
 * morning" (`import/trello-import.service.ts` writes attachments with `createMany`, past
 * `AttachmentService` entirely). The rows that door lets in are the ones the download endpoint,
 * the storage sweep and the quota sum all have to be lied to about. These tests are the tripwire.
 */
describe('Attachment kind CHECK constraint (e2e)', () => {
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

  async function seedTask(): Promise<{ userId: string; taskId: string }> {
    const owner = await signUp(app, { name: 'Owner' });
    const workspace = await createWorkspace(owner.agent, 'Attachments', 'akc');
    const me = await owner.agent.get('/me').expect(200);
    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const task = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Ship it', columnId: columns.body[0].id })
      .expect(201);

    return { userId: me.body.id as string, taskId: task.body.id as string };
  }

  /**
   * A raw `INSERT`, deliberately not `prisma.attachment.create`.
   *
   * The constraint's whole purpose is to stop writes that never pass through
   * `AttachmentService`, so the test that it works has to be one of those writes. Going through
   * the client would only prove the client's own types are right, which is the layer the ADR
   * already said is not enough.
   */
  async function insertRaw(
    seed: { userId: string; taskId: string },
    row: RawAttachment,
  ): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO "Attachment"
        ("id", "taskId", "uploadedById", "kind", "filename",
         "storageKey", "mimeType", "size", "url")
      VALUES
        (${uuidv7()}, ${seed.taskId}, ${seed.userId},
         CAST(${row.kind} AS "AttachmentKind"), 'fixture',
         ${row.storageKey}, ${row.mimeType}, ${row.size}, ${row.url})
    `;
  }

  const legalFile: RawAttachment = {
    kind: 'FILE',
    storageKey: 'ab/cd/abcdef',
    mimeType: 'image/png',
    size: 1234,
    url: null,
  };

  const legalLink: RawAttachment = {
    kind: 'LINK',
    storageKey: null,
    mimeType: null,
    size: null,
    url: 'https://example.com/spec',
  };

  it('is present on the Attachment table as a validated check constraint', async () => {
    const rows = await prisma.$queryRaw<Array<{ contype: string; convalidated: boolean }>>`
      SELECT c.contype::text AS contype, c.convalidated
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = current_schema()
        AND t.relname = 'Attachment'
        AND c.conname = ${CONSTRAINT_NAME}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.contype).toBe('c');
    // `NOT VALID` would leave pre-existing rows unchecked while still reporting a constraint by
    // that name — a green catalog row over an invariant that only holds for future writes.
    expect(rows[0]?.convalidated).toBe(true);
  });

  it('still names both kinds and all four derived columns in its predicate', async () => {
    // A constraint that survives with a weakened predicate is worse than a missing one: it reads
    // as enforcement in the catalog while permitting exactly the rows it was added to reject.
    const rows = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = current_schema()
        AND t.relname = 'Attachment'
        AND c.conname = ${CONSTRAINT_NAME}
    `;

    expect(rows).toHaveLength(1);
    const definition = rows[0]?.definition ?? '';
    expect(definition).toContain('CHECK');
    expect(definition).toContain(`'FILE'`);
    expect(definition).toContain(`'LINK'`);
    for (const column of ['storageKey', 'mimeType', 'size', 'url']) {
      // Each of the four is required on one side of the `OR` and forbidden on the other; that
      // pairing *is* the invariant, and a predicate missing either half of it for any column
      // has stopped saying what ADR 0024 decided. The optional quotes keep the assertion off
      // Postgres's rendering — it drops them from all-lowercase identifiers (`size`, `url`)
      // and keeps them on the camelCase ones.
      expect(definition).toMatch(new RegExp(`"?${column}"? IS NOT NULL`));
      expect(definition).toMatch(new RegExp(`"?${column}"? IS NULL`));
    }
  });

  it('accepts the two shapes the application actually writes', async () => {
    const seed = await seedTask();

    // `createFile` writes the first (`attachment.service.ts`), `createLink` and the Trello
    // importer's plan write the second — so a constraint that rejected either would take the
    // upload path or the import down with it.
    await insertRaw(seed, legalFile);
    await insertRaw(seed, legalLink);

    expect(await prisma.attachment.count({ where: { taskId: seed.taskId } })).toBe(2);
    expect(await prisma.attachment.count({ where: { taskId: seed.taskId, kind: 'FILE' } })).toBe(1);
    expect(await prisma.attachment.count({ where: { taskId: seed.taskId, kind: 'LINK' } })).toBe(1);
  });

  it.each<[string, RawAttachment]>([
    // The two rows ADR 0024 names by hand: both halves filled in, and neither.
    ['a FILE that also carries a url', { ...legalFile, url: 'https://example.com/spec' }],
    [
      'a FILE with neither a storage key nor a url',
      { kind: 'FILE', storageKey: null, mimeType: null, size: null, url: null },
    ],
    ['a LINK that also carries a storage key', { ...legalLink, storageKey: 'ab/cd/abcdef' }],
    ['a LINK with no url at all', { ...legalLink, url: null }],
    // The importer's predicted failure mode: a FILE forced through the model with pieces
    // missing, which is what a nullable-only schema would have accepted silently.
    ['a FILE with no mime type', { ...legalFile, mimeType: null }],
    ['a FILE with no size', { ...legalFile, size: null }],
  ])('rejects %s', async (_label, row) => {
    const seed = await seedTask();

    await expect(insertRaw(seed, row)).rejects.toThrow(CONSTRAINT_NAME);
    expect(await prisma.attachment.count({ where: { taskId: seed.taskId } })).toBe(0);
  });
});
