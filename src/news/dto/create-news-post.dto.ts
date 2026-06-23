import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NewsCategory } from '../enums/news-category.enum';
import { NewsStatus } from '../enums/news-status.enum';
import { NEWS_SLUG_PATTERN } from 'src/shared/constants/regex-patterns.constants';

export class CreateNewsPostDto {
  @ApiProperty({ description: 'Post title.' })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  readonly title: string;

  @ApiPropertyOptional({
    description:
      'URL-friendly slug. Lowercase letters, numbers and hyphens only. Auto-generated from the title when omitted.',
    example: 'v1-2-0-release-notes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  @Matches(NEWS_SLUG_PATTERN, {
    message: 'slug must contain only lowercase letters, numbers and hyphens',
  })
  readonly slug?: string;

  @ApiPropertyOptional({ description: 'Short plain-text summary.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly summary?: string;

  @ApiProperty({ description: 'Post body, authored as Markdown.' })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  readonly body: string;

  @ApiPropertyOptional({ enum: NewsCategory })
  @IsOptional()
  @IsEnum(NewsCategory)
  readonly category?: NewsCategory;

  @ApiPropertyOptional({
    enum: NewsStatus,
    description: 'Defaults to DRAFT when omitted.',
  })
  @IsOptional()
  @IsEnum(NewsStatus)
  readonly status?: NewsStatus;
}
