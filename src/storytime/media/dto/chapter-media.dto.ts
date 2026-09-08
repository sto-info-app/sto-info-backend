import { ApiProperty } from '@nestjs/swagger';

import { MediaProvider } from '../../enums/media-provider.enum';

/**
 * A video as a reader receives it.
 *
 * Carries a built embed URL and a thumbnail rather than anything a creator
 * typed. The client renders the still and only loads the embed when a reader
 * asks for it, so opening a Chapter tells YouTube nothing about who read it.
 */
export class ChapterMediaDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The Chapter this belongs to.' })
  chapterId: string;

  @ApiProperty({ enum: MediaProvider, description: 'Where the video lives.' })
  provider: MediaProvider;

  @ApiProperty({ description: 'The canonical video identifier.' })
  externalId: string;

  @ApiProperty({
    description:
      'The embed URL, built by the server from the stored identifiers.',
  })
  embedUrl: string;

  @ApiProperty({
    description:
      'The still shown before a reader asks for playback. Held for every video, so it is what a page falls back to.',
  })
  thumbnailUrl: string;

  @ApiProperty({
    description:
      'The full-size still, at 1280 across. Not produced for every video, so a page asking for it must fall back to thumbnailUrl.',
  })
  thumbnailHdUrl: string;

  @ApiProperty({
    description: 'What the creator calls this video.',
    nullable: true,
  })
  title: string | null;

  @ApiProperty({ description: 'Caption shown with it.', nullable: true })
  caption: string | null;

  @ApiProperty({
    description: 'Where playback should start, in seconds.',
    nullable: true,
  })
  startSeconds: number | null;

  @ApiProperty({
    description: 'Where playback should stop, in seconds.',
    nullable: true,
  })
  endSeconds: number | null;

  @ApiProperty({ description: 'Whether this is the headline video.' })
  isPrimary: boolean;

  @ApiProperty({ description: 'Position within the Chapter’s media.' })
  orderIndex: number;
}
