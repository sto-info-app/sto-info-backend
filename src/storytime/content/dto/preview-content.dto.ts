import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsOptional, IsString, MaxLength } from 'class-validator';

import { STORYTIME_LIMITS } from '../../constants/storytime-limits.constants';

/**
 * Markdown a creator wants to see rendered before they save it.
 *
 * One shape for every field that takes Storytime Markdown — a Chapter body, a
 * Story or Arc description, a Character biography — because one renderer
 * produces all four and a preview that differed by field would be a preview of
 * something the reader never gets.
 *
 * Held to the Chapter body's ceiling, which is the largest of the four. The
 * configured limit is not consulted here: an exemption raises what a creator
 * may *save*, and a preview of text longer than this one is already refused by
 * the save it is previewing.
 */
export class PreviewContentDto {
  @ApiPropertyOptional({
    description: 'The Markdown to render. Treated as hostile.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(STORYTIME_LIMITS.MAX_CONTENT_LENGTH.defaultValue)
  readonly contentSource?: string;
}
