import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { canonicaliseTimezone } from '../shared/utilities/timezone.utility';
import {
  NOTIFICATION_CATEGORY_COLUMNS,
  UserPreferenceEntity,
} from './entities/user-preference.entity';
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
};

/** The fields a caller may change. */
export type UserPreferenceChanges = Partial<
  Omit<UserPreferenceEntity, 'userId' | 'user' | 'createdAt' | 'updatedAt'>
>;

/**
 * Reads and writes one user's preferences.
 *
 * A row is created on first write, never on read, so an account that has never
 * changed anything costs nothing and reports the defaults above.
 */
@Injectable()
export class UserPreferenceService {
  private readonly _logger = new Logger(UserPreferenceService.name);

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

    const applied: UserPreferenceChanges = { ...changes };

    if (applied.displayTimezone !== undefined) {
      applied.displayTimezone = this.canonicalise(applied.displayTimezone);
    }

    if (applied.stoExportTimezone !== undefined) {
      applied.stoExportTimezone = this.canonicalise(applied.stoExportTimezone);
    }

    Object.assign(current, applied);

    return this._preferenceRepository.save(current);
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
   * Resolves the timezone an STO roster export should be read as.
   *
   * The override wins when one is supplied, because the zone belongs to the
   * machine the file came from rather than to the person uploading it — someone
   * importing a friend's export, or their own from a trip, is stating a fact
   * about that file. An unusable override is refused rather than quietly
   * replaced by the stored default: reading a file in the wrong zone shifts
   * every date in it by hours, and doing that silently is worse than failing.
   *
   * Returns null when neither is set, which is the first-import case the upload
   * form has to ask about (R09).
   *
   * @param userId - The uploading user.
   * @param override - The zone chosen for this import, if any.
   * @returns The canonical IANA zone to read the export as, or null.
   * @throws Error when the override is not a usable IANA timezone.
   */
  async resolveExportTimezone(
    userId: string,
    override?: string | null,
  ): Promise<string | null> {
    if (override !== undefined && override !== null) {
      const canonical = canonicaliseTimezone(override);

      if (canonical === null) {
        this._logger.warn(
          `Rejected export timezone override '${override}' for user ${userId}`,
        );
        throw new Error(
          `'${override}' is not an IANA timezone such as Europe/London.`,
        );
      }

      return canonical;
    }

    return (await this.get(userId)).stoExportTimezone;
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
    } as UserPreferenceEntity;
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
