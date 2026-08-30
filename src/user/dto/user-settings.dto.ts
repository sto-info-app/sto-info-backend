import { ApiProperty } from '@nestjs/swagger';

export class UserSettingsDto {
  @ApiProperty({
    description: 'Whether private information is visually obscured in the app.',
    example: false,
  })
  privacyMode: boolean;

  constructor(privacyMode: boolean) {
    this.privacyMode = privacyMode;
  }
}