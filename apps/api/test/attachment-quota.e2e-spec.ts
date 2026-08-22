import { INestApplication } from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { App } from 'supertest/types';
import { ATTACHMENT_QUOTA_ERROR, AttachmentKind } from '@kurul/shared-types';
import type { AttachmentDto } from '@kurul/shared-types';
import { PrismaService } from '../src/prisma/prisma.service';
import { closeStorageBackend } from '../src/storage/storage';
import {
  DEFAULT_ATTACHMENT_INSTANCE_QUOTA_BYTES,
  DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES,
} from '../src/storage/storage-config';
import { createTestApp } from './helpers/app';
import { createWorkspace, signUp, TestUser } from './helpers/auth';
import { resetDatabase } from './helpers/db';
import { createTempStorageDir, removeTempStorageDir } from './helpers/storage';

/**
 * The storage quotas of SEC-02 / ADR 0027, measured through the assembled stack.
 *
 * The unit spec (`attachment.service.spec.ts`) pins what the service *asks* Prisma — the
 * `kind: FILE` predicate, the workspace scope, the inclusive comparison. What only this file can
 * answer is whether the wire shows the documented shape: which uploads a real Postgres `SUM`
 * lets through, that the rejection is a 413 whose `error` a client can tell from the per-file
 * limit's, and that a full workspace next door costs a tenant nothing.
 *
 * ## How the quota values change mid-suite
 *
 * Unlike `ATTACHMENT_MAX_BYTES` — frozen into multer's options when `AttachmentModule` is
 * instantiated (D5) — the quotas are read through `getStorageConfig()` on every upload, so a
 * test sets the variable and drops the config singleton (`closeStorageBackend()`) without
 * rebuilding the app. `STORAGE_PATH` stays set for the whole file, so the rebuilt backend is the
 * same directory every time.
 *
 * ## The defaults are measured with the variables genuinely unset
 *
 * ADR 0027's 2026-08-21 update gives an unconfigured instance finite ceilings (2 GiB per
 * workspace, 20 GiB per instance). Nobody is going to upload two gibibytes in a test, so the
 * "already stored" side is seeded straight into `Attachment` through Prisma: FILE rows with
 * `size` values and no bytes on disk, which is all the quota's `SUM(size)` ever looks at. The
 * upload that then crosses the line is a real one through the route.
 */

const MAX_BYTES = 64 * 1024;
const QUOTA = 4096;

/** A genuine 1x1 greyscale PNG — the same construction `attachment.e2e-spec.ts` documents. */
function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([header, data, crc]);
}

