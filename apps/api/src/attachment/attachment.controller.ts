import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnsupportedMediaTypeResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AttachmentKind } from '@kurul/shared-types';
import { ErrorEnvelopeSchema } from '../openapi/schemas/error.schema';
import { AttachmentSchema } from '../openapi/schemas/attachment.schema';
import type { AttachmentDto } from '@kurul/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import {
  CONTENT_ROLES,
  WorkspaceRoles,
  WorkspaceScoped,
} from '../common/decorators/workspace-roles.decorator';
import {
  ThrottleAttachmentDownload,
  ThrottleAttachmentUpload,
} from '../common/rate-limit/rate-limit';
import type { AuthenticatedUser } from '../common/types/request-context';
import { AttachmentDownloadService } from './attachment-download.service';
import { AttachmentService } from './attachment.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import type { UploadedFile as MulterFile } from './multer-file';
import { UploadBudgetGuard } from './upload-budget.guard';

/**
 * Mounted at the workspace root like `CommentController`, because three of its five routes are
 * addressed by attachment id rather than through a task (`api-conventions.md` — once a resource
 * has an id, address it shallowly).
 *
 * ## Deletion is open to every content role
 *
 * `CommentService.remove` draws an author/admin line (ADR 0012); this does not. The reasoning is
 * permission arithmetic rather than analogy: a user with the same role can already
 * `DELETE .../tasks/:taskId`, and `Attachment.taskId` is `onDelete: Cascade`, so that delete
 * takes the attachment with it. Restricting the single detach would close the less destructive
 * path while leaving the more destructive one open — a UI trap, not an authorization check.
 * ADR 0012's line protects a person's *statement*; a file is card content, the same class as a
 * checklist item, which carries the same decision.
 */
@ApiTags('Attachments')
@Controller('workspaces/:workspaceId')
export class AttachmentController {
  constructor(
    private readonly attachments: AttachmentService,
    private readonly downloads: AttachmentDownloadService,
  ) {}

  @Get('tasks/:taskId/attachments')
  @ApiOperation({
    summary: "List a task's attachments",
    description: 'Newest first. Not paginated — a task holds few enough of these to return all.',
  })
  @ApiOkResponse({ type: [AttachmentSchema] })
  @WorkspaceScoped()
  list(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
  ): Promise<AttachmentDto[]> {
    return this.attachments.list(workspaceId, taskId);
  }

