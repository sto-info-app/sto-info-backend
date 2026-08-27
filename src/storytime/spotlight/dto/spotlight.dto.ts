import { ApiProperty } from '@nestjs/swagger';
import { SpotlightEntityType } from '../../enums/spotlight-entity-type.enum';
import { ArcDto } from '../../arcs/dto/arc.dto';
import { StoryDto } from '../../stories/dto/story.dto';

/**
 * A Spotlight entry as readers see it.
 *
 * The featured work travels with the entry rather than being fetched
 * separately, because a Spotlight that names something a reader then has to go
 * and look up is not a recommendation, it is a riddle.
 */
export class SpotlightDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'URL-friendly identifier.' })
  slug: string;

  @ApiProperty({
    enum: SpotlightEntityType,
    description: 'What kind of work is featured.',
  })
  entityType: SpotlightEntityType;

  @ApiProperty({ description: 'The editorial headline.' })
  headline: string;

  @ApiProperty({ description: 'The editorial summary.' })
  summary: string;

  @ApiProperty({ description: 'Why the work was chosen.', nullable: true })
  selectionReason: string | null;

  @ApiProperty({
    description: 'Image shown instead of the work’s own banner.',
    nullable: true,
  })
  overrideImageUrl: string | null;

  @ApiProperty({
    description: 'The override image at mobile size.',
    nullable: true,
  })
  overrideImageMobileUrl: string | null;

  @ApiProperty({
    description: 'Alternative text for the override image.',
    nullable: true,
  })
  overrideImageAlt: string | null;

  @ApiProperty({ description: 'When the entry started showing.' })
  startsAt: Date;

  @ApiProperty({ description: 'When it stops showing.', nullable: true })
  endsAt: Date | null;

  @ApiProperty({
    type: StoryDto,
    description: 'The featured Story, when a Story is featured.',
    nullable: true,
  })
  story: StoryDto | null;

  @ApiProperty({
    type: ArcDto,
    description: 'The featured Arc, when an Arc is featured.',
    nullable: true,
  })
  arc: ArcDto | null;
}

/**
 * A Spotlight entry as an editor manages it.
 *
 * Carries the scheduling an editor works with and the identifiers they need to
 * change it, none of which a reader has any use for.
 */
export class ManagedSpotlightDto extends SpotlightDto {
  @ApiProperty({
    description: 'The featured Story, when a Story is featured.',
    nullable: true,
  })
  storyId: string | null;

  @ApiProperty({
    description: 'The featured Arc, when an Arc is featured.',
    nullable: true,
  })
  arcId: string | null;

  @ApiProperty({
    description: 'Cloudflare Images ID for the override image.',
    nullable: true,
  })
  overrideImageId: string | null;

  @ApiProperty({ description: 'Higher entries show first.' })
  displayPriority: number;

  @ApiProperty({ description: 'Whether the entry may show at all.' })
  isPublished: boolean;

  @ApiProperty({ description: 'Editor who created it.' })
  createdByUserId: string;

  @ApiProperty({ description: 'Editor who last changed it.' })
  updatedByUserId: string;

  @ApiProperty({ description: 'When it was created.' })
  createdAt: Date;

  @ApiProperty({ description: 'When it was last changed.' })
  updatedAt: Date;
}
