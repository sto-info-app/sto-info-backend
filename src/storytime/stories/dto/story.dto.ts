import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CompletionState } from '../../enums/completion-state.enum';
import { ContentRating } from '../../enums/content-rating.enum';
import { StoryStatus } from '../../enums/story-status.enum';
import { StorytimeModerationStatus } from '../../enums/storytime-moderation-status.enum';
import { StorytimeVisibility } from '../../enums/storytime-visibility.enum';
import { StorytimeAuthorDto } from '../../dto/storytime-author.dto';
import { TagDto } from '../../tags/dto/create-tag.dto';

/**
 * A Story as presented to readers.
 *
 * Carries only what a reader may see. Moderation notes, the owner's ordering
 * and audit columns are all absent, so a public response cannot leak them
 * however the entity changes.
 */
export class StoryDto {
  @ApiProperty({ description: 'Unique identifier.' })
  readonly id: string;

  @ApiProperty({ description: 'URL slug.' })
  readonly slug: string;

  @ApiProperty({ description: 'Story title.' })
  readonly title: string;

  @ApiProperty({ description: 'The user who owns the Story.' })
  readonly ownerUserId: string;

  @ApiPropertyOptional({
    description:
      'The member who published it, or null when they no longer have an ' +
      'account.',
    type: StorytimeAuthorDto,
    nullable: true,
  })
  readonly author: StorytimeAuthorDto | null;

  @ApiPropertyOptional({ description: 'Short summary.', nullable: true })
  readonly shortDescription: string | null;

  @ApiPropertyOptional({
    description: 'Description, rendered and sanitised.',
    nullable: true,
  })
  readonly descriptionHtml: string | null;

  @ApiProperty({ enum: CompletionState, description: 'How finished it is.' })
  readonly completionState: CompletionState;

  @ApiProperty({ enum: ContentRating, description: 'Audience rating.' })
  readonly contentRating: ContentRating;

  @ApiProperty({
    description:
      'BCP 47 language, surfaced so the reader page can carry a matching lang attribute.',
  })
  readonly languageCode: string;

  @ApiPropertyOptional({ description: 'Banner URL.', nullable: true })
  readonly bannerImageUrl: string | null;

  @ApiPropertyOptional({
    description: 'Banner URL at mobile size.',
    nullable: true,
  })
  readonly bannerImageMobileUrl: string | null;

  @ApiPropertyOptional({
    description: 'Alternative text for the banner.',
    nullable: true,
  })
  readonly bannerImageAlt: string | null;

  @ApiPropertyOptional({ description: 'Profile image URL.', nullable: true })
  readonly profileImageUrl: string | null;

  @ApiPropertyOptional({
    description: 'Profile image URL at card size.',
    nullable: true,
  })
  readonly profileImageThumbnailUrl: string | null;

  @ApiPropertyOptional({
    description: 'Alternative text for the profile image.',
    nullable: true,
  })
  readonly profileImageAlt: string | null;

  @ApiProperty({ description: 'How many Chapters are published.' })
  readonly publishedChapterCount: number;

  @ApiProperty({
    description: 'Thumbs Up minus Thumbs Down.',
  })
  readonly rating: number;

  @ApiPropertyOptional({
    description: 'When the Story was first published.',
    nullable: true,
  })
  readonly publishedAt: Date | null;

  @ApiPropertyOptional({
    description: 'When a Chapter was last published or updated.',
    nullable: true,
  })
  readonly lastContentUpdateAt: Date | null;

  @ApiProperty({
    description:
      'What the Story is about, in vocabulary order. Empty on the creator’s ' +
      'own management views, which read and set tags through the tag routes.',
    type: [TagDto],
  })
  readonly tags: TagDto[];
}

/**
 * A Story as presented to its owner.
 *
 * Adds the fields a creator needs to manage it and which readers never see:
 * the working status, visibility, position in their collection, the editable
 * description source, and any moderation notice.
 */
export class ManagedStoryDto extends StoryDto {
  @ApiProperty({ enum: StoryStatus, description: 'Publication state.' })
  readonly status: StoryStatus;

  @ApiProperty({
    enum: StorytimeVisibility,
    description: 'Who may reach it once published.',
  })
  readonly visibility: StorytimeVisibility;

  @ApiProperty({ description: 'Position in the owner Story collection.' })
  readonly ownerOrderIndex: number;

  @ApiPropertyOptional({
    description: 'The editable Markdown source of the description.',
    nullable: true,
  })
  readonly description: string | null;

  @ApiProperty({
    description: 'Version to send back with the next update.',
  })
  readonly version: number;

  @ApiProperty({
    enum: StorytimeModerationStatus,
    description: 'Whether an administrator has removed the Story.',
  })
  readonly moderationStatus: StorytimeModerationStatus;

  @ApiPropertyOptional({
    description:
      'Explanation from the administrator who removed it, shown verbatim.',
    nullable: true,
  })
  readonly moderationMessage: string | null;

  @ApiPropertyOptional({
    description: 'When the content policy was accepted for this Story.',
    nullable: true,
  })
  readonly contentPolicyAcceptedAt: Date | null;

  @ApiPropertyOptional({
    description: 'Which version of the publishing terms was accepted, if any.',
    nullable: true,
  })
  readonly contentPolicyVersion: string | null;

  @ApiProperty({
    description:
      'Whether the accepted terms are the current ones. False when the ' +
      'creator has never accepted, or accepted wording since superseded.',
  })
  readonly contentPolicyCurrent: boolean;
}
