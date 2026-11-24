import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MailModule } from 'src/mail/mail.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/user/user.module';

import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { EmailUnsubscribeController } from './email-unsubscribe.controller';
import { NotificationEmailOutboxEntity } from './notification-email-outbox.entity';
import { NotificationEmailService } from './notification-email.service';

/**
 * Notification emails: the sender and the unsubscribe links (sc-1067).
 *
 * Features queue emails with `queueEmails`, a plain function taking their
 * transaction, so none of them depends on this module.
 */
@Module({
  imports: [
    SharedModule,
    MailModule,
    UserModule,
    TypeOrmModule.forFeature([NotificationEmailOutboxEntity]),
  ],
  controllers: [EmailUnsubscribeController],
  providers: [NotificationEmailService, EmailUnsubscribeTokenService],
})
export class NotificationEmailModule {}
