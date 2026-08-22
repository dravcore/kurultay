import { INestApplication } from '@nestjs/common';
import { MailDeliveryStatus, MemberRole } from '@kurul/shared-types';
import { App } from 'supertest/types';
import type { MailMessage } from '../src/mail/mail-sender';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { addMember, createWorkspace, signUp } from './helpers/auth';
import { resetDatabase } from './helpers/db';

/**
 * The notification email end to end, in the invitation-mail pattern: a real request stores a
 * real `Notification` row, and the message that would have left the process is captured at
 * `MailService`, the one seam the notification module talks to.
 *
 * The fake reports mail as enabled whatever the environment says. CI leaves `SMTP_HOST` unset,
 * and the question here is not whether a relay exists but whether the row reaches the transport
 * in the right language and stops when the person asks it to.
 */
describe('Notification email (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const outbox: MailMessage[] = [];

  beforeAll(async () => {
    const capturingMail = {
      isEnabled: () => true,
      send: (message: MailMessage) => {
        outbox.push(message);
        return Promise.resolve(MailDeliveryStatus.SENT);
      },
      onModuleDestroy: () => Promise.resolve(),
    };
    app = await createTestApp({
      configure: (builder) => builder.overrideProvider(MailService).useValue(capturingMail),
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    outbox.length = 0;
    await resetDatabase(prisma);
  });

  it("emails an assignment in the assignee's language, and stops once they opt out", async () => {
    const owner = await signUp(app, { name: 'Owner' });
    const member = await signUp(app, { name: 'Üye' });
    const workspace = await createWorkspace(owner.agent, 'Posta', 'posta');
    const memberMe = await member.agent.get('/me').expect(200);
    const memberId = memberMe.body.id as string;
    await addMember(prisma, workspace.id, memberId, MemberRole.MEMBER);
    // A new account starts opted in, and says so on `/me`.
    expect(memberMe.body.emailNotifications).toBe(true);
    await member.agent.patch('/me').send({ locale: 'tr' }).expect(200);

    const board = await owner.agent
      .post(`/workspaces/${workspace.id}/boards`)
      .send({ name: 'Board' })
      .expect(201);
    const columns = await owner.agent
      .get(`/workspaces/${workspace.id}/boards/${board.body.id}/columns`)
      .expect(200);
    const task = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'Sürümü yayınla', columnId: columns.body[0].id })
      .expect(201);

    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${task.body.id}/assignees`)
      .send({ userId: memberId })
      .expect(201);

    // One row, one message, to the assignee, in Turkish, naming the actor and linking the card.
    expect(outbox).toHaveLength(1);
    const message = outbox[0]!;
    expect(message.to).toBe(member.email);
    expect(message.subject).toContain('atandınız');
    expect(message.subject).toContain('Sürümü yayınla');
    expect(message.text).toContain('Owner');
    expect(message.text).toContain(`/board/${board.body.id}/task/${task.body.id}`);
    expect(message.text).not.toContain('assigned you');

    // The opt-out is the member's own profile field, round-tripped through `/me`.
    await member.agent
      .patch('/me')
      .send({ emailNotifications: false })
      .expect(200)
      .expect(({ body }) => expect(body.emailNotifications).toBe(false));
    await member.agent
      .get('/me')
      .expect(200)
      .expect(({ body }) => expect(body.emailNotifications).toBe(false));

    // A second assignment, on a fresh card so the row is stored: in-app yes, email no.
    const second = await owner.agent
      .post(`/workspaces/${workspace.id}/boards/${board.body.id}/tasks`)
      .send({ title: 'İkinci kart', columnId: columns.body[0].id })
      .expect(201);
    await owner.agent
      .post(`/workspaces/${workspace.id}/tasks/${second.body.id}/assignees`)
      .send({ userId: memberId })
      .expect(201);

    const unread = await member.agent
      .get(`/workspaces/${workspace.id}/notifications/unread-count`)
      .expect(200);
    expect(unread.body).toEqual({ count: 2 });
    expect(outbox).toHaveLength(1);
  });

  it('refuses a null opt-out, which the column cannot hold', async () => {
    const user = await signUp(app);

    await user.agent.patch('/me').send({ emailNotifications: null }).expect(400);
    await user.agent.patch('/me').send({ emailNotifications: 'yes' }).expect(400);
  });
});
