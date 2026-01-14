import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class ResendVerificationEmailDto {
  @IsNotEmpty()
  @ApiProperty({
    description:
      'Current email verification token. A new token will be generated and emailed if the account is still unverified.',
    example: '0c2a0e6f3d8b4b6db3e7c5f2a1b9d0c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
    minLength: 64,
    maxLength: 64,
    pattern: '^[0-9a-f]{64}$',
  })
  readonly token: string;
}
