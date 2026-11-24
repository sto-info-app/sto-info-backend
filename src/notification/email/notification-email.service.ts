import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
} from 'typeorm';

import { CRON_TIMEZONE } from 'src/cron/constants/cron.constants';
import { emailSettingsUrl, MailService } from 'src/mail/mail.service';
import { UserPreferenceEntity } from 'src/user/entities/user-preference.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { EmailFrequency } from 'src/user/enums/email-frequency.enum';

import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { NotificationEmailOutboxEntity } from './notification-email-outbox.entity';
import { withoutTrailingSlashes } from './notification-email-outbox.utility';
import {
  DEFAULT_EMAIL_NOTIFICATION_TYPES,
  NOTIFICATION_EMAIL_TYPES,
  NotificationEmailType,
} from './notification-email-type.enum';

/** How many times an email is tried before it is given up on. */
export const EMAIL_ATTEMPTS = 5;

/** How many people one run sends to at most. */
const BATCH = 100;

/** How long a sent or skipped email is kept. */
export const EMAIL_OUTBOX_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why an email was set aside, as recorded. */
type SkipReason =
  | 'NO_ACCOUNT'
  | 'ACCOUNT_DISABLED'
  | 'EMAIL_UNVERIFIED'
  | 'SUPPRESSED'
  | 'OPTED_OUT';

/** The person an email goes to. */
interface Recipient {
  readonly email: string;
  readonly firstName: string;
  readonly frequency: EmailFrequency;
  readonly types: readonly NotificationEmailType[];
}

/**
 * Sends the notification emails waiting in the outbox (sc-1067).
 *
 * Every minute, everything due for one person goes in one email: a digest's
 * worth at 08:00, or whatever came due since the last run when they want
 * them instantly. Each email is asked again whether it is still wanted, since
 * switching a type off stops what is already queued. The rows are held for
 * their own transaction and skipped by any other run holding them, so none is
 * sent twice; one that fails is tried again, up to five times.
 */
@Injectable()
export class NotificationEmailService {
  private readonly _logger = new Logger(NotificationEmailService.name);

