import { EntityManager, IsNull, Not } from 'typeorm';

import { UserPreferenceEntity } from 'src/user/entities/user-preference.entity';
import { EmailFrequency } from 'src/user/enums/email-frequency.enum';

import { NotificationEmailOutboxEntity } from './notification-email-outbox.entity';
import { emailDueAt } from './notification-email-schedule.utility';
import {
  DEFAULT_EMAIL_NOTIFICATION_TYPES,
  NotificationEmailType,
} from './notification-email-type.enum';

/** One email to queue: the in-app notice it mirrors. */
export interface EmailEntry {
  /** Who it is for. */
  readonly userId: string;
  /** What kind of email it is. */
  readonly type: NotificationEmailType;
  /** The notice's title. */
  readonly title: string;
  /** The notice's text. */
  readonly body: string;
  /** Where the notice leads, if anywhere. */
  readonly linkUrl?: string | null;
}

/** The longest title the outbox holds, as the in-app notice allows. */
const TITLE_LENGTH = 200;

/**
 * An address without the slashes at its end, so a path can follow it.
 *
 * @param address - The address, or nothing.
 * @returns It without trailing slashes, or an empty string.
 */
export function withoutTrailingSlashes(address = ''): string {
  let trimmed = address;

  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
}

/**
 * Makes a notice's link absolute, so it works from an email.
 *
 * In-app links are written both ways: `/chat/transcripts` and the frontend's
 * full address. Anything else is dropped rather than sent somewhere unknown.
 *
 * @param linkUrl - The link.
 * @returns The absolute address, or null.
 */
export function absoluteLink(
  linkUrl: string | null | undefined,
): string | null {
  const frontend = withoutTrailingSlashes(process.env.APP_FRONTEND_URL);

  if (!linkUrl || frontend === '') {
    return null;
  }

  if (linkUrl.startsWith('/') && !linkUrl.startsWith('//')) {
    return `${frontend}${linkUrl}`;
  }

  return linkUrl === frontend || linkUrl.startsWith(`${frontend}/`)
    ? linkUrl
    : null;
}

/**
 * What the email side of somebody's preferences says, defaults included.
 *
 * @param preference - Their stored row, or null when they have none.
 * @returns The types on, their frequency and zone.
 */
function emailSettingsOf(preference: UserPreferenceEntity | null): {
  types: readonly NotificationEmailType[];
  frequency: EmailFrequency;
  timeZone: string | null;
} {
  return {
    types:
      preference?.emailNotificationTypes ?? DEFAULT_EMAIL_NOTIFICATION_TYPES,
    frequency: preference?.emailFrequency ?? EmailFrequency.INSTANT,
    timeZone: preference?.displayTimezone ?? null,
  };
}

/**
 * When the last email of a type went to somebody.
 *
 * @param manager - The transaction.
 * @param userId - The person.
 * @param type - The type.
 * @returns The moment, or null when none has.
 */
async function lastSentAt(
  manager: EntityManager,
  userId: string,
  type: NotificationEmailType,
): Promise<Date | null> {
  const last = await manager.findOne(NotificationEmailOutboxEntity, {
    where: { userId, type, sentAt: Not(IsNull()) },
    order: { sentAt: 'DESC' },
    select: { id: true, sentAt: true },
  });

  return last?.sentAt ?? null;
}

/**
 * Queues the emails that mirror in-app notices, for those who opted in
 * (sc-1067).
 *
 * A plain function taking the transaction, like the in-app outbox's, so any
 * feature can queue without depending on the notification module. A type
 * somebody has not switched on queues nothing; the sender asks again before
 * sending, so switching it off later still stops it.
 *
 * @param manager - The transaction.
 * @param entries - The emails.
 * @param now - The moment they are queued.
 * @returns How many were queued.
 */
export async function queueEmails(
  manager: EntityManager,
  entries: readonly EmailEntry[],
  now: Date = new Date(),
): Promise<number> {
  let queued = 0;

  for (const entry of entries) {
    if (entry.type === NotificationEmailType.LOGIN) {
      // A login alert is sent as the login happens, never queued.
      continue;
    }

    const { types, frequency, timeZone } = emailSettingsOf(
      await manager.findOne(UserPreferenceEntity, {
        where: { userId: entry.userId },
      }),
    );

    if (!types.includes(entry.type)) {
      continue;
    }

    const dueAt = emailDueAt(
      entry.type,
      frequency,
      timeZone,
      now,
      await lastSentAt(manager, entry.userId, entry.type),
    );

    await manager
      .createQueryBuilder()
      .insert()
      .into(NotificationEmailOutboxEntity)
      .values({
        userId: entry.userId,
        type: entry.type,
        title: entry.title.slice(0, TITLE_LENGTH),
        body: entry.body,
        linkUrl: absoluteLink(entry.linkUrl),
        dueAt,
      })
      .execute();
    queued += 1;
  }

  return queued;
}

/**
 * Moves somebody's waiting emails to the schedule their preferences now set,
 * after their frequency or zone changed.
 *
 * @param manager - The transaction or manager.
 * @param preference - Their preferences, as saved.
 * @param now - The moment of the change.
 */
export async function rescheduleEmails(
  manager: EntityManager,
  preference: UserPreferenceEntity,
  now: Date = new Date(),
): Promise<void> {
  const { frequency, timeZone } = emailSettingsOf(preference);
  const waiting = await manager.find(NotificationEmailOutboxEntity, {
    where: { userId: preference.userId, sentAt: IsNull(), skippedAt: IsNull() },
    select: { id: true, type: true },
  });
  const sentBefore = new Map<NotificationEmailType, Date | null>();

  for (const row of waiting) {
    if (!sentBefore.has(row.type)) {
      sentBefore.set(
        row.type,
        await lastSentAt(manager, preference.userId, row.type),
      );
    }

    await manager.update(
      NotificationEmailOutboxEntity,
      { id: row.id },
      {
        dueAt: emailDueAt(
          row.type,
          frequency,
          timeZone,
          now,
          sentBefore.get(row.type) ?? null,
        ),
      },
    );
  }
}