  /**
   * One endpoint, two body shapes (plan decision D7).
   *
   * `FileInterceptor` is a no-op on a request that is not `multipart/form-data`:
   * `multer/lib/make-middleware.js:18` is `if (!is(req, ['multipart'])) return next()`. So a
   * JSON body carrying `kind: "LINK"` arrives here with `file` undefined and `dto` populated.
   * `kind` is read from the body rather than inferred from the file's presence, so a request
   * that carries neither gets a validation error naming what is missing.
   *
   * No options are passed here. `memoryStorage()` and `limits` come from
   * `MulterModule.registerAsync` in `attachment.module.ts`, which resolves them through DI at
   * module setup — inline options would be evaluated when this file is imported and would freeze
   * `ATTACHMENT_MAX_BYTES` for the process (plan decision D5).
   *
   * `UploadBudgetGuard` is a guard and not an interceptor for ordering: Nest runs every guard
   * before any interceptor, so the per-IP byte budget is charged and, if spent, refused before
   * `FileInterceptor` lets multer buffer a single byte of the body.
   */
  @Post('tasks/:taskId/attachments')
  @ApiOperation({
    summary: 'Attach a file or a link to a task',
    description: [
      'One endpoint, two request shapes, chosen by `kind` in the body and **never** inferred',
      'from whether a file part arrived:',
      '',
      '- `kind: "FILE"` — `multipart/form-data` with one part named `file`. The media type is',
      '  read from the **magic bytes**; the declared `Content-Type` and the filename extension',
      '  are not evidence and are not consulted. `text/html` and `image/svg+xml` are refused by',
      '  name. Plain text has no magic number and comes in through a narrow fallback: the',
      '  declared type must be exactly `text/plain` or `text/csv`, the bytes must decode as',
      '  UTF-8, contain no `NUL`, and not begin with `<`.',
      '- `kind: "LINK"` — `application/json` with a `url`. **The server stores it, returns it,',
      '  and never requests it** — no preview, no favicon, no unfurl, no health check. Only',
      '  `http:` and `https:` are accepted; anything else is `400`.',
      '',
      'A request carrying neither is `400` naming what is missing, rather than a guess.',
    ].join('\n'),
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    required: true,
    schema: {
      oneOf: [
        {
          title: 'FILE (multipart/form-data)',
          type: 'object',
          required: ['kind', 'file'],
          properties: {
            kind: { type: 'string', enum: [AttachmentKind.File] },
            file: {
              type: 'string',
              format: 'binary',
              description: 'The bytes. Over `ATTACHMENT_MAX_BYTES` is `413`.',
            },
            filename: {
              type: 'string',
              maxLength: 255,
              description: "Overrides the part's own filename. Never used as a path segment.",
            },
          },
        },
        {
          title: 'LINK (application/json)',
          allOf: [{ $ref: getSchemaPath(CreateAttachmentDto) }],
        },
      ],
    },
  })
  @ApiCreatedResponse({ type: AttachmentSchema })
  @ApiPayloadTooLargeResponse({
    description:
      "Two distinct ceilings answer with this status, told apart by the envelope's `error` " +
      'field. `"Payload Too Large"`: the **file part** is over `ATTACHMENT_MAX_BYTES` (default ' +
      '`26214400` — 25 MiB), which is a disk ceiling and is unrelated to ' +
      '`REQUEST_BODY_MAX_BYTES`: multipart bodies are read by multer, which the JSON body ' +
      'limit never sees. `"Attachment Quota Exceeded"`: the file fits on its own but would ' +
      "push the workspace's or the instance's stored FILE bytes past its quota " +
      '(`ATTACHMENT_WORKSPACE_QUOTA_BYTES`, default 2 GiB, or `ATTACHMENT_INSTANCE_QUOTA_BYTES`, ' +
      'default 20 GiB; `0` lifts one; ADR 0027). A reverse proxy in front of this API caps the ' +
      'whole request body ' +
      'separately and higher, and answers `413` with something that is not JSON at all — the ' +
      'response body is what tells the layers apart.',
    type: ErrorEnvelopeSchema,
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      "The file's magic bytes are not on the allowlist, or a `text/plain`/`text/csv` upload " +
      'failed one of the four fallback conditions.',
    type: ErrorEnvelopeSchema,
  })
  @ApiTooManyRequestsResponse({
    description:
      "Two budgets answer with this status, told apart by the envelope's `error` field. " +
      '`"Too Many Requests"`: more than 20 requests from this IP in the current minute, like ' +
      'any other throttled route. `"Upload Budget Exceeded"`: the bytes this IP has submitted ' +
      'to this route in the current minute, counted by `Content-Length` before the body is ' +
      'read, would pass `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE` (default `268435456`, 256 MiB; ' +
      '`0` turns the budget off). A multipart request without `Content-Length` is charged ' +
      '`ATTACHMENT_MAX_BYTES`. Both carry `Retry-After` with the seconds to wait.',
    headers: {
      'Retry-After': {
        description: 'Seconds to wait before retrying.',
        schema: { type: 'integer' },
      },
    },
    type: ErrorEnvelopeSchema,
  })
  @WorkspaceRoles(...CONTENT_ROLES)
  @ThrottleAttachmentUpload()
  @UseGuards(UploadBudgetGuard)
  @UseInterceptors(FileInterceptor('file'))
  create(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAttachmentDto,
    @UploadedFile() file?: MulterFile,
  ): Promise<AttachmentDto> {
    if (dto.kind === AttachmentKind.Link) {
      return this.attachments.createLink(workspaceId, taskId, user.id, dto);
    }
    if (file === undefined) {
      throw new BadRequestException('A file attachment needs a file part named "file"');
    }
    return this.attachments.createFile(workspaceId, taskId, user.id, file);
  }

