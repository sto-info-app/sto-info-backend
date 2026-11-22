import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

/** Where a Security Log entry comes from (FC-039). */
export enum SecurityLogSource {
  /** Roles, overrides, account locks, report decisions, moderation. */
  SITE_ADMIN = 'SITE_ADMIN',
  /** A site admin's dispute action at a Community, Fleet or Armada. */
  FLEET = 'FLEET',
  /** Placing, extending, releasing and reading holds. */
  HOLD = 'HOLD',
  /** A site admin's look into a Fleet's imports. */
  INVESTIGATION = 'INVESTIGATION',
  /** A verified roster erasure. */
  ERASURE = 'ERASURE',
  /** A retention job's run. */
  RETENTION = 'RETENTION',
}

/** What the Security Log is asked for. */
export class SecurityLogQueryDto {
  @ApiPropertyOptional({ enum: SecurityLogSource })
  @IsOptional()
  @IsEnum(SecurityLogSource)
  readonly source?: SecurityLogSource;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;
}

/** Somebody the log names. */
export class SecurityLogPersonDto {
  @ApiProperty() userId: string;

  @ApiProperty({ nullable: true, type: String })
  username: string | null;
}

/** One entry of the Security Log. */
export class SecurityLogEntryDto {
  @ApiProperty({ enum: SecurityLogSource })
  source: SecurityLogSource;

  @ApiProperty() id: string;

  @ApiProperty() at: Date;

  @ApiProperty({ description: 'What was done, as its own log names it.' })
  action: string;

  @ApiProperty({
    nullable: true,
    type: SecurityLogPersonDto,
    description: 'Who did it; null for the system or an account since gone.',
  })
  actor: SecurityLogPersonDto | null;

  @ApiProperty({ nullable: true, type: SecurityLogPersonDto })
  target: SecurityLogPersonDto | null;

  @ApiProperty({ nullable: true, type: String })
  subjectKind: string | null;

  @ApiProperty({ nullable: true, type: String })
  subjectId: string | null;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Codes, states, counts and IDs; never content.',
  })
  detail: Record<string, unknown> | null;
}

/** A page of the Security Log, newest first. */
export class SecurityLogPageDto {
  @ApiProperty({ type: [SecurityLogEntryDto] })
  items: SecurityLogEntryDto[];

  @ApiProperty() total: number;

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;
}
