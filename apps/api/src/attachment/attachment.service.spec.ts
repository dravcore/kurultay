import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  ActivityType,
  ATTACHMENT_QUOTA_ERROR,
  AttachmentKind,
  SocketEvents,
} from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../storage/storage.service';
import { AttachmentService } from './attachment.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d55';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';
const ATTACHMENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

function build(quotas: { workspaceQuotaBytes?: number; instanceQuotaBytes?: number } = {}) {
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    task: {
      findFirst: jest.fn().mockResolvedValue({ id: TASK_ID, title: 'T', boardId: BOARD_ID }),
    },
    attachment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { size: null } }),
    },
  } as unknown as PrismaService;
  const activity = {
    record: jest.fn().mockResolvedValue({ id: 'a' }),
  } as unknown as ActivityService;
  const realtime = { emitToBoard: jest.fn() } as unknown as RealtimeService;
  const storage = {
    persistsFiles: true,
    maxBytes: 26_214_400,
    workspaceQuotaBytes: quotas.workspaceQuotaBytes ?? 0,
    instanceQuotaBytes: quotas.instanceQuotaBytes ?? 0,
    write: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;
  return {
    service: new AttachmentService(prisma, activity, realtime, storage),
    prisma,
    activity,
    realtime,
    storage,
  };
}

/** A one-pixel PNG — real magic bytes, so `file-type` names it without a stub. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** The row a successful `createFile` resolves to; the shape, not the values, is what matters. */
function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    taskId: TASK_ID,
    kind: AttachmentKind.File,
    filename: 'shot.png',
    storageKey: '01/98/' + ATTACHMENT_ID,
    mimeType: 'image/png',
    size: PNG.length,
    url: null,
    uploadedById: ACTOR_ID,
    createdAt: new Date(0),
    ...overrides,
  };
}

/** A LINK row, for the two label tests below. */
function linkRowFixture() {
  return fileRow({
    kind: AttachmentKind.Link,
    storageKey: null,
    mimeType: null,
    size: null,
    url: 'https://example.com/a',
  });
}

describe('AttachmentService.list', () => {
  it('carries the tenant scope through the task relation and orders newest first', async () => {
    const { service, prisma } = build();

    await service.list(WORKSPACE_ID, TASK_ID);

    expect(prisma.attachment.findMany).toHaveBeenCalledWith({
      where: { taskId: TASK_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
      orderBy: { id: 'desc' },
    });
  });

  it('404s for a task in another workspace, before any attachment read', async () => {
    const { service, prisma } = build();
    (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.list(WORKSPACE_ID, TASK_ID)).rejects.toThrow(NotFoundException);
    expect(prisma.attachment.findMany).not.toHaveBeenCalled();
  });
});

describe('AttachmentService.findOne', () => {
  it('answers with the DTO and never with the storage key', async () => {
    const { service, prisma } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      kind: AttachmentKind.File,
      filename: 'contract.pdf',
      storageKey: '01/98/' + ATTACHMENT_ID,
      mimeType: 'application/pdf',
      size: 12,
      url: null,
      uploadedById: ACTOR_ID,
      createdAt: new Date(0),
      task: { boardId: BOARD_ID },
    });

    const dto = await service.findOne(WORKSPACE_ID, ATTACHMENT_ID);

    // `storageKey` is an internal address. Publishing it would invite a client to construct one,
    // which is the exact capability K9 removed.
    expect(dto).not.toHaveProperty('storageKey');
    expect(dto).toEqual({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      kind: AttachmentKind.File,
      filename: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 12,
      url: null,
      uploadedById: ACTOR_ID,
      createdAt: new Date(0).toISOString(),
    });
  });

  it('404s for an attachment in another workspace', async () => {
    const { service, prisma } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.findOne(WORKSPACE_ID, ATTACHMENT_ID)).rejects.toThrow(NotFoundException);
  });
});

