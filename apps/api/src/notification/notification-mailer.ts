import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_LOCALE, NotificationType, matchLocale } from '@kurul/shared-types';
import { buildTaskUrl } from '../auth/web-urls';
import type { MailMessage } from '../mail/mail-sender';
import { buildAssignmentEmail, buildDueSoonEmail, buildMentionEmail } from '../mail/mail-templates';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

/** One stored `Notification` row, as much of it as the email needs to find the rest. */
export interface NotificationMailInput {
  workspaceId: string;
  /** Recipient. */
  userId: string;
  /** The member whose action this is, or `null` for a scheduled one (due-soon). */
  actorId: string | null;
  type: NotificationType;
  taskId: string;
}

/**
 * Sends the email half of a notification.
 *
 * Called after the transaction that stored the rows has committed, for the same reason
 * `emitUnreadChanged` is: an email about a row that is then rolled back is a link to nothing.
 * One email per row and no digest, which is the batching the product already has for free:
 * the mention path stores one row per mentioned member per comment, and the due-soon scan
 * skips a pair it reminded in the last 24 hours. Whether that stays enough is an open question
 * on the roadmap row, not a decision made here.
 *
 * Never rejects. A notification email is a side effect of the request that caused it, never
 * its result (`mail/send-mail.ts` makes the same argument for the invitation email), so a
 * lookup that fails or a relay that refuses is logged and the next row is tried.
 */
@Injectable()
export class NotificationMailer {
  private readonly logger = new Logger(NotificationMailer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async sendForCreated(items: readonly NotificationMailInput[]): Promise<void> {
    // Before any lookup: an instance without SMTP does no extra work per notification, and
    // sees no behaviour change from this module existing.
    if (items.length === 0 || !this.mail.isEnabled()) return;

    for (const item of items) {
      try {
        const message = await this.build(item);
        if (message) await this.mail.send(message);
      } catch (caught) {
        this.logger.error(
          `Could not email a ${item.type} notification to user ${item.userId}`,
          caught instanceof Error ? caught.stack : String(caught),
        );
      }
    }
  }

  /** `null` when there is nothing to send: opted out, actor is the recipient, row gone. */
  private async build(item: NotificationMailInput): Promise<MailMessage | null> {
    // Every path that stores a row already refuses the actor as its own recipient; repeated
    // here because this is the cheaper place to be wrong about it.
    if (item.actorId === item.userId) return null;

    const recipient = await this.prisma.user.findUnique({
      where: { id: item.userId },
      select: { email: true, locale: true, emailNotifications: true, deletedAt: true },
    });
    if (!recipient || recipient.deletedAt !== null || !recipient.emailNotifications) return null;

    // Scoped through the board: a task id from another workspace resolves to nothing, the
    // same way every other read in the API is fenced.
    const task = await this.prisma.task.findFirst({
      where: { id: item.taskId, board: { workspaceId: item.workspaceId } },
      select: {
        title: true,
        dueDate: true,
        boardId: true,
        board: { select: { workspace: { select: { name: true } } } },
      },
    });
    if (!task) return null;

    const common = {
      to: recipient.email,
      taskTitle: task.title,
      workspaceName: task.board.workspace.name,
      taskUrl: buildTaskUrl(task.boardId, item.taskId),
      // The recipient's stored choice only. There is no request to negotiate from, and the
      // actor's language is theirs, not the recipient's.
      locale: matchLocale(recipient.locale) ?? DEFAULT_LOCALE,
    };

    switch (item.type) {
      case NotificationType.Assignment:
        return buildAssignmentEmail({ ...common, actorName: await this.actorName(item.actorId) });
      case NotificationType.Mention:
        return buildMentionEmail({ ...common, actorName: await this.actorName(item.actorId) });
      case NotificationType.DueSoon:
        // A due-soon row for a task whose date was cleared since the scan is stale, not urgent.
        if (task.dueDate === null) return null;
        return buildDueSoonEmail({ ...common, dueDate: task.dueDate });
      default:
        return null;
    }
  }

  private async actorName(actorId: string | null): Promise<string> {
    if (actorId === null) return '';
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });
    return actor?.name ?? '';
  }
}
