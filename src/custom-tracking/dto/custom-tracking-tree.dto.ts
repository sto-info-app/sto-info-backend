import { ApiProperty } from '@nestjs/swagger';

import { CustomTrackingFieldDto } from './custom-tracking-field.dto';
import { CustomTrackingSectionDto } from './custom-tracking-section.dto';
import { CustomTrackingTabDto } from './custom-tracking-tab.dto';

/**
 * A Tab with the Fields inside it.
 *
 * Nested rather than flat, because everything that renders custom data needs
 * the whole hierarchy at once and reassembling it from three flat lists is
 * work every consumer would otherwise repeat.
 */
export class CustomTrackingTabTreeDto extends CustomTrackingTabDto {
  @ApiProperty({
    description: 'The Fields in this Tab, in order.',
    type: [CustomTrackingFieldDto],
  })
  fields: CustomTrackingFieldDto[];
}

/**
 * A Section with the Tabs inside it.
 */
export class CustomTrackingSectionTreeDto extends CustomTrackingSectionDto {
  @ApiProperty({
    description: 'The Tabs in this Section, in order.',
    type: [CustomTrackingTabTreeDto],
  })
  tabs: CustomTrackingTabTreeDto[];
}
