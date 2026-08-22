import { Logger } from '@nestjs/common';
import { MailDeliveryStatus, NotificationType } from '@kurul/shared-types';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationMailer, type NotificationMailInput } from './notification-mailer';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d51';
const BOARD_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d52';
const RECIPIENT_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d53';
const ACTOR_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54';

function recipientRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'member@example.test',
    locale: null,
    emailNotifications: true,
    deletedAt: null,
    ...overrides,
  };
}

function taskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: 'Ship the release',
    dueDate: new Date('2026-09-01T00:00:00.000Z'),
    boardId: BOARD_ID,
    board: { workspace: { name: 'Analytical Engine' } },
    ...overrides,
  };
}

function assignment(overrides: Partial<NotificationMailInput> = {}): NotificationMailInput {
  return {
    workspaceId: WORKSPACE_ID,
    userId: RECIPIENT_ID,
    actorId: ACTOR_ID,
    type: NotificationType.Assignment,
    taskId: TASK_ID,
    ...overrides,
  };
}

describe('NotificationMailer', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  function build(options: { enabled?: boolean } = {}) {
    const userFindUnique = jest.fn(async (args: { where: { id: string } }) =>
      args.where.id === ACTOR_ID ? { name: 'Ada Lovelace' } : recipientRow(),
    );
    const prisma = {
      user: { findUnique: userFindUnique },
      task: { findFirst: jest.fn().mockResolvedValue(taskRow()) },
    };
    const mail = {
      isEnabled: jest.fn().mockReturnValue(options.enabled ?? true),
      send: jest.fn().mockResolvedValue(MailDeliveryStatus.SENT),
    };
    const mailer = new NotificationMailer(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
    );
    return { mailer, prisma, mail, userFindUnique };
  }

  it('sends an assignment email naming the actor and linking to the card', async () => {
    const { mailer, mail } = build();

    await mailer.sendForCreated([assignment()]);

    expect(mail.send).toHaveBeenCalledTimes(1);
    const message = mail.send.mock.calls[0][0];
    expect(message.to).toBe('member@example.test');
    expect(message.text).toContain('Ada Lovelace');
    expect(message.text).toContain('Ship the release');
    expect(message.text).toContain(`/board/${BOARD_ID}/task/${TASK_ID}`);
  });

  it("writes the email in the recipient's stored language, not the actor's", async () => {
    const { mailer, mail, userFindUnique } = build();
    userFindUnique.mockImplementation(async (args) =>
      args.where.id === ACTOR_ID ? { name: 'Ada' } : recipientRow({ locale: 'tr' }),
    );

    await mailer.sendForCreated([assignment()]);

    expect(mail.send.mock.calls[0][0].subject).toContain('atandınız');
  });

  it('does nothing, not even a lookup, while mail is not configured', async () => {
    const { mailer, mail, prisma } = build({ enabled: false });

    await mailer.sendForCreated([assignment()]);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sends nothing to a recipient who opted out', async () => {
    const { mailer, mail, userFindUnique } = build();
    userFindUnique.mockResolvedValue(recipientRow({ emailNotifications: false }));

    await mailer.sendForCreated([assignment()]);

    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sends nothing to an anonymised account', async () => {
    const { mailer, mail, userFindUnique } = build();
    userFindUnique.mockResolvedValue(recipientRow({ deletedAt: new Date() }));

    await mailer.sendForCreated([assignment()]);

    expect(mail.send).not.toHaveBeenCalled();
  });

  it('never emails the actor about their own action', async () => {
    const { mailer, mail, prisma } = build();

    await mailer.sendForCreated([assignment({ userId: ACTOR_ID })]);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('reads the task through its workspace, so a foreign task id resolves to nothing', async () => {
    const { mailer, mail, prisma } = build();
    prisma.task.findFirst.mockResolvedValue(null);

    await mailer.sendForCreated([assignment()]);

    expect(prisma.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TASK_ID, board: { workspaceId: WORKSPACE_ID } } }),
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sends a mention email for a mention row', async () => {
    const { mailer, mail } = build();

    await mailer.sendForCreated([assignment({ type: NotificationType.Mention })]);

    expect(mail.send.mock.calls[0][0].subject).toContain('mentioned');
  });

  it("sends a due-soon email with the card's due day and no actor", async () => {
    const { mailer, mail, userFindUnique } = build();

    await mailer.sendForCreated([assignment({ type: NotificationType.DueSoon, actorId: null })]);

    expect(userFindUnique).toHaveBeenCalledTimes(1);
    const message = mail.send.mock.calls[0][0];
    expect(message.subject).toContain('due soon');
    expect(message.text).toContain('September 1, 2026');
  });

  it('skips a due-soon row whose task has lost its due date since the scan', async () => {
    const { mailer, mail, prisma } = build();
    prisma.task.findFirst.mockResolvedValue(taskRow({ dueDate: null }));

    await mailer.sendForCreated([assignment({ type: NotificationType.DueSoon, actorId: null })]);

    expect(mail.send).not.toHaveBeenCalled();
  });

  it('moves on to the next row when a lookup fails, and never rejects', async () => {
    const { mailer, mail, prisma } = build();
    prisma.task.findFirst
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(taskRow());

    await expect(
      mailer.sendForCreated([assignment(), assignment({ type: NotificationType.Mention })]),
    ).resolves.toBeUndefined();

    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('assignment'),
      expect.any(String),
    );
  });
});
