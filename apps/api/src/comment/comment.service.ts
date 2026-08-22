import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, MemberRole, NotificationType, SocketEvents } from '@kurul/shared-types';
import type { CommentDto, CursorPage } from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { AUTHOR_SELECT, toAuthorDto, type AuthorRow } from '../common/author';
import { parseMentions } from '../common/mentions/parse-mentions';
import { toCursorPage } from '../common/pagination/cursor-page';
import { NotificationMailer } from '../notification/notification-mailer';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { CreateCommentDto } from './dto/create-comment.dto';

export type CommentCursorQuery = {
  cursor?: string;
  limit?: number;
};

type CommentRow = {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: Date;
  user: AuthorRow;
};

@Injectable()
export class CommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly notificationService: NotificationService,
    private readonly realtime: RealtimeService,
    private readonly notificationMailer: NotificationMailer,
  ) {}

  private toDto(row: CommentRow): CommentDto {
    return {
      id: row.id,
      taskId: row.taskId,
      userId: row.userId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: toAuthorDto(row.user),
    };
  }

  /** Cursor-paginated, oldest first — id is UUIDv7 so `id asc` matches `createdAt asc`. */
  async list(
    workspaceId: string,
    taskId: string,
    query: CommentCursorQuery = {},
  ): Promise<CursorPage<CommentDto>> {
    await this.findTask(workspaceId, taskId);
    const limit = query.limit ?? 100;

    const rows = await this.prisma.comment.findMany({
      where: {
        taskId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      include: { user: { select: AUTHOR_SELECT } },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    return toCursorPage(rows, limit, (comment) => this.toDto(comment));
  }

  async create(
    workspaceId: string,
    taskId: string,
    userId: string,
    dto: CreateCommentDto,
  ): Promise<CommentDto> {
    const task = await this.findTask(workspaceId, taskId);
    const mentionIds = parseMentions(dto.body).filter((id) => id !== userId);

    // Hoisted out of the transaction so the mention signal can be published after it commits —
    // a signal sent from inside would race the COMMIT the recipient's refetch has to see.
    let mentionRecipients: string[] = [];

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          taskId,
          userId,
          body: dto.body,
        },
        include: { user: { select: AUTHOR_SELECT } },
      });

      let memberIds: string[] = [];
      if (mentionIds.length > 0) {
        const members = await tx.workspaceMember.findMany({
          where: { workspaceId, userId: { in: mentionIds } },
          select: { userId: true },
        });
        memberIds = members.map((m) => m.userId);
      }

      const activity = await this.activityService.record(tx, {
        workspaceId,
        taskId,
        userId,
        type: ActivityType.CommentCreated,
        payload: {
          commentId: created.id,
          title: task.title,
          mentionedUserIds: memberIds,
        },
      });

      if (memberIds.length > 0) {
        await this.notificationService.createMentionBatch(tx, {
          workspaceId,
          actorId: userId,
          taskId,
          activityId: activity.id,
          userIds: memberIds,
          payload: {
            commentId: created.id,
            taskId,
            title: task.title,
            actorId: userId,
          },
        });
        mentionRecipients = memberIds;
      }

      return this.toDto(created);
    });

    // One signal per mentioned user, however many rows the batch inserted, and one email each.
    if (mentionRecipients.length > 0) {
      this.notificationService.emitUnreadChanged(workspaceId, mentionRecipients);
      await this.notificationMailer.sendForCreated(
        mentionRecipients.map((recipientId) => ({
          workspaceId,
          userId: recipientId,
          actorId: userId,
          type: NotificationType.Mention,
          taskId,
        })),
      );
    }

    this.realtime.emitToBoard(task.boardId, SocketEvents.COMMENT_ADDED, {
      workspaceId,
      boardId: task.boardId,
      actorId: userId,
      taskId,
      commentId: comment.id,
    });
    return comment;
  }

  async remove(
    workspaceId: string,
    commentId: string,
    actorId: string,
    actorRole: MemberRole,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: a read outside it leaves a window in which the comment's
      // task can be moved to another workspace between the authorization check and the delete.
      const comment = await tx.comment.findFirst({
        where: { id: commentId, task: { board: { workspaceId } } },
      });
      if (!comment) throw new NotFoundException('Comment not found');

      const isAuthor = comment.userId === actorId;
      const isElevated = actorRole === MemberRole.OWNER || actorRole === MemberRole.ADMIN;
      if (!isAuthor && !isElevated) {
        throw new ForbiddenException('Only the author or an admin can delete this comment');
      }

      // deleteMany, not delete: only deleteMany accepts a relation predicate, so the tenant
      // scope (comment → task → board → workspace) travels with the write.
      const { count } = await tx.comment.deleteMany({
        where: { id: commentId, task: { board: { workspaceId } } },
      });
      // Cross-workspace access is 404, never 403 (docs/api-conventions.md) — a 403 would
      // confirm the row exists.
      if (count === 0) throw new NotFoundException('Comment not found');
    });
  }

  private async findTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, board: { workspaceId } },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
