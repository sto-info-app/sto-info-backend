import { ApiProperty } from '@nestjs/swagger';
import { CharacterDto } from './character.dto';

/**
 * A Chapter a Character appears in, as a reader can reach it.
 *
 * Carries the slug and title rather than the whole Chapter: this is a list of
 * links, and sending a Chapter's body with each one would be sending the whole
 * Story to render a sidebar.
 */
export class CharacterAppearanceLinkDto {
  @ApiProperty({ description: 'The Chapter.' })
  chapterId: string;

  @ApiProperty({ description: 'The Chapter slug, for the link.' })
  chapterSlug: string;

  @ApiProperty({ description: 'The Chapter title.' })
  chapterTitle: string;

  @ApiProperty({
    description: 'Whether they are central to that Chapter.',
  })
  isPrimary: boolean;
}

/**
 * A Character and the Chapters a reader can find them in.
 *
 * Only readable Chapters are listed. A Character whose appearances are all in
 * unpublished Chapters shows an empty list rather than the titles of Chapters
 * nobody can open yet.
 */
export class CharacterAppearancesDto {
  @ApiProperty({ type: CharacterDto })
  character: CharacterDto;

  @ApiProperty({ type: [CharacterAppearanceLinkDto] })
  appearsIn: CharacterAppearanceLinkDto[];
}
