import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

import { ManagedCharacterDto } from './character.dto';

/**
 * Copies a Character from another Story into this one (sc-1483).
 */
export class CopyStorytimeCharacterDto {
  @ApiProperty({
    description:
      'The Character to copy. It must belong to another Story whose cast the caller may manage.',
  })
  @IsUUID('4')
  readonly sourceCharacterId: string;
}

/**
 * A Character the caller could copy, as the picker lists them.
 */
export class CopyableCharacterDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The name readers know them by.' })
  name: string;

  @ApiProperty({ description: 'One-line description.', nullable: true })
  shortBio: string | null;

  @ApiProperty({ description: 'Portrait at cast-list size.', nullable: true })
  portraitImageThumbnailUrl: string | null;

  @ApiProperty({
    description: 'What the portrait shows.',
    nullable: true,
  })
  portraitImageAlt: string | null;
}

/**
 * One of the caller's other Stories, with the Characters it offers to copy.
 */
export class CopyableCharacterStoryDto {
  @ApiProperty({ description: 'The Story.' })
  storyId: string;

  @ApiProperty({ description: 'Its title.' })
  storyTitle: string;

  @ApiProperty({ type: [CopyableCharacterDto] })
  characters: CopyableCharacterDto[];
}

/**
 * The original's portrait, for the creator to download and upload again.
 */
export class OriginalPortraitDto {
  @ApiProperty({
    description:
      'The portrait as it was uploaded, at full size. The CDN serves it to any origin.',
  })
  url: string;

  @ApiProperty({ description: 'What the portrait shows.', nullable: true })
  alt: string | null;
}

/**
 * The copy, and what it could not take with it.
 */
export class CopiedCharacterDto {
  @ApiProperty({ type: ManagedCharacterDto })
  character: ManagedCharacterDto;

  @ApiProperty({
    type: OriginalPortraitDto,
    nullable: true,
    description:
      'The original’s portrait, when it has one. The copy starts without a portrait, so the creator can upload this one again or choose another.',
  })
  originalPortrait: OriginalPortraitDto | null;
}
