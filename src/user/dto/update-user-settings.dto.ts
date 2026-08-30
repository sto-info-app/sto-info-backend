import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateUserSettingsDto {
  @IsBoolean()
  @ApiProperty({
    description: 'Whether private information is visually obscured in the app.',
    example: false,
  })
  readonly privacyMode: boolean;
}