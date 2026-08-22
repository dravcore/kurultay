import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  ActivityType,
  ATTACHMENT_QUOTA_ERROR,
  AttachmentKind,
  SocketEvents,
} from '@kurul/shared-types';
import type { AttachmentDto } from '@kurul/shared-types';
import type { Prisma } from '../generated/prisma';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../storage/storage.service';
import { assertAllowedMimeType } from './attachment-mime';
import { storageKeyFor } from './attachment-storage-key';
import { toAttachmentDto, type AttachmentRow } from './attachment.mapper';
import type { CreateAttachmentDto } from './dto/create-attachment.dto';
import type { UploadedFile } from './multer-file';

/** The only two schemes a stored URL may carry. See K7 / ADR 0024. */
const ALLOWED_URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Attachments on a task.
 *
 * Its own module rather than a sub-resource of `task/` (ADR 0024): three of the five endpoints
 * are addressed by attachment id and not through a task, and the module carries a storage port,
 * a multer interceptor and the API's only byte-streaming handler — none of which belong in the
 * file issue #40 already asks to shrink.
 *
 * The tenant scope rides the relation the way `ChecklistService` rides it, and the task is
 * resolved here rather than through `TaskReadService`, which `task.module.ts` deliberately does
 * not export — the same choice `CommentService.findTask` made.
 *
 * The realtime announcement is made here too, through `RealtimeService` directly, rather than
 * through `TaskEventsService.emitUpdated`. `emitUpdated` re-reads the task so that the HTTP
 * response and the broadcast describe one state; these endpoints answer with `AttachmentDto` and
 * never with `TaskDto`, so there is no such response to keep in step, and exporting another
 * module's internals to get it would be paying for a guarantee nothing here needs (ADR 0024).
 * The event and the payload are still exactly what a task mutation emits — that is K5, and it is
 * unchanged.
 */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
  ) {}

  /** One place builds the broadcast, so the four fields cannot drift between call sites. */
  private announce(workspaceId: string, boardId: string, taskId: string, actorId: string): void {
    this.realtime.emitToBoard(boardId, SocketEvents.TASK_UPDATED, {
      workspaceId,
      boardId,
      actorId,
      taskId,
    });
  }

  async list(workspaceId: string, taskId: string): Promise<AttachmentDto[]> {
    await this.findTask(workspaceId, taskId);
    const rows = await this.prisma.attachment.findMany({
      where: { taskId, task: { board: { workspaceId } } },
      // Newest first, and no cursor page: a task's attachments are naturally few and, unlike
      // comments, do not grow without bound. `id` is UUIDv7, so this is `createdAt desc` served
      // from `@@index([taskId, id])` (plan decision D1/D11).
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => toAttachmentDto(row as AttachmentRow));
  }

  async findOne(workspaceId: string, attachmentId: string): Promise<AttachmentDto> {
    return toAttachmentDto(await this.requireAttachment(workspaceId, attachmentId));
  }

  /**
   * The row rather than the DTO, for the download path.
   *
   * The one caller needs `storageKey`, which `AttachmentDto` deliberately does not carry (K9).
   * Exposing the read rather than the key keeps the tenant scope on this side of the boundary:
   * `AttachmentDownloadService` never writes a `where` clause of its own.
   */
  async findRow(workspaceId: string, attachmentId: string): Promise<AttachmentRow> {
    return this.requireAttachment(workspaceId, attachmentId);
  }

  async createLink(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: CreateAttachmentDto,
  ): Promise<AttachmentDto> {
    const task = await this.findTask(workspaceId, taskId);
    const url = this.requireStorableUrl(dto.url);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attachment.create({
        data: {
          taskId: task.id,
          uploadedById: actorId,
          kind: AttachmentKind.Link,
          // The same cleaning the upload path applies, and for the same reason: this label is
          // rendered in the panel, where a bidi override reverses whatever follows it. The
          // basename step is deliberately not applied — a LINK's label is free text, and
          // `docs/spec` is a name somebody meant rather than a path somebody smuggled.
          filename: safeDisplayName(dto.filename ?? '') || url,
          storageKey: null,
          mimeType: null,
          size: null,
          url,
        },
      });
      await this.activity.record(tx, {
        workspaceId,
        taskId: task.id,
        userId: actorId,
        type: ActivityType.AttachmentCreated,
        payload: { attachmentId: row.id, kind: AttachmentKind.Link, filename: row.filename },
      });
      return row as AttachmentRow;
    });

    this.announce(workspaceId, task.boardId, task.id, actorId);
    return toAttachmentDto(created);
  }

  async createFile(
    workspaceId: string,
    taskId: string,
    actorId: string,
    file: UploadedFile,
  ): Promise<AttachmentDto> {
    const task = await this.findTask(workspaceId, taskId);

    // Sniff before anything is written anywhere. The declared `mimetype` and the extension both
    // come from the caller and neither is evidence (K3); this throws a 415 that
    // `transformException` passes through untouched.
    const mimeType = await assertAllowedMimeType(file.buffer, file.mimetype);

    // Quota after the sniff, not before: a refused type is refused whatever the quota says, and
    // the sniff is CPU-local while this costs up to two aggregate queries. Still ahead of the
    // byte write, so an over-quota upload never touches the disk it is being kept off of.
    await this.assertWithinQuota(workspaceId, file.buffer.length);

    // The id is generated here rather than left to `@default(uuid(7))` because the storage key
    // is derived from it and the bytes are written first (plan decision D6). `uuidv7` is already
    // a dependency (`auth/auth.ts`, `common/logging/request-id.ts`).
    const id = uuidv7();
    const storageKey = storageKeyFor(id);

    // Bytes first, row second. The worst outcome of this order is a file with no row, which the
    // nightly sweep removes after the grace period. The worst outcome of the other order is a
    // row with no bytes — a broken download that no sweep can repair. The cheap direction of
    // being wrong is the one that gets chosen (D6).
    await this.storage.write(storageKey, file.buffer);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.attachment.create({
          data: {
            id,
            taskId: task.id,
            uploadedById: actorId,
            kind: AttachmentKind.File,
            filename: displayFilename(file.originalname),
            storageKey,
            mimeType,
            // `buffer.length`, not `file.size`. They agree under `memoryStorage()`, but only one
            // of them is the number of bytes that reached the disk, and this value becomes
            // `Content-Length` on the download — where disagreeing with the stream is a hung or
            // truncated transfer rather than an error anyone sees.
            size: file.buffer.length,
            url: null,
          },
        });
        await this.activity.record(tx, {
          workspaceId,
          taskId: task.id,
          userId: actorId,
          type: ActivityType.AttachmentCreated,
          payload: { attachmentId: row.id, kind: AttachmentKind.File, filename: row.filename },
        });
        return row as AttachmentRow;
      });

      this.announce(workspaceId, task.boardId, task.id, actorId);
      return toAttachmentDto(created);
    } catch (error) {
      // Best effort. If this also fails the file is an orphan, which is a state the sweep
      // already exists to handle — so the rethrow below is never delayed by a cleanup that
      // cannot succeed.
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async remove(workspaceId: string, attachmentId: string, actorId: string): Promise<void> {
    const attachment = await this.requireAttachment(workspaceId, attachmentId);

    await this.prisma.$transaction(async (tx) => {
      // deleteMany, not delete: only deleteMany accepts a relation predicate, so the tenant
      // scope travels with the write rather than resting on the read above.
      const { count } = await tx.attachment.deleteMany({
        where: { id: attachmentId, task: { board: { workspaceId } } },
      });
      if (count === 0) throw new NotFoundException('Attachment not found');

      // One row per singular detach, and only here. A workspace/board/task delete cascades
      // inside Postgres with no application code running, so this write can never describe a
      // bulk removal — which is the boundary `activity.ts`'s comment on `attachment.deleted`
      // claims, and the reason this call sits on this path and nowhere else.
      await this.activity.record(tx, {
        workspaceId,
        taskId: attachment.taskId,
        userId: actorId,
        type: ActivityType.AttachmentDeleted,
        payload: {
          attachmentId,
          kind: attachment.kind,
          filename: attachment.filename,
        },
      });
    });

    // The bytes are NOT unlinked here, and that is the design rather than an omission:
    // `Workspace → Board → Task` cascades entirely inside Postgres, so an inline unlink would
    // miss every bulk delete and leave the codebase with two deletion paths, one of which is
    // wrong most of the time. The nightly sweep owns it (ADR 0022, Görev 9).
    this.announce(workspaceId, attachment.task.boardId, attachment.taskId, actorId);
  }

  /**
   * `http:`/`https:` and nothing else.
   *
   * `javascript:` rendered into an `href` is stored XSS with one click, and `data:`/`file:` are
   * the same trick with different spelling. The server also never *requests* whatever this
   * returns — see K7 for why a link preview is a capability and not a feature.
   */
  private requireStorableUrl(value: string | undefined): string {
    let parsed: URL;
    try {
      parsed = new URL((value ?? '').trim());
    } catch {
      throw new BadRequestException('A link attachment needs an http or https URL');
    }
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
      throw new BadRequestException('A link attachment needs an http or https URL');
    }
    return parsed.toString();
  }

  /**
   * The storage quotas, checked before any byte is written (SEC-02 / ADR 0027).
   *
   * Both ceilings are **soft**: this is a check-then-write, so N concurrent uploads that each
   * pass the check can each land, overshooting the quota by at most one file apiece — bounded
   * by `ATTACHMENT_MAX_BYTES` per request. That race is accepted in the ADR rather than closed
   * with a lock; what a quota defends against is unbounded disk consumption, and the overshoot
   * is bounded.
   *
   * The ceiling is inclusive — a file that fills the quota exactly is accepted — and only FILE
   * rows count: a LINK stores no bytes, so it spends nothing. `0` (the explicit opt-out; the
   * defaults are finite since ADR 0027's 2026-08-21 update) disables a ceiling entirely, in
   * which case this method issues no query at all.
   *
   * The 413 carries `error: ATTACHMENT_QUOTA_ERROR` so a client can tell it from the per-file
   * size limit's 413 without reading `message` — the field `docs/api-conventions.md#errors`
   * says to branch on. The messages deliberately avoid multer's error-string constants
   * (`File too large`, …), which `transformException` matches on (ADR 0022).
   */
  private async assertWithinQuota(workspaceId: string, incomingBytes: number): Promise<void> {
    const workspaceQuota = this.storage.workspaceQuotaBytes;
    const instanceQuota = this.storage.instanceQuotaBytes;

    if (workspaceQuota > 0) {
      const used = await this.storedFileBytes({ task: { board: { workspaceId } } });
      if (used + incomingBytes > workspaceQuota) {
        throw new PayloadTooLargeException({
          message: 'This file does not fit in the workspace attachment storage quota',
          error: ATTACHMENT_QUOTA_ERROR,
        });
      }
    }
    if (instanceQuota > 0) {
      const used = await this.storedFileBytes({});
      if (used + incomingBytes > instanceQuota) {
        throw new PayloadTooLargeException({
          message: "This file does not fit in the instance's attachment storage quota",
          error: ATTACHMENT_QUOTA_ERROR,
        });
      }
    }
  }

  /**
   * Bytes currently stored for FILE rows matching `scope` — a `SUM` over `size`, measured
   * against live rows. A detached attachment frees its quota immediately even though the sweep
   * removes its bytes later (ADR 0022): the quota governs what the database owns, and the
   * sweep's grace window is the disk lagging that answer, not a second bookkeeping.
   */
  private async storedFileBytes(scope: Prisma.AttachmentWhereInput): Promise<number> {
    const { _sum } = await this.prisma.attachment.aggregate({
      _sum: { size: true },
      where: { kind: AttachmentKind.File, ...scope },
    });
    return _sum.size ?? 0;
  }

  private async requireAttachment(
    workspaceId: string,
    attachmentId: string,
  ): Promise<AttachmentRow & { task: { boardId: string } }> {
    const row = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, task: { board: { workspaceId } } },
      // The board id comes back on the same read the tenant check already needs, so the
      // broadcast costs no extra query — the relation the scope travels on carries it.
      include: { task: { select: { boardId: true } } },
    });
    // 404, never 403 — a 403 would confirm the row exists (docs/api-conventions.md).
    if (!row) throw new NotFoundException('Attachment not found');
    return row as AttachmentRow & { task: { boardId: string } };
  }

  private async findTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
      select: { id: true, title: true, boardId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}

