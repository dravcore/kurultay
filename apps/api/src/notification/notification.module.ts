import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { DueSoonWorker } from './due-soon.worker';
import { NotificationController } from './notification.controller';
import { NotificationMailer } from './notification-mailer';
import { NotificationService } from './notification.service';

@Module({
  // Depends on the modules, not on the gateway or the transport: the service publishes through
  // `RealtimeService`, the mailer sends through `MailService`, and neither transport learns
  // what a notification is.
  imports: [RealtimeModule, MailModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationMailer, DueSoonWorker],
  exports: [NotificationService, NotificationMailer],
})
export class NotificationModule {}
