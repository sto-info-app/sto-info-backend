import { ApiProperty } from '@nestjs/swagger';

import {
  CreateCustomTrackingDefinitionDto,
  UpdateCustomTrackingDefinitionDto,
} from './custom-tracking-definition.dto';

/**
 * Creating a Tab.
 *
 * The Section it belongs to comes from the route. A Tab cannot be moved
 * between Sections, so its parent is part of where it lives rather than
 * something the body describes.
 */
export class CreateCustomTrackingTabDto extends CreateCustomTrackingDefinitionDto {}

/**
 * Changing a Tab. Absent means leave alone, not clear.
 */
export class UpdateCustomTrackingTabDto extends UpdateCustomTrackingDefinitionDto {}

/**
 * A Tab as its owner sees it.
 */
export class CustomTrackingTabDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Section it belongs to.' })
  sectionId: string;

  @ApiProperty({ description: 'The label on the tab itself.' })
  name: string;

  @ApiProperty({ description: 'What the Tab groups together.', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Position among its siblings.' })
  orderIndex: number;

  @ApiProperty({ description: 'Whether it may be shown publicly.' })
  publiclyVisible: boolean;

  @ApiProperty({
    description: 'Whether an administrator has suppressed it from public view.',
  })
  suppressed: boolean;
}
