import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Disables a member's account.
 *
 * The reason is optional but strongly encouraged: it is the only record of why
 * an account was locked, and the next administrator to look has nothing else to
 * go on.
 */
export class DisableUserDto {
  @ApiPropertyOptional({
    description:
      'Why the account is being disabled. Internal to the admin section — ' +
      'never shown to the user.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  readonly reason?: string;
}
