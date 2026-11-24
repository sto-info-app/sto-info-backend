import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { rescheduleEmails } from '../notification/email/notification-email-outbox.utility';
import {
  DEFAULT_EMAIL_NOTIFICATION_TYPES,
  NotificationEmailType,
} from '../notification/email/notification-email-type.enum';
import { canonicaliseTimezone } from '../shared/utilities/timezone.utility';
import {
  NOTIFICATION_CATEGORY_COLUMNS,
  UserPreferenceEntity,
} from './entities/user-preference.entity';
import { EmailFrequency } from './enums/email-frequency.enum';
import { NotificationCategory } from './enums/notification-category.enum';
import { PresenceVisibility } from './enums/presence-visibility.enum';

/**
 * The preferences an account has before anybody has chosen anything.
 *
 * Declared once, here, rather than relied upon from the entity's column
 * defaults: a user who has never opened the settings page has no row at all, so
 * something has to answer for them, and having two statements of what the
 * defaults are is how they drift apart.
 *
 * Notifications all start on and presence starts at friends. Typing indicators
 * start off because plan section 8 calls them opt-in — telling other people
 * when somebody is composing is the one setting here that emits data about a
 * user without them doing anything deliberate.
 */
export const DEFAULT_USER_PREFERENCES: Readonly<
  Omit<UserPreferenceEntity, 'userId' | 'user' | 'createdAt' | 'updatedAt'>
> = {
  privacyMode: false,
  sessionTimeoutMinutes: null,
  displayTimezone: null,
  stoExportTimezone: null,
  presenceVisibility: PresenceVisibility.FRIENDS,
  appearOffline: false,
  typingIndicatorsEnabled: false,
  notifyMention: true,
  notifyReply: true,
  notifyDirectMessage: true,
  notifyRosterAssociation: true,
  notifyEventReminder: true,
  emailNotificationTypes: [...DEFAULT_EMAIL_NOTIFICATION_TYPES],
  emailFrequency: EmailFrequency.INSTANT,
};

/** The fields a caller may change. */
export type UserPreferenceChanges = Partial<
  Omit<
    UserPreferenceEntity,
    'userId' | 'user' | 'createdAt' | 'updatedAt' | 'emailNotificationTypes'
  >
> & {
  /**
   * Email switches to turn on or off, by type (sc-1067). Only the types named
   * change, so two switches flipped in quick succession cannot undo each
   * other the way two whole lists could.
   */
  emailNotifications?: Partial<Record<NotificationEmailType, boolean>>;
};

/**
 * Reads and writes one user's preferences.
 *
 * A row is created on first write, never on read, so an account that has never
 * changed anything costs nothing and reports the defaults above.
 */
@Injectable()
export class UserPreferenceService {
  /**
   * Creates an instance of UserPreferenceService.
   *
   * @param _preferenceRepository - Repository of user preferences.
   */
  constructor(
    @InjectRepository(UserPreferenceEntity)
    private readonly _preferenceRepository: Repository<UserPreferenceEntity>,
  ) {}

  /**
   * Reads a user's preferences, falling back to the defaults.
   *
   * @param userId - The user.
   * @returns The stored preferences, or the defaults when none are stored.
   */
  async get(userId: string): Promise<UserPreferenceEntity> {
    const stored = await this._preferenceRepository.findOne({
      where: { userId },
    });

    return stored ?? this.defaultsFor(userId);
  }

