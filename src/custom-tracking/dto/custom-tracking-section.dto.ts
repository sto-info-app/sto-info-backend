import { ApiProperty } from '@nestjs/swagger';

import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import {
  CreateCustomTrackingDefinitionDto,
  UpdateCustomTrackingDefinitionDto,
} from './custom-tracking-definition.dto';

/**
 * Creating a Section.
 *
 * The target scope is not here. It comes from the route, because it is fixed
 * for the life of the Section and putting it in the body would suggest it were
 * one more editable property.
 */
export class CreateCustomTrackingSectionDto extends CreateCustomTrackingDefinitionDto {}

/**
 * Changing a Section.
 *
 * Every property is optional, and absent means "leave it alone" rather than
 * "clear it". A partial update that silently blanked what it did not mention
 * would lose a description the moment somebody renamed a Section.
 */
export class UpdateCustomTrackingSectionDto extends UpdateCustomTrackingDefinitionDto {}

/**
 * A Section as its owner sees it.
 */
export class CustomTrackingSectionDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({
    description: 'Whether it describes Accounts or Characters.',
    enum: CustomTrackingTargetScope,
  })
  targetScope: CustomTrackingTargetScope;

  @ApiProperty({ description: 'The heading shown on the Section bar.' })
  name: string;

  @ApiProperty({ description: 'What the Section is for.', nullable: true })
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
