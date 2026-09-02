import { ApiProperty } from '@nestjs/swagger';
import { StoryDto } from '../../stories/dto/story.dto';
import { ArcMembershipStatus } from '../../enums/arc-membership-status.enum';
import { ArcStatus } from '../../enums/arc-status.enum';
import { StorytimeVisibility } from '../../enums/storytime-visibility.enum';
import { TagDto } from '../../tags/dto/create-tag.dto';

/**
 * An Arc as readers see it.
 */
export class ArcDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'URL-friendly identifier.' })
  slug: string;

  @ApiProperty({ description: 'Arc title.' })
  title: string;

  @ApiProperty({ description: 'The curator.' })
  ownerUserId: string;

  @ApiProperty({ description: 'Short summary.', nullable: true })
  shortDescription: string | null;

  @ApiProperty({
    description: 'Server-rendered, sanitised description.',
    nullable: true,
  })
  descriptionHtml: string | null;

  @ApiProperty({ description: 'BCP 47 language.' })
  languageCode: string;

  @ApiProperty({ description: 'Banner image.', nullable: true })
  bannerImageUrl: string | null;

  @ApiProperty({
    description: 'Alternative text for the banner.',
    nullable: true,
  })
  bannerImageAlt: string | null;

  @ApiProperty({ description: 'Profile image.', nullable: true })
  profileImageUrl: string | null;

  @ApiProperty({
    description: 'Alternative text for the profile image.',
    nullable: true,
  })
  profileImageAlt: string | null;

  @ApiProperty({ description: 'Thumbs up minus thumbs down.' })
  rating: number;

  @ApiProperty({ description: 'When the Arc was published.', nullable: true })
  publishedAt: Date | null;

  @ApiProperty({
    description:
      'What the Arc is about, in vocabulary order. Empty on the curator’s ' +
      'own management views, which read and set tags through the tag routes.',
    type: [TagDto],
  })
  tags: TagDto[];
}

/**
 * An Arc as its curator manages it.
 */
export class ManagedArcDto extends ArcDto {
  @ApiProperty({ enum: ArcStatus, description: 'Publication state.' })
  status: ArcStatus;

  @ApiProperty({
    enum: StorytimeVisibility,
    description: 'Who may reach it once published.',
  })
  visibility: StorytimeVisibility;

  @ApiProperty({
    description: 'The description source, as authored.',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    description: 'Cloudflare Images ID for the banner.',
    nullable: true,
  })
  bannerImageId: string | null;

  @ApiProperty({
    description: 'Cloudflare Images ID for the profile image.',
    nullable: true,
  })
  profileImageId: string | null;

  @ApiProperty({ description: 'Optimistic-concurrency version.' })
  version: number;
}

/**
 * A Story's place in an Arc.
 *
 * The Story may be absent: a membership can name a Story that is not published
 * yet, or one that has since been made private, and dropping the row would
 * leave a curator unable to see or undo what they agreed to.
 */
export class ArcMembershipDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Arc.' })
  arcId: string;

  @ApiProperty({ description: 'The Story.' })
  storyId: string;

  @ApiProperty({ description: 'Position in the reading order.' })
  orderIndex: number;

  @ApiProperty({
    enum: ArcMembershipStatus,
    description: 'Where the inclusion has got to.',
  })
  membershipStatus: ArcMembershipStatus;

  @ApiProperty({
    description: 'What the curator says about this Story’s place.',
    nullable: true,
  })
  introductoryNote: string | null;

  @ApiProperty({
    type: StoryDto,
    nullable: true,
    description: 'The Story, when it is one the caller may see.',
  })
  story: StoryDto | null;
}

/**
 * How far a reader has got through an Arc.
 *
 * Derived from Story progress rather than stored, so it can never drift from
 * what the reader has actually read.
 */
export class ArcProgressDto {
  @ApiProperty({ description: 'The Arc.' })
  arcId: string;

  @ApiProperty({ description: 'Readable Stories in the Arc right now.' })
  totalStories: number;

  @ApiProperty({ description: 'How many of those the reader has finished.' })
  completedStories: number;

  @ApiProperty({ description: 'Whole percent through the Arc.' })
  percentComplete: number;

  @ApiProperty({
    description: 'The first Story they have not finished.',
    nullable: true,
  })
  continueStoryId: string | null;

  @ApiProperty({
    description: 'Where in that Story to pick up.',
    nullable: true,
  })
  continueChapterId: string | null;
}

/**
 * An Arc and the Stories a reader can actually follow through it.
 */
export class ArcWithStoriesDto {
  @ApiProperty({ type: ArcDto })
  arc: ArcDto;

  @ApiProperty({ type: [ArcMembershipDto] })
  stories: ArcMembershipDto[];
}