  /**
   * Creates an instance of NotificationEmailService.
   *
   * @param _dataSource - The database.
   * @param _mail - Renders and sends emails.
   * @param _tokens - Signs the unsubscribe links.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _mail: MailService,
    private readonly _tokens: EmailUnsubscribeTokenService,
  ) {}

  /**
   * Sends what has come due. Every minute.
   *
   * @param now - The moment of the run.
   * @returns How many emails were sent.
   */
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: CRON_TIMEZONE })
  async deliver(now: Date = new Date()): Promise<number> {
    const due = await this._dataSource.manager
      .createQueryBuilder(NotificationEmailOutboxEntity, 'email')
      .select('email.userId', 'userId')
      .where('email.sentAt IS NULL')
      .andWhere('email.skippedAt IS NULL')
      .andWhere('email.attempts < :attempts', { attempts: EMAIL_ATTEMPTS })
      .andWhere('email.dueAt <= :now', { now })
      .groupBy('email.userId')
      .orderBy('MIN(email.dueAt)', 'ASC')
      .limit(BATCH)
      .getRawMany<{ userId: string }>();
    let sent = 0;

    for (const { userId } of due) {
      sent += (await this.sendTo(userId, now)) ? 1 : 0;
    }

    if (due.length > 0) {
      this._logger.log(
        `[deliver] Notification emails handled - People: ${due.length}, Sent: ${sent}`,
      );
    }

    return sent;
  }

  /**
   * Deletes sent, skipped and abandoned emails after 30 days. Nightly.
   *
   * @param now - The moment of the run.
   * @returns How many were deleted.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: CRON_TIMEZONE })
  async purge(now: Date = new Date()): Promise<number> {
    const before = new Date(
      now.getTime() - EMAIL_OUTBOX_RETENTION_DAYS * DAY_MS,
    );
    const result = await this._dataSource.manager
      .createQueryBuilder()
      .delete()
      .from(NotificationEmailOutboxEntity)
      .where('"createdAt" < :before', { before })
      .andWhere(
        '("sentAt" IS NOT NULL OR "skippedAt" IS NOT NULL OR "attempts" >= :attempts)',
        { attempts: EMAIL_ATTEMPTS },
      )
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Sends one person everything due for them, in one email.
   *
   * @param userId - The person.
   * @param now - The moment of the run.
   * @returns True when an email was sent.
   */
  private async sendTo(userId: string, now: Date): Promise<boolean> {
    return this._dataSource.transaction(async manager => {
      const rows = await manager.find(NotificationEmailOutboxEntity, {
        where: {
          userId,
          sentAt: IsNull(),
          skippedAt: IsNull(),
          attempts: LessThan(EMAIL_ATTEMPTS),
          dueAt: LessThanOrEqual(now),
        },
        order: { createdAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });

      if (rows.length === 0) {
        return false;
      }

      const recipient = await this.recipientFor(manager, userId);
      const refusal = await this.refusalFor(recipient);

      if (refusal !== null) {
        await this.skip(manager, rows, now, refusal);

        return false;
      }

      const { types } = recipient as Recipient;
      const wanted = rows.filter(row => types.includes(row.type));

      await this.skip(
        manager,
        rows.filter(row => !types.includes(row.type)),
        now,
        'OPTED_OUT',
      );

      if (wanted.length === 0) {
        return false;
      }

      return this.send(manager, userId, recipient as Recipient, wanted, now);
    });
  }

  /**
   * Renders and sends one email, recording the outcome on its rows.
   *
   * @param manager - The transaction.
   * @param userId - The person.
   * @param recipient - Their address, name and settings.
   * @param rows - What it holds.
   * @param now - The moment of the run.
   * @returns True when it was sent.
   */
  private async send(
    manager: EntityManager,
    userId: string,
    recipient: Recipient,
    rows: NotificationEmailOutboxEntity[],
    now: Date,
  ): Promise<boolean> {
    try {
      const types = [...new Set(rows.map(row => row.type))];
      const digest = this.digestName(recipient.frequency);
      const subject = this.subjectFor(rows, digest);
      const { html, text } = await this._mail.renderEmail(
        'notification-email.ejs',
        {
          firstName: recipient.firstName,
          digest,
          items: rows.map(({ title, body, linkUrl }) => ({
            title,
            body,
            linkUrl,
          })),
        },
        subject,
        {
          template: 'notification-email-footer.ejs',
          data: {
            labels: types.map(type => NOTIFICATION_EMAIL_TYPES[type].label),
            unsubscribeLinks: this.unsubscribeLinks(userId, types),
            settingsUrl: emailSettingsUrl(),
          },
        },
      );
      const message = this._mail.generateEmailMessageObject(
        recipient.email,
        subject,
        text,
        html,
      );
      const headers = this.listUnsubscribeHeaders(userId, types);

      await this._mail.sendEmail(
        { ...message, ...(headers ? { headers } : {}) },
        { rethrow: true },
      );
      await manager.update(
        NotificationEmailOutboxEntity,
        { id: In(rows.map(row => row.id)) },
        { sentAt: now },
      );

      return true;
    } catch (error) {
      const reason = (error as Error).name.slice(0, 200);

      await manager
        .createQueryBuilder()
        .update(NotificationEmailOutboxEntity)
        .set({ attempts: () => '"attempts" + 1', lastError: reason })
        .whereInIds(rows.map(row => row.id))
        .execute();
      this._logger.warn(
        `[send] A notification email was not sent - UserId: ${userId}, Emails: ${rows.length}, Reason: ${reason}`,
      );

      return false;
    }
  }

  /**
   * Reads who an email goes to.
   *
   * @param manager - The transaction.
   * @param userId - The person.
   * @returns Their address, name and settings, or null without an account.
   */
  private async recipientFor(
    manager: EntityManager,
    userId: string,
  ): Promise<(Recipient & { verified: boolean; disabled: boolean }) | null> {
    const user = await manager.findOne(UserEntity, {
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        isAccountDisabled: true,
      },
    });

    if (user === null) {
      return null;
    }

    const [profile, preference] = await Promise.all([
      manager.findOne(UserProfileEntity, {
        where: { userId },
        select: { userId: true, firstName: true },
      }),
      manager.findOne(UserPreferenceEntity, { where: { userId } }),
    ]);

    return {
      email: user.email,
      verified: user.emailVerified,
      disabled: user.isAccountDisabled,
      firstName: profile?.firstName || 'Captain',
      frequency: preference?.emailFrequency ?? EmailFrequency.INSTANT,
      types:
        preference?.emailNotificationTypes ?? DEFAULT_EMAIL_NOTIFICATION_TYPES,
    };
  }

  /**
   * Why nothing may be sent to somebody, if anything.
   *
   * @param recipient - Who, or null without an account.
   * @returns The reason, or null when emails may go.
   */
  private async refusalFor(
    recipient: (Recipient & { verified: boolean; disabled: boolean }) | null,
  ): Promise<SkipReason | null> {
    if (recipient === null) {
      return 'NO_ACCOUNT';
    }

    if (recipient.disabled) {
      return 'ACCOUNT_DISABLED';
    }

    if (!recipient.verified) {
      return 'EMAIL_UNVERIFIED';
    }

    return (await this._mail.isSuppressed(recipient.email))
      ? 'SUPPRESSED'
      : null;
  }

  /**
   * Sets emails aside as never to be sent.
   *
   * @param manager - The transaction.
   * @param rows - The emails.
   * @param now - The moment of the run.
   * @param reason - Why.
   */
  private async skip(
    manager: EntityManager,
    rows: NotificationEmailOutboxEntity[],
    now: Date,
    reason: SkipReason,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await manager.update(
      NotificationEmailOutboxEntity,
      { id: In(rows.map(row => row.id)) },
      { skippedAt: now, lastError: reason },
    );
  }

  /**
   * What a digest is called in its email, or null when it is not one.
   *
   * @param frequency - How often the person wants emails.
   * @returns "daily", "weekly" or null.
   */
  private digestName(frequency: EmailFrequency): string | null {
    if (frequency === EmailFrequency.DAILY) {
      return 'daily';
    }

    return frequency === EmailFrequency.WEEKLY ? 'weekly' : null;
  }

  /**
   * The email's subject.
   *
   * @param rows - What it holds.
   * @param digest - The digest's name, or null.
   * @returns The subject.
   */
  private subjectFor(
    rows: readonly NotificationEmailOutboxEntity[],
    digest: string | null,
  ): string {
    const appTitle = process.env.APP_TITLE;

    if (digest !== null) {
      return `Your ${digest} digest from the ${appTitle}`;
    }

    return rows.length === 1
      ? rows[0].title
      : `${rows.length} new notifications from the ${appTitle}`;
  }

  /**
   * The footer's links, one for each type the email holds.
   *
   * @param userId - The person.
   * @param types - The types.
   * @returns Each link with what it stops, for those that could be signed.
   */
  private unsubscribeLinks(
    userId: string,
    types: readonly NotificationEmailType[],
  ): { label: string; url: string }[] {
    const frontend = process.env.APP_FRONTEND_URL;

    return types.flatMap(type => {
      const token = this._tokens.sign({ userId, types: [type] });

      return token === null
        ? []
        : [
            {
              label: NOTIFICATION_EMAIL_TYPES[type].label.toLowerCase(),
              url: `${frontend}/email/unsubscribe?token=${token}`,
            },
          ];
    });
  }

  /**
   * The one-click unsubscribe headers (RFC 2369 and RFC 8058), turning off
   * every type the email holds.
   *
   * @param userId - The person.
   * @param types - The types.
   * @returns The headers, or null without an API address or a key.
   */
  private listUnsubscribeHeaders(
    userId: string,
    types: readonly NotificationEmailType[],
  ): Record<string, string> | null {
    const api = withoutTrailingSlashes(process.env.APP_API_URL);
    const token = this._tokens.sign({ userId, types });

    if (api === '' || token === null) {
      return null;
    }

    return {
      'List-Unsubscribe': `<${api}/email-preferences/unsubscribe?token=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
}
