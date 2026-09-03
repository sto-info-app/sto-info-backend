import { ApiProperty } from '@nestjs/swagger';

import { StoryDto } from '../../stories/dto/story.dto';
import { StoryProgressDto } from './story-progress.dto';

/**
 * One Story in a reader's library, with the progress that put it there.
 *
 * The Story travels with the progress because progress rows hold identifiers,
 * and a library that showed a list of identifiers would be useless. Fetching
 * each Story separately would be a request per row.
 *
 * The Story may be absent: one made private, removed or deleted since the
 * reader started it still belongs in their library as something they read,
 * rather than vanishing from their own history.
 */
export class LibraryEntryDto {
  @ApiProperty({ type: StoryProgressDto })
  progress: StoryProgressDto;

  @ApiProperty({
    type: StoryDto,
    nullable: true,
    description: 'The Story, or null when it is no longer readable.',
  })
  story: StoryDto | null;
}