  /**
   * Applies changes to a user's preferences, creating the row if needed.
   *
   * Only the fields present are changed, so a client that predates a preference
   * leaves it alone rather than resetting it to the default — the same rule the
   * session timeout has followed since it was added.
   *
   * Timezones are stored in the spelling the runtime uses, so `europe/london`
   * and `Europe/London` cannot end up as two different stored values that mean
   * the same place.
   *
   * @param userId - The user.
   * @param changes - The fields to change.
   * @returns The preferences as they now stand.
   */
  async update(
    userId: string,
    changes: UserPreferenceChanges,
  ): Promise<UserPreferenceEntity> {
    const current =
      (await this._preferenceRepository.findOne({ where: { userId } })) ??
      this._preferenceRepository.create(this.defaultsFor(userId));

    const { emailNotifications, ...applied } = changes;
    const previous = {
      emailFrequency: current.emailFrequency,
      displayTimezone: current.displayTimezone,
    };

    if (applied.displayTimezone !== undefined) {
      applied.displayTimezone = this.canonicalise(applied.displayTimezone);
    }

    if (applied.stoExportTimezone !== undefined) {
      applied.stoExportTimezone = this.canonicalise(applied.stoExportTimezone);
    }

    Object.assign(current, applied);

    if (emailNotifications !== undefined) {
      current.emailNotificationTypes = this.applySwitches(
        current.emailNotificationTypes,
        emailNotifications,
      );
    }

    const saved = await this._preferenceRepository.save(current);

    // Waiting emails are due by the old schedule; a new frequency or zone
    // moves them to the new one.
    if (
      saved.emailFrequency !== previous.emailFrequency ||
      saved.displayTimezone !== previous.displayTimezone
    ) {
      await rescheduleEmails(this._preferenceRepository.manager, saved);
    }

    return saved;
  }

  /**
   * Turns one email off, as an unsubscribe link does (sc-1067).
   *
   * @param userId - The user.
   * @param type - The email.
   * @returns The preferences as they now stand.
   */
  optOutOfEmail(
    userId: string,
    type: NotificationEmailType,
  ): Promise<UserPreferenceEntity> {
    return this.update(userId, { emailNotifications: { [type]: false } });
  }

  /**
   * Determines whether a user has opted in to a kind of email (sc-1067).
   *
   * @param userId - The intended recipient.
   * @param type - The kind of email.
   * @returns True while it is switched on.
   */
  async isEmailEnabled(
    userId: string,
    type: NotificationEmailType,
  ): Promise<boolean> {
    const preference = await this.get(userId);

    return preference.emailNotificationTypes.includes(type);
  }

  /**
   * Determines whether a user wants a kind of notification.
   *
   * Asked by the delivery path before a notification is written, so a category
   * somebody has switched off produces no row rather than an unread count they
   * cannot clear.
   *
   * @param userId - The intended recipient.
   * @param category - The kind of notification.
   * @returns True when the user has not switched this category off.
   */
  async isCategoryEnabled(
    userId: string,
    category: NotificationCategory,
  ): Promise<boolean> {
    const preference = await this.get(userId);

    return preference[NOTIFICATION_CATEGORY_COLUMNS[category]] === true;
  }

  /**
   * Builds an unsaved preference row holding the defaults.
   *
   * @param userId - The user.
   * @returns The default preferences for that user.
   */
  private defaultsFor(userId: string): UserPreferenceEntity {
    return {
      userId,
      ...DEFAULT_USER_PREFERENCES,
      // A copy, so a caller changing it cannot change the defaults.
      emailNotificationTypes: [...DEFAULT_EMAIL_NOTIFICATION_TYPES],
    } as UserPreferenceEntity;
  }

  /**
   * Applies email switches to the list of types switched on.
   *
   * @param current - The types on now.
   * @param switches - The changes, by type.
   * @returns The types on afterwards, in a stable order.
   */
  private applySwitches(
    current: readonly NotificationEmailType[],
    switches: Partial<Record<NotificationEmailType, boolean>>,
  ): NotificationEmailType[] {
    const on = new Set(current);

    for (const [type, enabled] of Object.entries(switches) as [
      NotificationEmailType,
      boolean,
    ][]) {
      if (enabled) {
        on.add(type);
      } else {
        on.delete(type);
      }
    }

    return Object.values(NotificationEmailType).filter(type => on.has(type));
  }

  /**
   * Normalises a timezone to its canonical spelling.
   *
   * @param timezone - The requested zone, or null to clear it.
   * @returns The canonical spelling, or null.
   * @throws Error when the value is not a usable IANA timezone.
   */
  private canonicalise(timezone: string | null): string | null {
    if (timezone === null) {
      return null;
    }

    const canonical = canonicaliseTimezone(timezone);

    if (canonical === null) {
      throw new Error(
        `'${timezone}' is not an IANA timezone such as Europe/London.`,
      );
    }

    return canonical;
  }
}