/**
 * Everything that must not survive into a stored display name, in one class.
 *
 * Three groups, each load-bearing for a different reason:
 *
 *   * `"` and `\` — the two characters that close `Content-Disposition`'s quoted parameter
 *     early. This string is later written into that header (D8).
 *   * **C0 and C1 controls**, which subsume the CR and LF the first version named explicitly,
 *     and also cover the rest of the range: a tab or an `ESC` in a name is never anything a
 *     client meant, and `ESC` specifically is an escape sequence in any log or terminal the
 *     name is ever echoed to.
 *   * **The Unicode bidi overrides** — U+200E/U+200F, U+061C, U+202A-U+202E and the isolates
 *     U+2066-U+2069. These are the group that was missing, and the one with a real attack:
 *     `invoice‮gnp.exe` *renders* as `invoiceexe.png` in the panel and in the browser's own
 *     download prompt, because U+202E reverses everything after it. Measured through the real
 *     upload path before the fix: the character reached the row, the DTO and the
 *     `filename*=UTF-8''…` parameter untouched, so the save dialog showed the reversed name.
 *     Nothing else in the pipeline would have caught it — the ASCII half of the header maps it
 *     to `_`, which is exactly why the RFC 5987 half is where it survived.
 *
 * Nothing here is about paths. Traversal is unexpressible rather than filtered (the key comes
 * from the row's own UUIDv7, K9); the basename is kept in `displayFilename` because
 * `../../../../etc/passwd` shown as a filename is a phishing surface, and a name is a name.
 */
const UNSAFE_DISPLAY_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- the control range is the point, not an oversight.
  /["\\\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * The display name for any attachment, whatever wrote it.
 *
 * Both kinds go through this. A LINK's label never reaches a `Content-Disposition` — the byte
 * stream answers 404 for a LINK — but it reaches the same panel, and the bidi override reads the
 * same way there. Applying the rule to one kind and not the other would make "the stored name is
 * safe to render" a claim that depends on which branch created the row.
 */
function safeDisplayName(value: string): string {
  return value.replace(UNSAFE_DISPLAY_CHARACTERS, '').trim().slice(0, 255);
}

/**
 * The name shown next to a FILE attachment.
 *
 * The basename, cleaned, with a fallback for the name that was made entirely of characters the
 * class above removes.
 */
function displayFilename(original: string): string {
  const base = original.split(/[/\\]/).pop() ?? '';
  const cleaned = safeDisplayName(base);
  return cleaned === '' ? 'attachment' : cleaned;
}
