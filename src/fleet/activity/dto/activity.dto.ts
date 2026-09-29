import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsOptional, Matches } from 'class-validator';

import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ActivityType } from '../enums/activity.enums';

/** Where a page of activity carries on from: `<ISO instant>_<item ID>`. */
export const ACTIVITY_CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z_[0-9a-f-]{36}$/;

/** Which page of a feed to read. */
export class ActivityQueryDto {
  @ApiPropertyOptional({
    description:
      'Carry on after this item: the `next` of the page before. Newest first.',
  })
  @IsOptional()
  @Matches(ACTIVITY_CURSOR_PATTERN, { message: 'before is not a feed cursor' })
  readonly before?: string;
}

/** The scope an item happened in. */
export class ActivityScopeDto {
  @ApiProperty({ enum: FleetScopeKind }) kind: FleetScopeKind;

  @ApiProperty() name: string;

  @ApiProperty({ description: 'Its page on the site.' }) path: string;
}

/** One thing that happened, as the reader may see it now. */
export class ActivityItemDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: ActivityType }) type: ActivityType;

  @ApiProperty() occurredAt: Date;

  @ApiProperty({ description: 'What happened, as a sentence.' })
  sentence: string;

  @ApiProperty({
    description: 'Where to read more, on the site, or null.',
    nullable: true,
    type: String,
  })
  path: string | null;

  @ApiProperty({ type: ActivityScopeDto }) scope: ActivityScopeDto;
}

/** A page of a feed, newest first. */
export class ActivityPageDto {
  @ApiProperty({ type: [ActivityItemDto] }) items: ActivityItemDto[];

  @ApiProperty({
    description: 'Where the next page starts, or null at the end.',
    nullable: true,
    type: String,
  })
  next: string | null;
}
