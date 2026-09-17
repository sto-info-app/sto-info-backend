import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  Validate,
} from 'class-validator';

import { IsIanaTimezoneConstraint } from '../../shared/utilities/is-iana-timezone.constraint';
import {
  MAX_SESSION_TIMEOUT_MINUTES,
  MIN_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_OPTIONS_MINUTES,
} from '../constants/session-timeout.constants';
import { PresenceVisibility } from '../enums/presence-visibility.enum';

/**
 * A change to the account settings.
 *
 * Everything except privacy mode is optional, and an omitted field leaves the
 * stored value alone. That is what lets a client which predates a setting keep
 * working: the alternative is that saving the page from an older build quietly
 * resets whatever it has never heard of.
 *
 * The two timezones accept null as a real value, meaning "follow the device"
 * for the display zone and "not chosen" for the export zone, so a user can go
 * back to the default rather than only ever forward.
 */
export class UpdateUserSettingsDto {
  @IsBoolean()
  @ApiProperty({
    description: 'Whether private details are hidden in the UI.',
    example: false,
  })
  readonly privacyMode: boolean;

  // Optional so that a client which predates this setting can still change the
  // settings it does know about; an omitted value leaves the stored one alone.
  @IsOptional()
  @IsInt()
  @IsIn([...SESSION_TIMEOUT_OPTIONS_MINUTES])
  @Min(MIN_SESSION_TIMEOUT_MINUTES)
  @Max(MAX_SESSION_TIMEOUT_MINUTES)
  @ApiPropertyOptional({
    description: 'Sliding inactivity timeout for login sessions, in minutes.',
    enum: SESSION_TIMEOUT_OPTIONS_MINUTES,
    example: 240,
  })
  readonly sessionTimeoutMinutes?: number;

  @IsOptional()
  @Validate(IsIanaTimezoneConstraint)
  @ApiPropertyOptional({
    description:
      "IANA timezone to display dates in. Null follows the viewer's device.",
    nullable: true,
    example: 'Europe/London',
  })
  readonly displayTimezone?: string | null;

  @IsOptional()
  @Validate(IsIanaTimezoneConstraint)
  @ApiPropertyOptional({
    description: 'IANA timezone STO CSV exports are read as.',
    nullable: true,
    example: 'America/New_York',
  })
  readonly stoExportTimezone?: string | null;

  @IsOptional()
  @IsEnum(PresenceVisibility)
  @ApiPropertyOptional({
    enum: PresenceVisibility,
    description: 'Who may see that this user is online.',
  })
  readonly presenceVisibility?: PresenceVisibility;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Suppresses presence for everyone while set.',
  })
  readonly appearOffline?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Whether to broadcast a typing indicator while composing.',
  })
  readonly typingIndicatorsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Notify when someone mentions this user.',
  })
  readonly notifyMention?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Notify when someone replies to this user.',
  })
  readonly notifyReply?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ description: 'Notify on a direct message.' })
  readonly notifyDirectMessage?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Notify when a roster row is proposed as this user.',
  })
  readonly notifyRosterAssociation?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Notify for subscribed event reminders.',
  })
  readonly notifyEventReminder?: boolean;
}