  @Get('attachments/:attachmentId')
  @ApiOperation({ summary: 'Read one attachment' })
  @ApiOkResponse({ type: AttachmentSchema })
  @WorkspaceScoped()
  findOne(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('attachmentId') attachmentId: string,
  ): Promise<AttachmentDto> {
    return this.attachments.findOne(workspaceId, attachmentId);
  }

  /**
   * The byte stream.
   *
   * `@Res()`: this handler owns the response. Headers are written from the descriptor the
   * service resolved, and only then does the stream start. A failure *after* that point destroys
   * the socket instead of throwing, because a thrown error here would reach
   * `AllExceptionsFilter` with headers already sent (ADR 0022).
   *
   * Authorization is the guard chain, exactly as on every other route — `@WorkspaceScoped()`, a
   * session cookie, the 404-not-403 rule. This is a `GET`, so `origin-check.ts` does not cover
   * it by design; what covers it is the session plus the tenant scope, and the
   * `Cross-Origin-Resource-Policy: same-origin` the descriptor carries.
   */
  @Get('attachments/:attachmentId/content')
  @ApiOperation({
    summary: "Download an attachment's bytes",
    description: [
      '**The one endpoint in this API that does not answer with JSON.** It streams the stored',
      'file with the media type sniffed at upload — never the one the client declared.',
      '',
      'Asking for the content of a `LINK` is `404`, not `400`: there are no bytes, and saying',
      '"wrong kind" would confirm the row exists.',
    ].join('\n'),
  })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    description:
      "The stored bytes, with the file's own sniffed media type as `Content-Type` — one of " +
      'the image, PDF, office, ZIP or plain-text families on the upload allowlist, not ' +
      '`application/octet-stream`.',
    schema: { type: 'string', format: 'binary' },
    headers: {
      'Content-Disposition': {
        description:
          '`inline` for the four raster image types, so a panel can preview them; `attachment` ' +
          'for everything else, PDFs included.',
        schema: { type: 'string' },
      },
      'Content-Length': { description: 'Size in bytes.', schema: { type: 'integer' } },
      'X-Content-Type-Options': {
        description: 'Always `nosniff`.',
        schema: { type: 'string' },
      },
      'Cross-Origin-Resource-Policy': {
        description:
          'Always `same-origin`, overriding the `cross-origin` policy the API sets globally: ' +
          'the web app legitimately reads this API, and that argument does not extend to ' +
          'user-uploaded bytes.',
        schema: { type: 'string' },
      },
      'Cache-Control': {
        description: 'Always `private, max-age=0, must-revalidate`.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'No such attachment in this workspace, **or** the attachment is a `LINK` and therefore ' +
      'has no bytes.',
    type: ErrorEnvelopeSchema,
  })
  @WorkspaceScoped()
  @ThrottleAttachmentDownload()
  async content(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('attachmentId') attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, headers } = await this.downloads.open(workspaceId, attachmentId);

    res.set(headers);
    stream.on('error', () => {
      // Nothing to report to the client that it can act on, and nothing the filter can write.
      res.destroy();
    });
    stream.pipe(res);
  }

  @Delete('attachments/:attachmentId')
  @ApiOperation({
    summary: 'Detach an attachment',
    description:
      'Open to every content role, with no author line — unlike comment deletion. The same ' +
      'role can already delete the whole task and `Attachment.taskId` cascades, so gating the ' +
      'smaller act would be a UI trap rather than an authorization check.',
  })
  @ApiNoContentResponse({ description: 'Removed. Empty body.' })
  @HttpCode(204)
  @WorkspaceRoles(...CONTENT_ROLES)
  async remove(
    @UuidParam('workspaceId') workspaceId: string,
    @UuidParam('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.attachments.remove(workspaceId, attachmentId, user.id);
  }
}
