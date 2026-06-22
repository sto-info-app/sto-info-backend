import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { HEX_TOKEN_PATTERN } from 'src/shared/constants/regex-patterns.constants';

export class ResetPasswordDto {
  @IsNotEmpty()
  @ApiProperty({
    description:
      'Password reset token previously emailed to the user (64 hex characters).',
    example: 'd7a3f31f5b8d4c2f9d2b6e9d1b7c5a2e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c',
    minLength: 64,
    maxLength: 64,
    pattern: HEX_TOKEN_PATTERN.source,
  })
  readonly token: string;

  @IsNotEmpty()
  @ApiProperty({
    description: 'New password to set for the account.',
    example: 'EvenMoreSecurePassword123',
  })
  readonly password: string;
}
