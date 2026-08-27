import { OmitType, PartialType } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import { AddChapterMediaDto } from './add-chapter-media.dto';

/**
 * Changes how a video is presented.
 *
 * The URL is not among the fields. Pointing an existing row at a different
 * video would silently change what a reader sees under a caption written about
 * something else, so that is a removal and an addition rather than an edit.
 */
export class UpdateChapterMediaDto extends PartialType(
  OmitType(AddChapterMediaDto, ['url'] as const),
) {}

/**
 * Reorders the media on a Chapter.
 */
export class ReorderChapterMediaDto {
  @ApiProperty({
    description: 'Every video on the Chapter, listed once each, in order.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  readonly mediaIds: string[];
}
