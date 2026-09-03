import { ApiProperty } from '@nestjs/swagger';

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

  constructor(privacyMode: boolean, sessionTimeoutMinutes: number) {
    this.privacyMode = privacyMode;
    this.sessionTimeoutMinutes = sessionTimeoutMinutes;
  }
}
