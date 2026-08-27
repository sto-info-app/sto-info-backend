import { ApiProperty } from '@nestjs/swagger';
import { StorytimeActivityType } from '../../enums/storytime-activity-type.enum';

/**
 * Whether somebody follows a thing, and how many others do.
 */
export class FollowStateDto {
  @ApiProperty({ description: 'Whether the caller follows it.' })
  isFollowing: boolean;

  @ApiProperty({ description: 'How many people follow it.' })
  followerCount: number;
}

/**
 * One thing that happened, as a feed shows it.
 *
 * Carries the addresses rather than the identifiers, because a feed entry is
 * only useful as a link. Nothing here is stored: it is resolved from the
 * content when the feed is read, which is what lets a Story that has been
 * taken down disappear rather than linger.
 */
export class FeedEntryDto {
  @ApiProperty({ description: 'Unique identifier of the feed item.' })
  id: string;

  @ApiProperty({
    enum: StorytimeActivityType,
    description: 'What happened.',
  })
  activityType: StorytimeActivityType;

  @ApiProperty({ description: 'Who did it.' })
  actorUserId: string;

  @ApiProperty({ description: 'The Story it concerns.', nullable: true })
  storyTitle: string | null;

  @ApiProperty({ description: 'That Story’s address.', nullable: true })
  storySlug: string | null;

  @ApiProperty({ description: 'The Chapter it concerns.', nullable: true })
  chapterTitle: string | null;

  @ApiProperty({ description: 'That Chapter’s address.', nullable: true })
  chapterSlug: string | null;

  @ApiProperty({ description: 'The Arc it concerns.', nullable: true })
  arcTitle: string | null;

  @ApiProperty({ description: 'That Arc’s address.', nullable: true })
  arcSlug: string | null;

  @ApiProperty({ description: 'When it happened.' })
  occurredAt: Date;
}

/**
 * How much of a feed is new.
 */
export class UnreadCountDto {
  @ApiProperty({ description: 'How many unseen items the reader may read.' })
  unread: number;
}
