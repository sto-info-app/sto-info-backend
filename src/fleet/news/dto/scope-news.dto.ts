import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { NewsStatus } from 'src/news/enums/news-status.enum';

import { FleetAudience } from '../../enums/fleet-audience.enum';
import {
  SCOPE_NEWS_AUDIENCES,
  SCOPE_NEWS_MAX_PAGE_SIZE,
  SCOPE_NEWS_SEARCH_MAX_LENGTH,
} from '../constants/scope-news.constants';

/** The longest title a post may have, as for the site's news. */
export const SCOPE_NEWS_TITLE_MAX_LENGTH = 200;

/** The longest summary a post may have, as for the site's news. */
export const SCOPE_NEWS_SUMMARY_MAX_LENGTH = 500;

/** The longest body a post may have, as for the site's news. */
export const SCOPE_NEWS_BODY_MAX_LENGTH = 50000;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const AUDIENCE_MESSAGE = 'audience must be PUBLIC, COMMUNITY or FLEET_MEMBERS';

/** A new post, written as a draft. */
export class CreateScopeNewsPostDto {
  @ApiProperty({ maxLength: SCOPE_NEWS_TITLE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please give the post a title' })
  @MaxLength(SCOPE_NEWS_TITLE_MAX_LENGTH)
  readonly title: string;

  @ApiPropertyOptional({
    description: 'A short plain-text summary for listings.',
    maxLength: SCOPE_NEWS_SUMMARY_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SCOPE_NEWS_SUMMARY_MAX_LENGTH)
  readonly summary?: string | null;

  @ApiProperty({
    description: 'The post, in Markdown.',
    maxLength: SCOPE_NEWS_BODY_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'Please write the post' })
  @MaxLength(SCOPE_NEWS_BODY_MAX_LENGTH)
  readonly body: string;

  @ApiPropertyOptional({
    enum: SCOPE_NEWS_AUDIENCES,
    description: 'Who may read it once published. Defaults to PUBLIC.',
  })
  @IsOptional()
  @IsIn(SCOPE_NEWS_AUDIENCES, { message: AUDIENCE_MESSAGE })
  readonly audience?: FleetAudience;
}

/** Changes to a post. Anything left out stays as it is. */
export class UpdateScopeNewsPostDto {
  @ApiPropertyOptional({ maxLength: SCOPE_NEWS_TITLE_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please give the post a title' })
  @MaxLength(SCOPE_NEWS_TITLE_MAX_LENGTH)
  readonly title?: string;

  @ApiPropertyOptional({
    description: 'The summary; null or empty clears it.',
    maxLength: SCOPE_NEWS_SUMMARY_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SCOPE_NEWS_SUMMARY_MAX_LENGTH)
  readonly summary?: string | null;

  @ApiPropertyOptional({ maxLength: SCOPE_NEWS_BODY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Please write the post' })
  @MaxLength(SCOPE_NEWS_BODY_MAX_LENGTH)
  readonly body?: string;

  @ApiPropertyOptional({ enum: SCOPE_NEWS_AUDIENCES })
  @IsOptional()
  @IsIn(SCOPE_NEWS_AUDIENCES, { message: AUDIENCE_MESSAGE })
  readonly audience?: FleetAudience;
}

/** Which of a scope's posts to list. */
export class ScopeNewsQueryDto {
  @ApiPropertyOptional({ description: 'The page, from 1.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({
    description: `Posts per page, at most ${SCOPE_NEWS_MAX_PAGE_SIZE}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SCOPE_NEWS_MAX_PAGE_SIZE)
  readonly pageSize?: number;

  @ApiPropertyOptional({
    description: 'Words to find in the title or the summary.',
    maxLength: SCOPE_NEWS_SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SCOPE_NEWS_SEARCH_MAX_LENGTH)
  readonly q?: string;

  @ApiPropertyOptional({
    enum: NewsStatus,
    description:
      'PUBLISHED, the default, or DRAFT, which needs news.write at the scope.',
  })
  @IsOptional()
  @IsIn(Object.values(NewsStatus))
  readonly status?: NewsStatus;
}

/** Who wrote a post. */
export class ScopeNewsAuthorDto {
  @ApiProperty({ description: 'Their STO Info username.' })
  username: string;

  @ApiProperty({
    description:
      'Whether their profile is one the reader may open: public, active, and no block either way.',
  })
  linksToProfile: boolean;
}

/** A post as a listing shows it, without its body. */
export class ScopeNewsPostSummaryDto {
  @ApiProperty() id: string;

  @ApiProperty() slug: string;

  @ApiProperty() title: string;

  @ApiProperty({ nullable: true, type: String }) summary: string | null;

  @ApiProperty({ enum: NewsStatus }) status: NewsStatus;

  @ApiProperty({ enum: SCOPE_NEWS_AUDIENCES }) audience: FleetAudience;

  @ApiProperty({ nullable: true, type: Date }) publishedAt: Date | null;

  @ApiProperty() createdAt: Date;

  @ApiProperty() updatedAt: Date;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Delivery reference of the cover image.',
  })
  coverImageId: string | null;

  @ApiProperty({ nullable: true, type: String }) coverImageAlt: string | null;

  @ApiProperty({ nullable: true, type: ScopeNewsAuthorDto })
  author: ScopeNewsAuthorDto | null;
}

/** A post in full. */
export class ScopeNewsPostDto extends ScopeNewsPostSummaryDto {
  @ApiProperty({ description: 'The post, in Markdown.' }) body: string;
}

/** One post, and what its reader may do. */
export class ScopeNewsPostViewDto {
  @ApiProperty({ type: ScopeNewsPostDto }) post: ScopeNewsPostDto;

  @ApiProperty({
    description: 'Whether the reader holds news.write at the scope.',
  })
  mayWrite: boolean;

  @ApiProperty({
    description:
      'Whether the scope is open. A closed or suspended scope’s news cannot change.',
  })
  isOpen: boolean;
}

/** A page of a scope's posts. */
export class ScopeNewsPageDto {
  @ApiProperty({ type: [ScopeNewsPostSummaryDto] })
  items: ScopeNewsPostSummaryDto[];

  @ApiProperty() total: number;

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;

  @ApiProperty({
    description: 'Whether the reader holds news.write at the scope.',
  })
  mayWrite: boolean;

  @ApiProperty({
    description:
      'Whether the scope is open. A closed or suspended scope’s news cannot change.',
  })
  isOpen: boolean;
}