describe('AttachmentService.createLink', () => {
  it('stores the url, writes an activity row and announces the task change', async () => {
    const { service, prisma, activity, realtime } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      kind: AttachmentKind.Link,
      filename: 'Design file',
      storageKey: null,
      mimeType: null,
      size: null,
      url: 'https://example.com/a',
      uploadedById: ACTOR_ID,
      createdAt: new Date(0),
    });

    await service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
      kind: AttachmentKind.Link,
      url: 'https://example.com/a',
      filename: 'Design file',
    });

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      kind: AttachmentKind.Link,
      url: 'https://example.com/a',
      storageKey: null,
      mimeType: null,
      size: null,
    });
    expect((activity.record as jest.Mock).mock.calls[0][1]).toMatchObject({
      type: ActivityType.AttachmentCreated,
    });
    // The module emits TASK_UPDATED itself rather than borrowing TaskEventsService (D3 /
    // ADR 0024). The event name and the payload shape are what K5 promises, so both are asserted
    // — a future edit that invents `attachment:added` fails here, not in review.
    expect(realtime.emitToBoard).toHaveBeenCalledWith(BOARD_ID, SocketEvents.TASK_UPDATED, {
      workspaceId: WORKSPACE_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      taskId: TASK_ID,
    });
  });

  it('falls back to the url as the display name when no filename is given', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      kind: AttachmentKind.Link,
      filename: 'https://example.com/a',
      storageKey: null,
      mimeType: null,
      size: null,
      url: 'https://example.com/a',
      uploadedById: ACTOR_ID,
      createdAt: new Date(0),
    });

    await service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
      kind: AttachmentKind.Link,
      url: 'https://example.com/a',
      filename: '   ',
    });

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename).toBe(
      'https://example.com/a',
    );
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://x/y'])(
    'refuses %s — only http and https are storable',
    async (url) => {
      const { service, prisma } = build();

      await expect(
        service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
          kind: AttachmentKind.Link,
          url,
          filename: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.attachment.create).not.toHaveBeenCalled();
    },
  );

  it('refuses a string that is not a URL at all', async () => {
    const { service, prisma } = build();

    await expect(
      service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
        kind: AttachmentKind.Link,
        url: 'not a url',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('404s for a task in another workspace before it judges the url', async () => {
    const { service, prisma } = build();
    (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
        kind: AttachmentKind.Link,
        url: 'https://example.com/a',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });
});

describe('AttachmentService.remove', () => {
  it('scopes the delete through the relation and writes the audit row', async () => {
    const { service, prisma, activity, realtime } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      filename: 'contract.pdf',
      kind: AttachmentKind.File,
      task: { boardId: BOARD_ID },
    });

    await service.remove(WORKSPACE_ID, ATTACHMENT_ID, ACTOR_ID);

    expect(prisma.attachment.deleteMany).toHaveBeenCalledWith({
      where: { id: ATTACHMENT_ID, task: { board: { workspaceId: WORKSPACE_ID } } },
    });
    expect((activity.record as jest.Mock).mock.calls[0][1]).toMatchObject({
      type: ActivityType.AttachmentDeleted,
    });
    expect(realtime.emitToBoard).toHaveBeenCalledWith(BOARD_ID, SocketEvents.TASK_UPDATED, {
      workspaceId: WORKSPACE_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      taskId: TASK_ID,
    });
  });

  it('does not delete the bytes inline — the sweep owns that', async () => {
    const { service, prisma, storage } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      filename: 'contract.pdf',
      kind: AttachmentKind.File,
      storageKey: '01/98/' + ATTACHMENT_ID,
      task: { boardId: BOARD_ID },
    });

    await service.remove(WORKSPACE_ID, ATTACHMENT_ID, ACTOR_ID);

    // Cascades from `Workspace → Board → Task` never call application code, so an inline unlink
    // would miss every bulk delete and give the codebase two deletion paths, one of which is
    // wrong most of the time. The sweep is the single one (ADR 0022).
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('raises not found when the attachment belongs to another workspace', async () => {
    const { service, prisma } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.remove(WORKSPACE_ID, ATTACHMENT_ID, ACTOR_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.attachment.deleteMany).not.toHaveBeenCalled();
  });

  it('raises not found when the row vanishes between the read and the write', async () => {
    const { service, prisma, activity, realtime } = build();
    (prisma.attachment.findFirst as jest.Mock).mockResolvedValue({
      id: ATTACHMENT_ID,
      taskId: TASK_ID,
      filename: 'contract.pdf',
      kind: AttachmentKind.File,
      task: { boardId: BOARD_ID },
    });
    (prisma.attachment.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(service.remove(WORKSPACE_ID, ATTACHMENT_ID, ACTOR_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(activity.record).not.toHaveBeenCalled();
    expect(realtime.emitToBoard).not.toHaveBeenCalled();
  });
});

describe('AttachmentService.createFile', () => {
  const file = (overrides: Record<string, unknown> = {}) => ({
    originalname: 'shot.png',
    mimetype: 'application/octet-stream',
    size: PNG.length,
    buffer: PNG,
    ...overrides,
  });

  it('writes the bytes before the row, and keys the file on the id it generated', async () => {
    const { service, prisma, storage } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    await service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file());

    const [key] = (storage.write as jest.Mock).mock.calls[0];
    const { data } = (prisma.attachment.create as jest.Mock).mock.calls[0][0];
    expect(key).toBe(data.storageKey);
    expect(key).toContain(data.id);
    expect((storage.write as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (prisma.attachment.create as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('stores the sniffed type, not the declared one', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    // The client claimed something else entirely; the row must not carry it.
    await service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file());

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.mimeType).toBe(
      'image/png',
    );
  });

  it('stores the length of the bytes it wrote, not the size the caller declared', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    // `size` is what `Content-Length` is built from on the download. A row that trusts the
    // caller's number can therefore promise a length the stream never produces, which a browser
    // sees as a hung or truncated download rather than as an error.
    await service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file({ size: 999_999 }));

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.size).toBe(PNG.length);
  });

  it('records the upload as an activity and announces the task change', async () => {
    const { service, prisma, activity, realtime } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    await service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file());

    expect((activity.record as jest.Mock).mock.calls[0][1]).toMatchObject({
      type: ActivityType.AttachmentCreated,
    });
    expect(realtime.emitToBoard).toHaveBeenCalledWith(BOARD_ID, SocketEvents.TASK_UPDATED, {
      workspaceId: WORKSPACE_ID,
      boardId: BOARD_ID,
      actorId: ACTOR_ID,
      taskId: TASK_ID,
    });
  });

  it('never writes a row when the bytes are not an accepted type', async () => {
    const { service, prisma, storage } = build();

    await expect(
      service.createFile(
        WORKSPACE_ID,
        TASK_ID,
        ACTOR_ID,
        file({
          mimetype: 'image/png',
          size: 40,
          buffer: Buffer.from('<!doctype html><script>alert(1)</script>'),
        }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    expect(storage.write).not.toHaveBeenCalled();
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  describe('storage quotas (SEC-02 / ADR 0027)', () => {
    it('refuses a file the workspace quota cannot hold, before a byte is written', async () => {
      const { service, prisma, storage } = build({ workspaceQuotaBytes: PNG.length + 10 });
      (prisma.attachment.aggregate as jest.Mock).mockResolvedValue({ _sum: { size: 11 } });

      const failure = await service
        .createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file())
        .then(() => null)
        .catch((caught: PayloadTooLargeException) => caught);

      expect(failure).toBeInstanceOf(PayloadTooLargeException);
      // The discriminator a client branches on: same 413 as the per-file limit, different
      // `error` (docs/api-conventions.md#errors).
      expect((failure?.getResponse() as { error: string }).error).toBe(ATTACHMENT_QUOTA_ERROR);
      expect(storage.write).not.toHaveBeenCalled();
      expect(prisma.attachment.create).not.toHaveBeenCalled();

      // Only FILE rows spend quota, and only this workspace's — a LINK stores no bytes.
      expect(prisma.attachment.aggregate).toHaveBeenCalledWith({
        _sum: { size: true },
        where: { kind: AttachmentKind.File, task: { board: { workspaceId: WORKSPACE_ID } } },
      });
    });

    it('accepts a file that fills the workspace quota exactly — the ceiling is inclusive', async () => {
      const { service, prisma } = build({ workspaceQuotaBytes: PNG.length + 10 });
      (prisma.attachment.aggregate as jest.Mock).mockResolvedValue({ _sum: { size: 10 } });
      (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

      await expect(
        service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file()),
      ).resolves.toBeDefined();
    });

    it('refuses on the instance quota, summed with no workspace scope', async () => {
      const { service, prisma, storage } = build({ instanceQuotaBytes: PNG.length });
      (prisma.attachment.aggregate as jest.Mock).mockResolvedValue({ _sum: { size: 1 } });

      const failure = await service
        .createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file())
        .then(() => null)
        .catch((caught: PayloadTooLargeException) => caught);

      expect(failure).toBeInstanceOf(PayloadTooLargeException);
      expect((failure?.getResponse() as { error: string }).error).toBe(ATTACHMENT_QUOTA_ERROR);
      expect(storage.write).not.toHaveBeenCalled();
      expect(prisma.attachment.aggregate).toHaveBeenCalledWith({
        _sum: { size: true },
        where: { kind: AttachmentKind.File },
      });
    });

    it('issues no aggregate query at all when both quotas are opted out with 0', async () => {
      // `0` must cost nothing: an instance that lifts both ceilings keeps the pre-quota upload
      // path, query for query.
      const { service, prisma } = build();
      (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

      await service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file());

      expect(prisma.attachment.aggregate).not.toHaveBeenCalled();
    });

    it('treats an empty workspace as holding zero bytes, not as unmeasurable', async () => {
      // Prisma's `_sum.size` is `null` over no rows; a `NaN` here would make every comparison
      // false and quietly disable the quota.
      const { service, prisma, storage } = build({ workspaceQuotaBytes: 1 });
      (prisma.attachment.aggregate as jest.Mock).mockResolvedValue({ _sum: { size: null } });

      await expect(service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file())).rejects.toThrow(
        PayloadTooLargeException,
      );
      expect(storage.write).not.toHaveBeenCalled();
    });
  });

  it('404s for a task in another workspace before a byte is written', async () => {
    const { service, prisma, storage } = build();
    (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file())).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('removes the bytes it just wrote when the row cannot be written', async () => {
    const { service, prisma, storage } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('db is down'));

    await expect(service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file())).rejects.toThrow(
      'db is down',
    );

    expect(storage.remove).toHaveBeenCalledWith((storage.write as jest.Mock).mock.calls[0][0]);
  });

  it('still reports the original failure when the cleanup unlink also fails', async () => {
    const { service, prisma, storage } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('db is down'));
    (storage.remove as jest.Mock).mockRejectedValue(new Error('disk gone'));

    // A cleanup that cannot succeed must not replace the diagnosis; the file is then an orphan,
    // which is a state the sweep already exists to handle.
    await expect(service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file())).rejects.toThrow(
      'db is down',
    );
  });

  it('keeps the caller-supplied filename out of the storage key entirely', async () => {
    const { service, storage, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    await service.createFile(
      WORKSPACE_ID,
      TASK_ID,
      ACTOR_ID,
      file({ originalname: '../../../../etc/passwd', mimetype: 'image/png' }),
    );

    expect((storage.write as jest.Mock).mock.calls[0][0]).not.toContain('..');
    expect((storage.write as jest.Mock).mock.calls[0][0]).not.toContain('passwd');
  });

  it('shows the basename and drops the directory part of a traversal-shaped name', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    await service.createFile(
      WORKSPACE_ID,
      TASK_ID,
      ACTOR_ID,
      file({ originalname: '../../../../etc/passwd' }),
    );

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename).toBe('passwd');
  });

  it('strips the characters that would break out of a Content-Disposition header', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    await service.createFile(
      WORKSPACE_ID,
      TASK_ID,
      ACTOR_ID,
      file({ originalname: 'a"b\\c\r\nX-Evil: 1.png' }),
    );

    const stored = (prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename;
    expect(stored).not.toMatch(/["\\\r\n]/);
  });

  /**
   * The phishing surface `displayFilename` was already written to close, in the shape it did
   * not close: `invoice<RLO>gnp.exe` renders as `invoiceexe.png` wherever the name is shown.
   * Measured through the real upload path before the fix — the character reached the row, the
   * DTO and the download header untouched.
   */
  it.each(['\u202e', '\u202a', '\u2069', '\u200e', '\u061c'])(
    'strips the bidi control %j out of an uploaded filename',
    async (control) => {
      const { service, prisma } = build();
      (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

      await service.createFile(
        WORKSPACE_ID,
        TASK_ID,
        ACTOR_ID,
        file({ originalname: `invoice${control}gnp.exe` }),
      );

      expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename).toBe(
        'invoicegnp.exe',
      );
    },
  );

  // The control. A rule that dropped every non-ASCII character would satisfy the assertions
  // above and would also undo the `defParamCharset: utf8` fix #216 measured into place.
  it('leaves an ordinary non-ASCII filename intact', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    await service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file({ originalname: 'ölçüm.png' }));

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename).toBe(
      'ölçüm.png',
    );
  });

  /**
   * The LINK branch went through no cleaning at all until this test. Its label never reaches a
   * `Content-Disposition` — the byte stream answers 404 for a LINK — but it reaches the same
   * panel, where the override reads the same way.
   */
  it('strips the same characters from a LINK label, which had no cleaning at all', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(linkRowFixture());

    await service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
      kind: AttachmentKind.Link,
      url: 'https://example.com/a',
      filename: 'inv\u202egnp.exe\r\nX-Injected: 1',
    });

    const stored = (prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename;
    expect(stored).toBe('invgnp.exeX-Injected: 1');
  });

  it('falls back to the url when the LINK label was made only of stripped characters', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(linkRowFixture());

    await service.createLink(WORKSPACE_ID, TASK_ID, ACTOR_ID, {
      kind: AttachmentKind.Link,
      url: 'https://example.com/a',
      filename: '\u202e\u202a\u0000',
    });

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename).toBe(
      'https://example.com/a',
    );
  });
  it('falls back to a name when the caller sent one made only of stripped characters', async () => {
    const { service, prisma } = build();
    (prisma.attachment.create as jest.Mock).mockResolvedValue(fileRow());

    await service.createFile(WORKSPACE_ID, TASK_ID, ACTOR_ID, file({ originalname: '"""' }));

    expect((prisma.attachment.create as jest.Mock).mock.calls[0][0].data.filename).toBe(
      'attachment',
    );
  });
});
