import { ApiProperty } from '@nestjs/swagger';

import { ArcDto } from '../../arcs/dto/arc.dto';
import { StoryDto } from '../../stories/dto/story.dto';

/**
 * Everything one member has published, in one place.
 *
 * Only publicly listed work appears. Unlisted work stays reachable by link and
 * invisible to browsing, which is the promise its author relied on.
 */
export class CreatorWorkDto {
  @ApiProperty({ type: [StoryDto], description: 'Their published Stories.' })
  stories: StoryDto[];

  @ApiProperty({ type: [ArcDto], description: 'The Arcs they curate.' })
  arcs: ArcDto[];
}
