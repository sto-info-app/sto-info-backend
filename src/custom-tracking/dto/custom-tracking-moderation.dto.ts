import { ApiProperty } from '@nestjs/swagger';

import { CustomTrackingModerationLevel } from '../enums/custom-tracking-moderation-level.enum';

/**
 * What an administrator did to one piece of somebody's hierarchy.
 *
 * The name is echoed back deliberately. An administrator working from a report
 * has an identifier and a page, and confirming that the identifier belonged to
 * the heading they meant is the difference between suppressing the offending
 * Section and suppressing the one below it.
 */
export class CustomTrackingSuppressionDto {
  @ApiProperty({
    description: 'Which level was acted on.',
    enum: CustomTrackingModerationLevel,
  })
  level: CustomTrackingModerationLevel;

  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'What the member called it.' })
  name: string;

  @ApiProperty({ description: 'Whether it is now hidden from public view.' })
  suppressed: boolean;

  @ApiProperty({
    description: 'When it was suppressed, or null once it is restored.',
    nullable: true,
  })
  suppressedAt: Date | null;

  @ApiProperty({
    description: 'The administrator who suppressed it, or null.',
    nullable: true,
  })
  suppressedByUserId: string | null;
}
