import { ApiProperty } from '@nestjs/swagger';

import { UserPreferenceEntity } from '../entities/user-preference.entity';
import { PresenceVisibility } from '../enums/presence-visibility.enum';

/**
 * Every account setting, as the settings page reads them.
 *
 * One shape rather than one per feature. A user thinks of these as a single
 * page, and splitting the response would mean the page could half-load.
 */
export class UserSettingsDto {
  @ApiProperty({
    description: 'Whether private information is visually obscured in the app.',
    example: false,
  })
  privacyMode: boolean;

  @ApiProperty({
    description: 'Sliding inactivity timeout for login sessions, in minutes.',
    example: 240,
  })
  sessionTimeoutMinutes: number;

  @ApiProperty({
    description:
      "IANA timezone dates are displayed in. Null follows the viewer's device.",
    nullable: true,
    example: 'Europe/London',
  })
  displayTimezone: string | null;

  @ApiProperty({
    description:
      'IANA timezone STO CSV exports are read as. Null until the user chooses one.',
    nullable: true,
    example: 'America/New_York',
  })
  stoExportTimezone: string | null;

  @ApiProperty({
    enum: PresenceVisibility,
    description: 'Who may see that this user is online.',
  })
  presenceVisibility: PresenceVisibility;

  @ApiProperty({ description: 'Suppresses presence for everyone while set.' })
  appearOffline: boolean;

  @ApiProperty({
    description: 'Whether to broadcast a typing indicator while composing.',
  })
  typingIndicatorsEnabled: boolean;

  @ApiProperty({ description: 'Notify when someone mentions this user.' })
  notifyMention: boolean;

  @ApiProperty({ description: 'Notify when someone replies to this user.' })
  notifyReply: boolean;

  @ApiProperty({ description: 'Notify on a direct message.' })
  notifyDirectMessage: boolean;

  @ApiProperty({
    description: 'Notify when a roster row is proposed as this user.',
  })
  notifyRosterAssociation: boolean;

  @ApiProperty({ description: 'Notify for subscribed event reminders.' })
  notifyEventReminder: boolean;

  /**
   * Creates the response from stored preferences.
   *
   * The timeout is passed in already resolved rather than read from the row,
   * because a user who has never chosen one gets the deployment's window and
   * the client needs the number it is actually being held to.
   *
   * @param preference - The user's stored or default preferences.
   * @param sessionTimeoutMinutes - The inactivity window in force.
   */
  constructor(preference: UserPreferenceEntity, sessionTimeoutMinutes: number) {
    this.privacyMode = preference.privacyMode;
    this.sessionTimeoutMinutes = sessionTimeoutMinutes;
    this.displayTimezone = preference.displayTimezone;
    this.stoExportTimezone = preference.stoExportTimezone;
    this.presenceVisibility = preference.presenceVisibility;
    this.appearOffline = preference.appearOffline;
    this.typingIndicatorsEnabled = preference.typingIndicatorsEnabled;
    this.notifyMention = preference.notifyMention;
    this.notifyReply = preference.notifyReply;
    this.notifyDirectMessage = preference.notifyDirectMessage;
    this.notifyRosterAssociation = preference.notifyRosterAssociation;
    this.notifyEventReminder = preference.notifyEventReminder;
  }
}
