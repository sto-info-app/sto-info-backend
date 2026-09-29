import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The longest reason a site admin action keeps. */
export const ADMIN_REASON_MAX = 500;

/**
 * Why a site admin did something, for an action that takes nothing else
 * (FC-039). Every site admin action records one in the site admin log.
 */
export class AdminReasonDto {
  @ApiProperty({
    description: 'Why. Kept in the site admin log for its review.',
    maxLength: ADMIN_REASON_MAX,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(ADMIN_REASON_MAX)
  readonly reason: string;
}
