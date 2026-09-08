import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  MAX_SESSION_TIMEOUT_MINUTES,
  MIN_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_OPTIONS_MINUTES,
} from '../constants/session-timeout.constants';

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
}
