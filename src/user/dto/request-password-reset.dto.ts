import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty } from 'class-validator';

export class RequestPasswordResetDto {
  @IsNotEmpty()
  @ApiProperty({
    description:
      'Email address for the account requesting a password reset. Responses are intentionally generic for security.',
    example: 'captain.picard@starfleet.example',
  })
  readonly email: string;
}
