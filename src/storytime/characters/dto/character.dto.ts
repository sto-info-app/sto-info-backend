import { ApiProperty } from '@nestjs/swagger';
import { StorytimeModerationStatus } from '../../enums/storytime-moderation-status.enum';

/**
 * A Character as readers see them.
 */
export class CharacterDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Story they belong to.' })
  storyId: string;

  @ApiProperty({ description: 'URL-friendly identifier within the Story.' })
  slug: string;

  @ApiProperty({ description: 'The name readers know them by.' })
  name: string;

  @ApiProperty({ description: 'One-line description.', nullable: true })
  shortBio: string | null;

  @ApiProperty({
    description: 'Server-rendered, sanitised biography.',
    nullable: true,
  })
  biographyHtml: string | null;

  @ApiProperty({ description: 'Portrait at full size.', nullable: true })
  portraitImageUrl: string | null;

  @ApiProperty({ description: 'Portrait at cast-list size.', nullable: true })
  portraitImageThumbnailUrl: string | null;

  @ApiProperty({
    description: 'Alternative text for the portrait.',
    nullable: true,
  })
  portraitImageAlt: string | null;

  @ApiProperty({ description: 'Species.', nullable: true })
  species: string | null;

  @ApiProperty({ description: 'Faction.', nullable: true })
  faction: string | null;

  @ApiProperty({ description: 'Rank.', nullable: true })
  rank: string | null;

  @ApiProperty({ description: 'Occupation or role.', nullable: true })
  occupation: string | null;

  @ApiProperty({ description: 'Affiliation or allegiance.', nullable: true })
  affiliation: string | null;

  @ApiProperty({ description: 'Ship or posting.', nullable: true })
  shipAssignment: string | null;

  @ApiProperty({
    description: 'Short descriptive traits.',
    type: [String],
    nullable: true,
  })
  traits: string[] | null;

  @ApiProperty({ description: 'Whether they are a main Character.' })
  isPrimary: boolean;

  @ApiProperty({ description: 'Position within the cast list.' })
  displayOrder: number;
}

/**
 * A Character as their creator manages them.
 */
export class ManagedCharacterDto extends CharacterDto {
  @ApiProperty({ description: 'The biography source, as authored.' })
  biographySource: string;

  @ApiProperty({
    description: 'Cloudflare Images ID for the portrait.',
    nullable: true,
  })
  portraitImageId: string | null;

  @ApiProperty({
    description: 'Optimistic-concurrency version, sent back on update.',
  })
  version: number;

  @ApiProperty({
    enum: StorytimeModerationStatus,
    description: 'Whether an administrator has removed the Character.',
  })
  moderationStatus: StorytimeModerationStatus;

  @ApiProperty({
    description: 'Explanation shown to the creator verbatim.',
    nullable: true,
  })
  moderationMessage: string | null;
}
