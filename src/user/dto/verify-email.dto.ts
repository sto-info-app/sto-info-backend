import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class VerifyEmailDto {
  @IsNotEmpty()
  @ApiProperty({
    description:
      'Email verification token previously emailed during registration (64 hex characters).',
    example: '3f6c0a9b1d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90',
    minLength: 64,
    maxLength: 64,
    pattern: '^[0-9a-f]{64}$',
  })
  readonly token: string;
}
