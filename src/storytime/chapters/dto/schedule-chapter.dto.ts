import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsDate, MinDate } from 'class-validator';

/**
 * Schedules a Chapter to publish automatically.
 *
 * The time is a UTC instant. The client is responsible for showing the
 * creator which time zone they are scheduling in, since a Chapter going out
 * hours from when its author expected is a real failure.
 */
export class ScheduleChapterDto {
  @ApiProperty({
    description: 'When the Chapter should publish, as a UTC instant.',
  })
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), {
    message: 'publishAt must be in the future',
  })
  readonly publishAt: Date;
}
