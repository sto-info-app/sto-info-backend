import { Injectable } from '@nestjs/common';
import { ChapterMediaDto } from './dto/chapter-media.dto';
import { StorytimeChapterMediaEntity } from './entities/storytime-chapter-media.entity';

/**
 * Turns Chapter media into the shape the API returns.
 *
 * The embed URL and thumbnail are built from the stored identifiers rather
 * than stored, so a change of embed policy reaches every video already saved,
 * and there is no field a creator could ever have influenced the shape of.
 */
@Injectable()
export class StorytimeMediaMapper {
  /**
   * Maps a video.
   *
   * @param media - The media entity.
   * @returns The reader-facing video.
   */
  toDto(media: StorytimeChapterMediaEntity): ChapterMediaDto {
    return {
      id: media.id,
      chapterId: media.chapterId,
      provider: media.provider,
      externalId: media.externalId,
      embedUrl: media.embedUrl,
      thumbnailUrl: media.thumbnailUrl,
      thumbnailHdUrl: media.thumbnailHdUrl,
      title: media.title,
      caption: media.caption,
      startSeconds: media.startSeconds,
      endSeconds: media.endSeconds,
      isPrimary: media.isPrimary,
      orderIndex: media.orderIndex,
    };
  }

  /**
   * Maps several videos.
   *
   * @param media - The media entities.
   * @returns The reader-facing videos.
   */
  toDtoList(media: StorytimeChapterMediaEntity[]): ChapterMediaDto[] {
    return media.map(entry => this.toDto(entry));
  }
}
