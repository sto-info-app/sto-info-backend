import { ApiProperty } from '@nestjs/swagger';

/**
 * An Arc named alongside a Story, as a reader is shown it.
 *
 * Only enough to say what the Arc is and where it lives. A listing that named
 * a Story's Arcs in full would carry a second work's description, tags and
 * artwork for every row, which is a great deal of response for a fact a reader
 * reads in three words.
 */
export class StorytimeArcReferenceDto {
  @ApiProperty({ description: 'Unique identifier.' })
  readonly id: string;

  @ApiProperty({ description: 'Arc title.' })
  readonly title: string;

  @ApiProperty({ description: 'URL slug.' })
  readonly slug: string;
}
