import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { YOUTUBE_MAX_OFFSET_SECONDS } from '../../content/constants/youtube.constants';

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Adds a video to a Chapter.
 *
 * The URL is taken as a whole and parsed on the server rather than validated
 * into shape here. A creator pastes whatever YouTube's Share button gave them,
 * and only what the parser recovers from it — a video ID, and sometimes a
 * playlist and a start time — is ever stored.
 */
export class AddChapterMediaDto {
  @ApiProperty({
    description: 'The YouTube share URL, as pasted.',
    maxLength: 2048,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  readonly url: string;

  // Overrides whatever the URL carried, for a creator who wants a different
  // starting point from the one they happened to copy.
  @ApiPropertyOptional({
    description: 'Where playback should start, in seconds.',
    minimum: 0,
    maximum: YOUTUBE_MAX_OFFSET_SECONDS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(YOUTUBE_MAX_OFFSET_SECONDS)
  readonly startSeconds?: number;

  @ApiPropertyOptional({
    description: 'Where playback should stop, in seconds.',
    minimum: 1,
    maximum: YOUTUBE_MAX_OFFSET_SECONDS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(YOUTUBE_MAX_OFFSET_SECONDS)
  readonly endSeconds?: number;

  @ApiPropertyOptional({
    description: 'What the creator calls this video.',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  readonly title?: string;

  @ApiPropertyOptional({
    description: 'Caption shown with it.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  readonly caption?: string;

  @ApiPropertyOptional({
    description: 'Whether this is the Chapter’s headline video.',
  })
  @IsOptional()
  @IsBoolean()
  readonly isPrimary?: boolean;
}
