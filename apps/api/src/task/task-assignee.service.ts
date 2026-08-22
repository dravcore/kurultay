import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ActivityType, NotificationType } from '@kurul/shared-types';
import type { TaskDto } from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { NotificationMailer } from '../notification/notification-mailer';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AddAssigneeDto } from './dto/add-assignee.dto';
import { conflictOnUniqueViolation } from './prisma-unique-violation';
import { TaskEventsService } from './task-events.service';
import { TaskReadService } from './task-read.service';

@Injectable()
export class TaskAssigneeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly notificationService: NotificationService,
    private readonly taskRead: TaskReadService,
    private readonly taskEvents: TaskEventsService,
    private readonly notificationMailer: NotificationMailer,
  ) {}

  async addAssignee(
    workspaceId: string,
    taskId: string,
    actorId: string,
    dto: AddAssigneeDto,
  ): Promise<TaskDto> {
    const task = await this.taskRead.findTaskBasic(workspaceId, taskId);
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: dto.userId },
    });
    if (!member) {
      throw new UnprocessableEntityException('User is not a member of this workspace');
    }

    // Set inside the transaction, published after it commits: `createAssignment` returns null
    // when the assignee is the actor, and only a stored row is worth signalling.
    let notifiedUserId: string | null = null;

    await conflictOnUniqueViolation(async () => {
      await this.prisma.$transaction(async (tx) => {
        await tx.taskAssignee.create({
          data: { taskId: task.id, userId: dto.userId },
        });

        const activity = await this.activityService.record(tx, {
          workspaceId,
          taskId: task.id,
          userId: actorId,
          type: ActivityType.TaskAssigned,
          payload: {
            title: task.title,
            assigneeUserId: dto.userId,
          },
        });

        const notification = await this.notificationService.createAssignment(tx, {
          workspaceId,
          userId: dto.userId,
          actorId,
          taskId: task.id,
          activityId: activity.id,
          payload: {
            title: task.title,
            assigneeUserId: dto.userId,
            actorId,
          },
        });
        notifiedUserId = notification ? dto.userId : null;
      });
    }, 'User is already assigned to this task');

    if (notifiedUserId) {
      this.notificationService.emitUnreadChanged(workspaceId, [notifiedUserId]);
      // Awaited, like the invitation email: it never rejects, and the response goes out once
      // the relay has taken the message rather than racing it.
      await this.notificationMailer.sendForCreated([
        {
          workspaceId,
          userId: notifiedUserId,
          actorId,
          type: NotificationType.Assignment,
          taskId: task.id,
        },
      ]);
    }

    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }

  async removeAssignee(
    workspaceId: string,
    taskId: string,
    actorId: string,
    assigneeUserId: string,
  ): Promise<TaskDto> {
    const task = await this.taskRead.findTaskBasic(workspaceId, taskId);
    await this.prisma.$transaction(async (tx) => {
      // The join row is reachable only through its task, so the tenant scope rides along the
      // relation instead of resting on the check above.
      const result = await tx.taskAssignee.deleteMany({
        where: { taskId, userId: assigneeUserId, task: { board: { workspaceId } } },
      });
      if (result.count === 0) throw new NotFoundException('Assignee not found');

      await this.activityService.record(tx, {
        workspaceId,
        taskId,
        userId: actorId,
        type: ActivityType.TaskUnassigned,
        payload: {
          title: task.title,
          assigneeUserId,
        },
      });
    });
    return this.taskEvents.emitUpdated(workspaceId, taskId, actorId);
  }
}
