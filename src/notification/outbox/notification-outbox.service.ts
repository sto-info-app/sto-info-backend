import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, IsNull, LessThan } from 'typeorm';

import { CRON_TIMEZONE } from 'src/cron/constants/cron.constants';
import { UserPreferenceService } from 'src/user/user-preference.service';

import { queueEmails } from '../email/notification-email-outbox.utility';
import { NotificationTarget } from '../enums/notification-target.enum';
import { NotificationService } from '../notification.service';
import {
  NOTIFICATION_OUTBOX_CATEGORIES,
  NOTIFICATION_OUTBOX_EMAIL_TYPES,
} from './notification-outbox-kind.enum';
import { NotificationOutboxEntity } from './notification-outbox.entity';
import { NotificationOutboxRegistry } from './notification-outbox.registry';

/** How many times a notice is tried before it is given up on. */
export const OUTBOX_ATTEMPTS = 5;

/** How many notices one run sends at most. */
const BATCH = 100;

/**
 * Sends what is waiting in the notification outbox (FC-028, FC-029).
 *
 * Every minute: each handler queues whatever has come due, then each notice
 * waiting is sent — or set aside when the person has switched its category
 * off, or its handler says it is no longer true or no longer theirs. Each is
 * held for its own transaction and skipped by any other run holding it, so
 * two runs never send it twice. One that fails is tried again, up to five
 * times. Each notice may also queue its email, which is its own opt-in
 * (sc-1067): R16's in-app-only rule was relaxed for email then.
 */
@Injectable()
export class NotificationOutboxService {
  private readonly _logger = new Logger(NotificationOutboxService.name);

  /**
   * Creates an instance of NotificationOutboxService.
   *
   * @param _dataSource - The database.
   * @param _registry - Which handler writes which notice.
   * @param _preferences - Says who wants which notices.
   * @param _notifications - Writes in-app notifications.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _registry: NotificationOutboxRegistry,
    private readonly _preferences: UserPreferenceService,
    private readonly _notifications: NotificationService,
  ) {}

  /**
   * Queues what has come due, then sends what is waiting. Every minute.
   *
   * @returns How many were sent.
   */
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: CRON_TIMEZONE })
  async deliver(): Promise<number> {
    const now = new Date();

    for (const handler of this._registry.handlers()) {
      await handler.queueDue?.(now);
    }

    const waiting = await this._dataSource.manager.find(
      NotificationOutboxEntity,
      {
        where: {
          deliveredAt: IsNull(),
          skippedAt: IsNull(),
          attempts: LessThan(OUTBOX_ATTEMPTS),
        },
        order: { createdAt: 'ASC', id: 'ASC' },
        take: BATCH,
        select: { id: true },
      },
    );
    let sent = 0;

    for (const { id } of waiting) {
      sent += (await this.sendOne(id, now)) ? 1 : 0;
    }

    if (waiting.length > 0) {
      this._logger.log(
        `[deliver] Notices handled - Waiting: ${waiting.length}, Sent: ${sent}`,
      );
    }

    return sent;
  }

  /**
   * Sends one notice, or sets it aside as no longer wanted.
   *
   * @param noticeId - The notice.
   * @param now - The moment of the run.
   * @returns True when it was sent.
   */
  private async sendOne(noticeId: string, now: Date): Promise<boolean> {
    return this._dataSource.transaction(async manager => {
      const notice = await manager.findOne(NotificationOutboxEntity, {
        where: { id: noticeId, deliveredAt: IsNull(), skippedAt: IsNull() },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });

      if (notice === null) {
        return false;
      }

      try {
        const emailType = NOTIFICATION_OUTBOX_EMAIL_TYPES[notice.kind];
        const [inApp, email] = await Promise.all([
          this._preferences.isCategoryEnabled(
            notice.userId,
            NOTIFICATION_OUTBOX_CATEGORIES[notice.kind],
          ),
          this._preferences.isEmailEnabled(notice.userId, emailType),
        ]);
        const message =
          inApp || email
            ? await this._registry
                .require(notice.kind)
                .compose(notice, manager, now)
            : null;

        if (message === null) {
          notice.skippedAt = now;
          await manager.save(NotificationOutboxEntity, notice);

          return false;
        }

        const { linkUrl, ...rest } = message;

        if (inApp) {
          await this._notifications.createNotification({
            target: NotificationTarget.USER,
            userId: notice.userId,
            ...rest,
            ...(linkUrl === null ? {} : { linkUrl }),
          });
        }

        // Queued in the delivery's transaction, so a retry cannot queue it
        // twice (sc-1067).
        if (email) {
          await queueEmails(
            manager,
            [{ userId: notice.userId, type: emailType, ...rest, linkUrl }],
            now,
          );
        }

        notice.deliveredAt = now;
        await manager.save(NotificationOutboxEntity, notice);

        return true;
      } catch (error) {
        notice.attempts += 1;
        notice.lastError = (error as Error).name.slice(0, 200);
        await manager.save(NotificationOutboxEntity, notice);
        this._logger.warn(
          `[sendOne] A notice was not sent - NoticeId: ${notice.id}, Attempt: ${notice.attempts}, Reason: ${notice.lastError}`,
        );

        return false;
      }
    });
  }
}
