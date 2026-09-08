import { ApiProperty } from '@nestjs/swagger';

import { CrewCreditScope } from '../../enums/crew-credit-scope.enum';

/**
 * A Crew role as offered when adding a credit.
 */
export class CrewRoleDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'Stable code.' })
  code: string;

  @ApiProperty({ description: 'How the role is shown in credits.' })
  name: string;

  @ApiProperty({ description: 'What the role means.', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Position in a credits roll.' })
  displayOrder: number;
}

/**
 * A credit as it appears in a credits roll.
 */
export class CrewCreditDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Story credited in.' })
  storyId: string;

  @ApiProperty({
    description: 'The Chapter, when the credit is for one.',
    nullable: true,
  })
  chapterId: string | null;

  @ApiProperty({
    description: 'The Character, when the credit is for one.',
    nullable: true,
  })
  characterId: string | null;

  @ApiProperty({ description: 'The member credited.' })
  userId: string;

  @ApiProperty({
    enum: CrewCreditScope,
    description: 'What the credit attaches to, derived from what it names.',
  })
  scope: CrewCreditScope;

  @ApiProperty({
    type: CrewRoleDto,
    nullable: true,
    description: 'The role, when one was loaded alongside.',
  })
  role: CrewRoleDto | null;

  @ApiProperty({
    description:
      'How the credit should read — the label when one was given, otherwise the role name.',
  })
  displayLabel: string;

  @ApiProperty({ description: 'Notes shown with the credit.', nullable: true })
  notes: string | null;

  @ApiProperty({ description: 'Position within the credits.' })
  orderIndex: number;
}