function buildPng(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(0, 9);
  const idat = deflateSync(Buffer.from([0x00, 0x00]));
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG = buildPng();

/** A PNG of exactly `size` bytes — padding after `IEND`, where neither a decoder nor the sniffer reads. */
function pngOfSize(size: number): Buffer {
  if (size < PNG.length) throw new Error(`cannot build a PNG smaller than ${PNG.length} bytes`);
  return Buffer.concat([PNG, Buffer.alloc(size - PNG.length, 0x20)]);
}

const QUOTA_VARS = ['ATTACHMENT_WORKSPACE_QUOTA_BYTES', 'ATTACHMENT_INSTANCE_QUOTA_BYTES'] as const;

interface Seed {
  user: TestUser;
  workspaceId: string;
  taskId: string;
}

describe('Attachment storage quotas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storageRoot: string;
  const previous = new Map<string, string | undefined>();

  beforeAll(async () => {
    storageRoot = await createTempStorageDir();
    for (const name of ['STORAGE_PATH', 'ATTACHMENT_MAX_BYTES', ...QUOTA_VARS]) {
      previous.set(name, process.env[name]);
    }
    process.env.STORAGE_PATH = storageRoot;
    process.env.ATTACHMENT_MAX_BYTES = String(MAX_BYTES);
    for (const name of QUOTA_VARS) delete process.env[name];
    await closeStorageBackend();

    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await closeStorageBackend();
    await removeTempStorageDir(storageRoot);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    for (const entry of await readdir(storageRoot)) {
      await removeTempStorageDir(join(storageRoot, entry));
    }
    // Every test starts on the defaults (both variables unset) and configures its own ceilings
    // through `setQuotas`; `0` is the explicit opt-out.
    await setQuotas({});
  });

  /** Points the running app at new quota values without rebuilding it (see the header). */
  async function setQuotas(values: { workspace?: number; instance?: number }): Promise<void> {
    if (values.workspace === undefined) delete process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES;
    else process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = String(values.workspace);
    if (values.instance === undefined) delete process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES;
    else process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = String(values.instance);
    await closeStorageBackend();
  }

  async function seed(label: string): Promise<Seed> {
    const user = await signUp(app, { name: 'Quota Owner' });
    const workspace = await createWorkspace(user.agent, 'Quotas', label);
    const board = await user.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await user.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const task = await user.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Card', columnId: columns.body[0].id })
      .expect(201);
    return { user, workspaceId: workspace.id, taskId: task.body.id as string };
  }

  async function upload(where: Seed, bytes: Buffer): Promise<AttachmentDto> {
    const response = await where.user.agent
      .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
      .field('kind', AttachmentKind.File)
      .attach('file', bytes, { filename: 'file.png', contentType: 'image/png' })
      .expect(201);
    return response.body as AttachmentDto;
  }

  function tryUpload(where: Seed, bytes: Buffer) {
    return where.user.agent
      .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
      .field('kind', AttachmentKind.File)
      .attach('file', bytes, { filename: 'file.png', contentType: 'image/png' });
  }

  async function storedFileCount(): Promise<number> {
    const entries = await readdir(storageRoot, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).length;
  }

  /**
   * Writes FILE rows that together claim `totalBytes` of quota without a byte on disk. Rows are
   * split so each `size` stays inside the column's `Int` range; the sum is what the quota reads.
   */
  async function seedStoredBytes(where: Seed, totalBytes: number): Promise<number> {
    const uploader = await prisma.user.findUniqueOrThrow({ where: { email: where.user.email } });
    const chunk = 2 ** 31 - 1;
    const sizes: number[] = [];
    for (let left = totalBytes; left > 0; left -= chunk) sizes.push(Math.min(chunk, left));
    await prisma.attachment.createMany({
      data: sizes.map((size, index) => ({
        taskId: where.taskId,
        uploadedById: uploader.id,
        kind: AttachmentKind.File,
        filename: `seeded-${index}.bin`,
        storageKey: `seeded/${where.taskId}/${index}`,
        mimeType: 'application/octet-stream',
        size,
      })),
    });
    return sizes.length;
  }

  it('rejects the upload that would cross the workspace quota, in the documented shape, and spares the neighbour', async () => {
    await setQuotas({ workspace: QUOTA });
    const mine = await seed('quota-mine');
    const theirs = await seed('quota-theirs');

    // Two uploads that land exactly on the quota: the second proves the ceiling is inclusive —
    // a file that fills the quota to the byte is accepted, matching ATTACHMENT_MAX_BYTES's own
    // published inclusiveness.
    await upload(mine, pngOfSize(QUOTA / 2));
    await upload(mine, pngOfSize(QUOTA / 2));

    // The workspace is full; the smallest possible PNG no longer fits.
    const refused = await tryUpload(mine, PNG).expect(413);

    // The shape a client branches on: same status as the per-file limit, its own `error`
    // (docs/api-conventions.md#errors — statusCode and error, never message).
    expect(refused.body.error).toBe(ATTACHMENT_QUOTA_ERROR);
    expect(refused.body.statusCode).toBe(413);

    // Nothing landed: no row, and no bytes beyond the two accepted files.
    await expect(prisma.attachment.count()).resolves.toBe(2);
    await expect(storedFileCount()).resolves.toBe(2);

    // The quota is per workspace: a tenant next door is untouched by this one being full.
    await upload(theirs, pngOfSize(QUOTA / 2));
    await expect(prisma.attachment.count()).resolves.toBe(3);
  });

  it('keeps the per-file 413 distinguishable — its error is not the quota error', async () => {
    // The other half of the discriminator: if both 413s carried the same `error`, the web
    // would tell users with a full workspace to shrink their file.
    await setQuotas({ workspace: QUOTA });
    const where = await seed('quota-vs-size');

    const refused = await tryUpload(where, pngOfSize(MAX_BYTES + 1)).expect(413);
    expect(refused.body.error).not.toBe(ATTACHMENT_QUOTA_ERROR);
  });

  it('is unlimited when the variable is 0, the explicit opt-out', async () => {
    await setQuotas({ workspace: PNG.length });
    const where = await seed('quota-lifted');

    // Configured: a second file cannot fit behind the first.
    await upload(where, PNG);
    await tryUpload(where, PNG).expect(413);

    // `0`: the same upload sails through, and so does one behind a workspace already holding
    // more than the 2 GiB default. An operator who writes 0 has opted out, not blanked a line.
    await setQuotas({ workspace: 0 });
    const seeded = await seedStoredBytes(where, DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES);
    await upload(where, PNG);
    await expect(prisma.attachment.count()).resolves.toBe(2 + seeded);
    await expect(storedFileCount()).resolves.toBe(2);
  });

  it('refuses the upload that would cross the 2 GiB workspace default with no quota variable set', async () => {
    for (const name of QUOTA_VARS) expect(process.env[name]).toBeUndefined();
    const where = await seed('default-workspace');
    // Just under the default: exactly one more PNG fits.
    await seedStoredBytes(where, DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES - PNG.length);

    // The ceiling is inclusive, so the file that fills it to the byte lands...
    await upload(where, PNG);
    // ...and the next one is the 413 an unconfigured instance now answers.
    const refused = await tryUpload(where, PNG).expect(413);

    expect(refused.body.error).toBe(ATTACHMENT_QUOTA_ERROR);
    expect(refused.body.statusCode).toBe(413);
    // Only the one accepted upload reached the disk; the seeded rows never had bytes.
    await expect(storedFileCount()).resolves.toBe(1);
  });

  it('refuses the upload that would cross the 20 GiB instance default, summed across workspaces', async () => {
    // The instance default is ten workspace defaults, so two workspaces held to their own
    // default can never reach it; the workspace ceiling is opted out (0) to isolate the
    // instance one, which stays unset and therefore on its default.
    await setQuotas({ workspace: 0 });
    expect(process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES).toBeUndefined();
    const first = await seed('default-instance-a');
    const second = await seed('default-instance-b');
    const half = DEFAULT_ATTACHMENT_INSTANCE_QUOTA_BYTES / 2;
    await seedStoredBytes(first, half);
    await seedStoredBytes(second, half - PNG.length);

    // Fills the instance exactly; what refuses the next one is the sum over both workspaces,
    // neither of which has a ceiling of its own any more.
    await upload(second, PNG);
    const refused = await tryUpload(first, PNG).expect(413);

    expect(refused.body.error).toBe(ATTACHMENT_QUOTA_ERROR);
    await expect(storedFileCount()).resolves.toBe(1);
  });

  it('enforces the instance quota across workspaces that are each within their own', async () => {
    await setQuotas({ instance: QUOTA });
    const first = await seed('instance-a');
    const second = await seed('instance-b');

    await upload(first, pngOfSize(QUOTA / 2));
    await upload(second, pngOfSize(QUOTA / 2));

    // `second` has spent only half the instance quota itself; what refuses it is the sum over
    // every workspace. No workspace quota is set, so only the instance ceiling can be the cause.
    const refused = await tryUpload(second, PNG).expect(413);
    expect(refused.body.error).toBe(ATTACHMENT_QUOTA_ERROR);
    await expect(prisma.attachment.count()).resolves.toBe(2);
  });

  it('never counts a LINK against the quota, and never charges one to it', async () => {
    await setQuotas({ workspace: QUOTA });
    const where = await seed('links-free');

    // Links first: if their rows counted, the byte-exact fill below could not land.
    for (const url of ['https://example.com/a', 'https://example.com/b']) {
      await where.user.agent
        .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
        .send({ kind: AttachmentKind.Link, url })
        .expect(201);
    }

    await upload(where, pngOfSize(QUOTA));

    // And a full quota refuses bytes while still accepting a link — a LINK stores nothing, so
    // there is nothing for a byte quota to refuse (ADR 0027).
    await tryUpload(where, PNG).expect(413);
    await where.user.agent
      .post(`/workspaces/${where.workspaceId}/tasks/${where.taskId}/attachments`)
      .send({ kind: AttachmentKind.Link, url: 'https://example.com/c' })
      .expect(201);
  });
});
