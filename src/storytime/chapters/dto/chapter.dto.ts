import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChapterStatus } from '../../enums/chapter-status.enum';
import { ContentRating } from '../../enums/content-rating.enum';
import { StorytimeModerationStatus } from '../../enums/storytime-moderation-status.enum';

/**
 * A Chapter summarised for a list.
 */
export class ChapterSummaryDto {
  @ApiProperty({ description: 'Unique identifier.' })
  readonly id: string;

  @ApiProperty({ description: 'URL slug, unique within the Story.' })
  readonly slug: string;

  @ApiProperty({ description: 'Chapter title.' })
  readonly title: string;

  @ApiPropertyOptional({ description: 'Short summary.', nullable: true })
  readonly synopsis: string | null;

  @ApiProperty({ description: 'Position within the Story.' })
  readonly orderIndex: number;

  @ApiProperty({ description: 'Words in the Chapter body.' })
  readonly wordCount: number;

  @ApiPropertyOptional({
    description: 'Estimated reading time in whole minutes.',
    nullable: true,
  })
  readonly estimatedReadingMinutes: number | null;

  @ApiPropertyOptional({
    description: 'Cover URL at card size.',
    nullable: true,
  })
  readonly coverImageThumbnailUrl: string | null;

  @ApiPropertyOptional({
    description: 'Alternative text for the cover.',
    nullable: true,
  })
  readonly coverImageAlt: string | null;

  @ApiPropertyOptional({
    description: 'When the Chapter was published.',
    nullable: true,
  })
  readonly publishedAt: Date | null;
}

/**
 * A Chapter as a reader sees it, with its body.
 */
export class ChapterDto extends ChapterSummaryDto {
  @ApiProperty({ description: 'The Story this Chapter belongs to.' })
  readonly storyId: string;

  @ApiPropertyOptional({
    description: 'The Chapter body, rendered and sanitised.',
    nullable: true,
  })
  readonly contentHtml: string | null;

  @ApiProperty({
    description:
      'The language to render the Chapter in, resolved from the Chapter or its Story.',
  })
  readonly languageCode: string;

  @ApiProperty({
    enum: ContentRating,
    description:
      'The rating the Chapter is read under, inherited from its Story. Carried here so the reader page can warn before the content rather than fetching the Story to find out.',
  })
  readonly contentRating: ContentRating;

  @ApiPropertyOptional({ description: 'Cover URL.', nullable: true })
  readonly coverImageUrl: string | null;

  @ApiProperty({ description: 'Thumbs Up minus Thumbs Down.' })
  readonly rating: number;
}

/**
 * A Chapter as its creator manages it.
 */
export class ManagedChapterDto extends ChapterDto {
  @ApiProperty({ enum: ChapterStatus, description: 'Publication state.' })
  readonly status: ChapterStatus;

  @ApiPropertyOptional({
    description: 'The editable Markdown source.',
    nullable: true,
  })
  readonly contentSource: string;

  @ApiPropertyOptional({
    description:
      'The language the creator set on this Chapter, or null when it follows the Story. Distinct from languageCode, which is the resolved value a reader sees — an editor showing the resolved value would silently pin an inherited language on the next save.',
    nullable: true,
  })
  readonly ownLanguageCode: string | null;

  @ApiPropertyOptional({
    description: 'When the Chapter is due to publish automatically.',
    nullable: true,
  })
  readonly scheduledPublishAt: Date | null;

  @ApiProperty({ description: 'Version to send back with the next update.' })
  readonly version: number;

  @ApiProperty({
    enum: StorytimeModerationStatus,
    description: 'Whether an administrator has removed the Chapter.',
  })
  readonly moderationStatus: StorytimeModerationStatus;

  @ApiPropertyOptional({
    description: 'Explanation from the administrator, shown verbatim.',
    nullable: true,
  })
  readonly moderationMessage: string | null;
}

/**
 * A neighbouring Chapter, for previous/next navigation.
 */
export class ChapterLinkDto {
  @ApiProperty({ description: 'Chapter slug.' })
  readonly slug: string;

  @ApiProperty({ description: 'Chapter title.' })
  readonly title: string;
}

/**
 * A Chapter with the links either side of it.
 */
export class ChapterWithNavigationDto {
  @ApiProperty({ type: ChapterDto, description: 'The Chapter being read.' })
  readonly chapter: ChapterDto;

  @ApiPropertyOptional({
    type: ChapterLinkDto,
    description: 'The previous readable Chapter.',
    nullable: true,
  })
  readonly previous: ChapterLinkDto | null;

  @ApiPropertyOptional({
    type: ChapterLinkDto,
    description: 'The next readable Chapter.',
    nullable: true,
  })
  readonly next: ChapterLinkDto | null;
}
